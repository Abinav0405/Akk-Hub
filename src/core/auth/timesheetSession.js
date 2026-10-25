/**
 * Timesheet Manager sessions — the hub sign-in.
 *
 * Ported from AKK-Timesheet-Manager-main/src/lib/authSession.js. Same RPCs, same rules;
 * every storage key is namespaced (`akk.timesheet.<oldKey>`) so ported Timesheet screens,
 * whose `localStorage.getItem('workerId')` calls were rewritten to
 * `storageKey('timesheet', 'workerId')`, read exactly what this file writes.
 */
import { supabaseTimesheet as supabase, supabaseCore, UNIFIED, signOutThisDevice } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { normalizeWorkerPasswordForSave } from '@/core/auth/passwordUtils';
import { cachedVerify, forgetVerified, peekVerified, primeVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('timesheet', key);

/** Worker session length (12 hours), in milliseconds — mirrored server-side. */
export const WORKER_SESSION_MS = 12 * 60 * 60 * 1000;

export const SESSION_TOKEN_KEY = K('roleSessionToken');
export const SESSION_ROLE_KEY = K('roleSessionRole');
export const SESSION_EXPIRED_FLAG = K('authSessionExpired');
export const LAST_WORKER_ID_KEY = K('lastWorkerId');
export const LAST_WORKER_TYPE_KEY = K('lastWorkerType');
export const WORKER_LOGIN_TIME_KEY = K('workerLoginTime');

const ADMIN_KEYS = ['adminLoggedIn', 'adminName', 'adminEmail'].map(K);
const WORKER_KEYS = ['workerLoggedIn', 'workerName', 'workerId', 'workerType'].map(K).concat(WORKER_LOGIN_TIME_KEY);
const MANAGER_KEYS = ['managerLoggedIn', 'managerName', 'managerEmail'].map(K);
const SUPERVISOR_KEYS = ['supervisorLoggedIn', 'supervisorName', 'supervisorId', 'supervisorSiteId'].map(K);
const ROLE_SESSION_KEYS = [SESSION_TOKEN_KEY, SESSION_ROLE_KEY, ...WORKER_KEYS, ...MANAGER_KEYS, ...SUPERVISOR_KEYS];

function lsGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
function lsSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* ignore */
    }
}
function ssGet(key) {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}
function ssSet(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        /* ignore */
    }
}
function removeKeys(keys, storage) {
    keys.forEach((k) => {
        try {
            (storage || localStorage).removeItem(k);
        } catch {
            /* ignore */
        }
    });
}

function getAdminEmailAllowlist() {
    const allowlistRaw = import.meta.env.VITE_ADMIN_EMAIL_ALLOWLIST;
    return (typeof allowlistRaw === 'string' ? allowlistRaw : '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Authorize admin (legacy-compatible).
 * Accepts app_metadata.role, user_metadata.role, or email allowlist.
 * If none are configured → allow any authenticated Auth user (old behaviour).
 */
export function isAuthorizedAdmin(user) {
    if (!user) return false;
    if (user.app_metadata?.role === 'admin') return true;
    if (user.user_metadata?.role === 'admin') return true;
    const allowlist = getAdminEmailAllowlist();
    if (allowlist.length > 0) return allowlist.includes((user.email || '').toLowerCase());
    console.warn('[timesheetSession] No admin allowlist / role configured — allowing any Auth user (legacy mode).');
    return true;
}

/**
 * One backend: the DATABASE decides who is an admin (core.is_hub_admin — the admin lists the hub keeps
 * in step). Never the user's own profile metadata (anyone can edit that) and never "any account".
 * Resolves true / false, or 'offline' when the check could not be made. Cached briefly per account.
 */
let adminCheck = { uid: null, ok: false, at: 0 };
async function serverSaysAdmin(user) {
    if (!user) return false;
    if (adminCheck.uid === user.id && Date.now() - adminCheck.at < 5 * 60_000) return adminCheck.ok;
    const { data, error } = await supabaseCore.rpc('is_hub_admin');
    if (error) return 'offline';
    adminCheck = { uid: user.id, ok: data === true, at: Date.now() };
    return adminCheck.ok;
}
async function adminAllowed(user) {
    return UNIFIED ? serverSaysAdmin(user) : isAuthorizedAdmin(user);
}

/* ------------------------------------------------------------------ */
/* Admin (Supabase Auth)                                               */
/* ------------------------------------------------------------------ */

export function clearAdminSession() {
    removeKeys(ADMIN_KEYS, sessionStorage);
    removeKeys(ADMIN_KEYS, localStorage);
}

export function persistAdminSession({ email, name }) {
    ssSet(K('adminLoggedIn'), 'true');
    ssSet(K('adminEmail'), email || '');
    ssSet(K('adminName'), name || '');
    lsSet(K('adminLoggedIn'), 'true');
    lsSet(K('adminEmail'), email || '');
    lsSet(K('adminName'), name || '');
}

export async function signInAdmin({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: 'Invalid email or password', cause: error };
    adminCheck = { uid: null, ok: false, at: 0 };
    const allowed = await adminAllowed(data.user);
    if (allowed !== true) {
        await signOutThisDevice(supabase);
        return {
            ok: false,
            error: allowed === 'offline' ? 'Could not confirm admin access — check the connection and try again.' : 'This account is not authorized for admin access',
        };
    }
    const name = data.user.user_metadata?.name || data.user.email.split('@')[0];
    persistAdminSession({ email: data.user.email, name });
    return { ok: true, admin: { email: data.user.email, name } };
}

export async function signOutAdmin() {
    adminCheck = { uid: null, ok: false, at: 0 };
    try {
        await signOutThisDevice(supabase);
    } catch {
        /* ignore */
    }
    clearAdminSession();
}

/**
 * Re-check the admin Supabase Auth session.
 * @returns {Promise<true | false | 'offline'>} `false` clears stale hub markers when the JWT
 *   is gone (avoids LoginPage ↔ /admin bounce). `'offline'` keeps markers on unexpected errors.
 */
export async function verifyAdminSession() {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            if (isAdminAuthenticated()) return 'offline';
            return false;
        }
        const user = data?.session?.user;
        if (!user) {
            // Markers without a JWT (storage-key drift, cleared sb-auth, etc.) — drop them so
            // identity goes null and the login screen can show once instead of looping.
            if (isAdminAuthenticated()) clearAdminSession();
            return false;
        }
        const allowed = await adminAllowed(user);
        if (allowed === 'offline') return isAdminAuthenticated() ? 'offline' : false;
        if (allowed !== true) {
            await signOutAdmin();
            return false;
        }
        persistAdminSession({
            email: user.email,
            name: lsGet(K('adminName')) || user.user_metadata?.name || user.email.split('@')[0],
        });
        return true;
    } catch {
        if (isAdminAuthenticated()) return 'offline';
        return false;
    }
}

/**
 * Hub change: the admin marker lives in localStorage too, so an admin stays signed in when
 * the app is reopened (the Supabase JWT already persists; the guard re-verifies it).
 */
export function isAdminAuthenticated() {
    return ssGet(K('adminLoggedIn')) === 'true' || lsGet(K('adminLoggedIn')) === 'true';
}

export function getAdminProfile() {
    return { email: lsGet(K('adminEmail')) || '', name: lsGet(K('adminName')) || 'Admin' };
}

export async function requestAdminPasswordReset(email) {
    const redirectTo = `${window.location.origin}/login?role=admin`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Role sessions (worker / manager / supervisor) — custom RPC tokens   */
/* ------------------------------------------------------------------ */

export function clearRoleSession({ expired = false } = {}) {
    forgetVerified('ts:role:');
    removeKeys(ROLE_SESSION_KEYS, localStorage);
    removeKeys(MANAGER_KEYS, sessionStorage);
    removeKeys(SUPERVISOR_KEYS, sessionStorage);
    if (expired) ssSet(SESSION_EXPIRED_FLAG, 'true');
}

export function consumeSessionExpiredMessage() {
    if (ssGet(SESSION_EXPIRED_FLAG) === 'true') {
        try {
            sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
        } catch {
            /* ignore */
        }
        return 'Your session expired for security. Please log in again.';
    }
    return null;
}

export function persistRoleSession(role, sessionToken, profile) {
    lsSet(SESSION_TOKEN_KEY, sessionToken);
    lsSet(SESSION_ROLE_KEY, role);

    if (role === 'worker') {
        lsSet(K('workerLoggedIn'), 'true');
        lsSet(K('workerName'), profile.workerName || '');
        lsSet(K('workerId'), profile.workerId || '');
        lsSet(K('workerType'), profile.workerType || 'foreign');
        stampWorkerLoginTime();
        if (profile.workerId) lsSet(LAST_WORKER_ID_KEY, profile.workerId);
        if (profile.workerType) lsSet(LAST_WORKER_TYPE_KEY, profile.workerType);
    } else if (role === 'manager') {
        lsSet(K('managerLoggedIn'), 'true');
        lsSet(K('managerName'), profile.managerName || '');
        lsSet(K('managerEmail'), profile.managerEmail || '');
        ssSet(K('managerName'), profile.managerName || '');
        ssSet(K('managerEmail'), profile.managerEmail || '');
    } else if (role === 'supervisor') {
        lsSet(K('supervisorLoggedIn'), 'true');
        lsSet(K('supervisorName'), profile.supervisorName || '');
        lsSet(K('supervisorId'), profile.supervisorId || '');
        lsSet(K('supervisorSiteId'), profile.supervisorSiteId || '');
        ssSet(K('supervisorName'), profile.supervisorName || '');
        ssSet(K('supervisorId'), profile.supervisorId || '');
    }
}

/** Snapshot of whatever role session is stored locally (not server-verified). */
export function getStoredRoleSession() {
    const role = lsGet(SESSION_ROLE_KEY);
    if (!role || !lsGet(SESSION_TOKEN_KEY)) return null;
    if (role === 'worker') {
        return {
            role,
            id: lsGet(K('workerId')) || '',
            name: lsGet(K('workerName')) || '',
            workerType: lsGet(K('workerType')) || 'foreign',
        };
    }
    if (role === 'manager') {
        return { role, id: lsGet(K('managerEmail')) || '', name: lsGet(K('managerName')) || '' };
    }
    if (role === 'supervisor') {
        return {
            role,
            id: lsGet(K('supervisorId')) || '',
            name: lsGet(K('supervisorName')) || '',
            siteId: lsGet(K('supervisorSiteId')) || '',
        };
    }
    return null;
}

export function getRoleSessionToken() {
    return lsGet(SESSION_TOKEN_KEY);
}

/**
 * Server confirmations are shared for a short time (core/auth/verifyCache.js): the hub guard
 * and the ported screens all ask on every page switch, so without this one navigation cost
 * two or three round trips.
 */
const roleKey = (token) => `ts:role:${token}`;

/** Right after a login the server just issued this token — treat it as verified. */
export function markFreshRoleSession(role, token, profile = {}) {
    primeVerified(roleKey(token), {
        role,
        subject_id: profile.workerId || profile.managerEmail || profile.supervisorId || '',
        session_data: { ...profile },
    });
}

/** Cached answer for the current token, if any (no request). */
export function peekRoleSession() {
    const token = lsGet(SESSION_TOKEN_KEY);
    return token ? peekVerified(roleKey(token)) : undefined;
}

async function fetchRoleSession(token, keepOnNetworkError) {
    try {
        const { data, error } = await supabase.rpc('verify_role_session', { p_session_token: token });
        // Transport / ambiguous failures must never wipe a hub session. Ported screens and
        // RequireHubRole share one cachedVerify inflight — a page that used to call with
        // keepOnNetworkError:false could clear the token and bounce a valid manager to /login.
        if (error) {
            if (isNetworkError(error) || keepOnNetworkError) return { networkError: true };
            clearRoleSession({ expired: true });
            return null;
        }
        if (!data?.length) {
            clearRoleSession({ expired: true });
            return null;
        }
        const row = data[0];
        // SEC-11: always re-bind identity from the server session (overwrites a local spoof)
        persistRoleSession(row.role, token, {
            workerName: row.session_data?.workerName,
            workerId: row.subject_id,
            workerType: row.session_data?.workerType,
            managerName: row.session_data?.managerName,
            managerEmail: row.session_data?.managerEmail || row.subject_id,
            supervisorName: row.session_data?.supervisorName,
            supervisorId: row.session_data?.supervisorId || row.subject_id,
            supervisorSiteId: row.session_data?.supervisorSiteId,
        });
        return row;
    } catch (error) {
        if (isNetworkError(error) || keepOnNetworkError) return { networkError: true };
        // Unexpected throw with no clear auth rejection — keep local markers; hub guard
        // will re-check. Clearing here caused false /login bounces on /timesheet/manage.
        return { networkError: true };
    }
}

/**
 * @param {{ keepOnNetworkError?: boolean, force?: boolean }} [options] keepOnNetworkError: keep
 *   the stored session and resolve `{ networkError: true }` when the server can't be reached.
 *   Defaults to true so ported Timesheet screens cannot race the hub guard and expire a
 *   still-valid role token.
 */
export async function verifyRoleSession({ keepOnNetworkError = true, force = false } = {}) {
    const token = lsGet(SESSION_TOKEN_KEY);
    if (!token) return null;
    if (force) forgetVerified(roleKey(token));
    return cachedVerify(roleKey(token), () => fetchRoleSession(token, keepOnNetworkError), {
        isValid: (row) => !!row?.role,
    });
}

export async function revokeRoleSession() {
    const token = lsGet(SESSION_TOKEN_KEY);
    if (token) {
        try {
            await supabase.rpc('revoke_role_session', { p_session_token: token });
        } catch {
            /* ignore */
        }
    }
    clearRoleSession();
}

export function hasRoleSessionMarker(role) {
    const token = lsGet(SESSION_TOKEN_KEY);
    const storedRole = lsGet(SESSION_ROLE_KEY);
    if (!token || storedRole !== role) return false;
    if (role === 'worker') return lsGet(K('workerLoggedIn')) === 'true';
    if (role === 'manager') return lsGet(K('managerLoggedIn')) === 'true';
    if (role === 'supervisor') return lsGet(K('supervisorLoggedIn')) === 'true' && !!lsGet(K('supervisorSiteId'));
    return false;
}

export const isManagerAuthenticated = () => hasRoleSessionMarker('manager');
export const isSupervisorAuthenticated = () => hasRoleSessionMarker('supervisor');
export const isWorkerAuthenticated = () => hasRoleSessionMarker('worker');

export function clearWorkerSession() {
    clearRoleSession();
}

export function stampWorkerLoginTime() {
    lsSet(WORKER_LOGIN_TIME_KEY, String(Date.now()));
}

export function getPostLoginRedirect(location, defaultPath) {
    const from = location?.state?.from;
    if (typeof from === 'string' && from && from !== location.pathname && from !== '/login') return from;
    return defaultPath;
}

export function getLastWorkerType() {
    const t = lsGet(LAST_WORKER_TYPE_KEY);
    return t === 'local' || t === 'foreign' ? t : 'foreign';
}

export function getLastWorkerId() {
    return lsGet(LAST_WORKER_ID_KEY) || '';
}

export function rememberLastWorker(id, type) {
    if (id) lsSet(LAST_WORKER_ID_KEY, String(id));
    if (type) lsSet(LAST_WORKER_TYPE_KEY, type);
}

export function isNetworkError(error) {
    if (!error) return false;
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) return true;
    return typeof navigator !== 'undefined' && !navigator.onLine;
}

export function parseLoginError(error, fallback = 'An error occurred during login') {
    if (isNetworkError(error)) return 'No connection — check your network and try again.';
    const msg = error?.message || '';
    // Live DB had invalid RAISE … USING MESSAGE (42601). Treat it as lockout so users aren't stuck.
    if (
        msg.includes('account_locked') ||
        msg.includes('Too many failed login attempts') ||
        msg.includes('RAISE option already specified')
    ) {
        return 'Too many failed attempts. Please wait 15 minutes and try again — or ask an admin to reset your password (that also unlocks the account).';
    }
    return fallback;
}

/**
 * Resolve Local vs Foreign before verify_worker_login so a wrong toggle does not burn
 * rate-limit attempts (and lock the worker out for 15 minutes).
 */
export async function resolveWorkerType(employeeId, preferredType) {
    const id = String(employeeId || '').trim();
    if (!id) return preferredType === 'local' ? 'local' : 'foreign';

    // One backend: the HR table is admin-only; a server function answers 'local' / 'foreign' / null.
    if (UNIFIED) {
        const { data } = await supabaseCore.rpc('worker_type_of', { p_employee_id: id });
        if (data === 'local' || data === 'foreign') return data;
        return preferredType === 'local' ? 'local' : 'foreign';
    }
    const [localRes, foreignRes] = await Promise.all([
        supabase.from('local_worker_details').select('employee_id').eq('employee_id', id).maybeSingle(),
        supabase.from('worker_details').select('employee_id').eq('employee_id', id).maybeSingle(),
    ]);

    const inLocal = !!localRes.data;
    const inForeign = !!foreignRes.data;
    if (inLocal && !inForeign) return 'local';
    if (inForeign && !inLocal) return 'foreign';
    if (inLocal && inForeign) {
        return preferredType === 'local' ? 'local' : 'foreign';
    }
    return preferredType === 'local' ? 'local' : 'foreign';
}

export async function signInWorker({ workerId, password, workerType }) {
    const id = String(workerId || '').trim();
    const preferred = workerType === 'local' ? 'local' : 'foreign';
    const resolvedType = await resolveWorkerType(id, preferred);

    const { data, error } = await supabase.rpc('verify_worker_login', {
        p_employee_id: id,
        p_password: password,
        p_worker_type: resolvedType,
    });
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Invalid Worker ID or Password' };
    return { ok: true, worker: data[0], workerType: resolvedType };
}

export async function signInManager({ email, password }) {
    const { data, error } = await supabase.rpc('verify_manager_login', {
        p_email: email.trim(),
        p_password: password,
    });
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Invalid Email or Password' };
    return { ok: true, manager: data[0] };
}

export async function signInSupervisor({ supervisorId, password }) {
    const { data, error } = await supabase.rpc('verify_supervisor_login', {
        p_supervisor_id: supervisorId.trim(),
        p_password: password,
    });
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Invalid Supervisor ID or Password' };
    return { ok: true, supervisor: data[0] };
}

export async function enrollWorkerFace({ employeeId, password, workerType, faceEmbedding }) {
    const { data, error } = await supabase.rpc('enroll_worker_face', {
        p_employee_id: employeeId,
        p_password: password,
        p_worker_type: workerType,
        p_face_embedding: faceEmbedding,
    });
    if (error) throw error;
    return !!data;
}

/** Upgrade a face_challenge token to a full portal session. */
export async function completeWorkerLoginAfterFace(challengeId, liveEmbedding = null) {
    const { data, error } = await supabase.rpc('complete_worker_login_after_face', {
        p_challenge_id: challengeId,
        p_live_embedding: liveEmbedding,
    });
    if (error) throw error;
    return data || null;
}

/** Check a signed-in worker's password, then revoke the extra session it issues. */
export async function verifyWorkerPassword({ workerId, password, workerType }) {
    const result = await signInWorker({ workerId, password, workerType });
    const extraToken = result.ok && (result.worker.session_token || result.worker.face_challenge_id);
    if (extraToken) {
        try {
            await supabase.rpc('revoke_role_session', { p_session_token: extraToken });
        } catch {
            /* expires on its own */
        }
    }
    return result;
}

export async function changeWorkerPassword({ currentPassword, newPassword }) {
    const token = lsGet(SESSION_TOKEN_KEY);
    if (!token) throw new Error('Not authenticated');
    const { data, error } = await supabase.rpc('change_worker_password', {
        p_session_token: token,
        p_current_password: currentPassword,
        p_new_password: newPassword,
    });
    if (error) throw error;
    return !!data;
}

export async function adminSetWorkerPassword({ employeeId, workerType, newPassword }) {
    const ok = await verifyAdminSession();
    if (!ok) throw new Error('Admin session required to reset worker passwords.');
    const plain = normalizeWorkerPasswordForSave(newPassword);
    if (!plain) throw new Error('Enter a new plain-text password (at least 4 characters).');
    const id = employeeId.trim();
    const type = workerType === 'local' ? 'local' : 'foreign';
    const { data, error } = await supabase.rpc('admin_set_worker_password', {
        p_employee_id: id,
        p_worker_type: type,
        p_new_password: plain,
    });
    if (error) throw error;
    if (!data) {
        throw new Error(
            `No ${type} worker found for employee ID ${id}. Check Local vs Foreign before resetting.`
        );
    }
    // Unlock immediately even if the DB migration that clears lockout inside the RPC is not applied yet.
    try {
        await supabase.rpc('record_login_success', { p_identifier: id, p_role: 'worker' });
    } catch {
        /* best effort — login still works after lockout window */
    }
    return true;
}

export async function adminSetManagerPassword({ managerId, newPassword, email }) {
    const ok = await verifyAdminSession();
    if (!ok) throw new Error('Admin session required to reset manager passwords.');
    const plain = normalizeWorkerPasswordForSave(newPassword);
    if (!plain || plain.length < 4) {
        throw new Error('Enter a new plain-text password (at least 4 characters).');
    }
    const { data, error } = await supabase.rpc('admin_set_manager_password', {
        p_manager_id: managerId,
        p_new_password: plain,
    });
    if (error) throw error;
    if (!data) throw new Error('Manager not found — could not update password.');
    const unlockId = String(email || '').trim().toLowerCase();
    if (unlockId) {
        try {
            await supabase.rpc('record_login_success', { p_identifier: unlockId, p_role: 'manager' });
        } catch {
            /* best effort */
        }
    }
    return true;
}

export async function adminSetSupervisorPassword({ supervisorRowId, newPassword, supervisorId }) {
    const ok = await verifyAdminSession();
    if (!ok) throw new Error('Admin session required to reset supervisor passwords.');
    const plain = normalizeWorkerPasswordForSave(newPassword);
    if (!plain || plain.length < 4) {
        throw new Error('Enter a new plain-text password (at least 4 characters).');
    }
    const { data, error } = await supabase.rpc('admin_set_supervisor_password', {
        p_supervisor_row_id: supervisorRowId,
        p_new_password: plain,
    });
    if (error) throw error;
    if (!data) throw new Error('Supervisor not found — could not update password.');
    const unlockId = String(supervisorId || '').trim();
    if (unlockId) {
        try {
            await supabase.rpc('record_login_success', { p_identifier: unlockId, p_role: 'supervisor' });
        } catch {
            /* best effort */
        }
    }
    return true;
}

/* ---- One-tap Face ID on a remembered phone ---- */

export async function registerLoginDevice(sessionToken, label = '') {
    const { data, error } = await supabase.rpc('register_login_device', {
        p_session_token: sessionToken,
        p_label: label || null,
    });
    if (error) throw error;
    return data || null;
}

export async function faceDeviceLogin(deviceToken, liveEmbedding) {
    const { data, error } = await supabase.rpc('face_device_login', {
        p_device_token: deviceToken,
        p_live_embedding: liveEmbedding,
    });
    if (error) throw error;
    return data?.[0] || null;
}

export async function revokeLoginDevice(deviceToken) {
    if (!deviceToken) return;
    try {
        await supabase.rpc('revoke_login_device', { p_device_token: deviceToken });
    } catch {
        /* best effort */
    }
}
