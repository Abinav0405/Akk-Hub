/**
 * Material Tracker sessions (requesters + staff), ported from
 * AKK-Material-Tracker-main/src/lib/auth.js.
 *
 * The source app imports a `lib/sessionStore.js` that is missing from its folder and from git
 * history, so the store below is rebuilt from how the app uses it:
 *   setWorkerSession({ workerId, workerName, token }) / getWorkerSession() → same shape
 *   sessionStorage 'workerId' / 'workerName' are read directly by ported screens
 *   seenRequestIdsKey(workerId) → localStorage key for "already seen" request ids
 * Keys are namespaced `akk.materials.*`.
 */
import { supabaseMaterials as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { cachedVerify, forgetVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('materials', key);

const WORKER_TOKEN_KEY = K('workerToken');
const WORKER_KEYS = [K('workerLoggedIn'), K('workerId'), K('workerName'), WORKER_TOKEN_KEY];
const ADMIN_KEYS = ['adminLoggedIn', 'adminEmail', 'adminName', 'staffName', 'staffEmail', 'staffRole'].map(K);

function both(fn) {
    for (const store of ['localStorage', 'sessionStorage']) {
        try {
            fn(window[store]);
        } catch {
            /* ignore */
        }
    }
}

/* ---- session store (rebuilt) ---- */

/** Persist the requester session. Mirrored in localStorage so the app can restore it after a restart. */
export function setWorkerSession({ workerId, workerName, token }) {
    both((s) => {
        s.setItem(K('workerLoggedIn'), 'true');
        s.setItem(K('workerId'), String(workerId ?? ''));
        s.setItem(K('workerName'), workerName || '');
        if (token) s.setItem(WORKER_TOKEN_KEY, token);
    });
}

/** @returns {{ workerId: string, workerName: string, token: string } | null} */
export function getWorkerSession() {
    try {
        const read = (k) => sessionStorage.getItem(k) ?? localStorage.getItem(k);
        if (read(K('workerLoggedIn')) !== 'true') return null;
        const token = read(WORKER_TOKEN_KEY);
        const workerId = read(K('workerId'));
        if (!token || !workerId) return null;
        // Restore the per-tab copy the ported screens read directly.
        sessionStorage.setItem(K('workerId'), workerId);
        sessionStorage.setItem(K('workerName'), read(K('workerName')) || '');
        return { workerId, workerName: read(K('workerName')) || '', token };
    } catch {
        return null;
    }
}

export function getStoredWorkerToken() {
    return getWorkerSession()?.token || null;
}

export function removeWorkerSessionFlags() {
    forgetVerified('mt:worker:');
    both((s) => WORKER_KEYS.forEach((k) => s.removeItem(k)));
}

export function clearAdminFlags() {
    forgetVerified('mt:staff');
    both((s) => ADMIN_KEYS.forEach((k) => s.removeItem(k)));
}

/** True when a Supabase Auth session for the Materials project is stored (native restore). */
export function hasStoredStaffSession() {
    try {
        return !!localStorage.getItem('akk.materials.sb-auth');
    } catch {
        return false;
    }
}

/**
 * Sync staff flags written at sign-in (sessionStorage). Used by ModuleGate right after
 * connect — Supabase may not have flushed `akk.materials.sb-auth` to localStorage yet.
 */
export function hasLocalStaffFlags() {
    try {
        return sessionStorage.getItem(K('adminLoggedIn')) === 'true';
    } catch {
        return false;
    }
}

export function seenRequestIdsKey(workerId) {
    return K(`seenRequestIds:${workerId}`);
}

/* ---- auth.js ---- */

export function clearWorkerSession() {
    // SEC-09: invalidate the server-side session too, not just the local flags.
    const token = getStoredWorkerToken();
    if (token) supabase.rpc('worker_logout', { p_token: token }).then(() => {}, () => {});
    removeWorkerSessionFlags();
}

/** Requester login (verify_requester_login). */
export async function signInRequester({ requesterId, password }) {
    const { data, error } = await supabase.rpc('verify_requester_login', {
        p_requester_id: String(requesterId).trim(),
        p_password: password,
    });
    const requester = Array.isArray(data) ? data[0] : data;
    if (error || !requester?.token) {
        return { ok: false, error: 'Invalid Requester ID or Password', cause: error };
    }
    setWorkerSession({ workerId: requester.requester_id, workerName: requester.name, token: requester.token });
    return { ok: true, requester };
}

export async function getAdminAuthUser() {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session?.user) return null;
        return data.session.user;
    } catch {
        return null;
    }
}

export async function getStaffSession() {
    return cachedVerify('mt:staff', fetchStaffSession);
}

async function fetchStaffSession() {
    const user = await getAdminAuthUser();
    if (!user) return null;
    const { data: profile, error } = await supabase
        .from('staff_profiles')
        .select('user_id, display_name, email, role, roles, is_active')
        .eq('user_id', user.id)
        .maybeSingle();
    if (error || !profile?.is_active) return null;
    const roles = profile.roles?.length ? profile.roles : [profile.role];
    return {
        user,
        userId: profile.user_id,
        email: profile.email || user.email || '',
        name: profile.display_name,
        role: profile.role,
        roles,
    };
}

export async function getAdminSession() {
    const session = await getStaffSession();
    return session?.roles?.includes('admin') ? session : null;
}

/** Staff (admin / manager) sign-in to the Materials project with Supabase Auth. */
export async function signInStaff({ email, password, role }) {
    forgetVerified('mt:staff');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: 'Invalid email or password', cause: error };
    const session = await getStaffSession();
    if (!session || (role && !session.roles?.includes(role))) {
        await supabase.auth.signOut();
        return { ok: false, error: `This account has no Material Tracker ${role || 'staff'} access.` };
    }
    persistStaffFlags(session, role);
    return { ok: true, session };
}

function persistStaffFlags(session, role) {
    try {
        sessionStorage.setItem(K('adminLoggedIn'), 'true');
        sessionStorage.setItem(K('adminEmail'), session.email);
        sessionStorage.setItem(K('adminName'), session.name);
        sessionStorage.setItem(K('staffName'), session.name);
        sessionStorage.setItem(K('staffEmail'), session.email);
        sessionStorage.setItem(K('staffRole'), role || session.role);
    } catch {
        /* ignore */
    }
}

/**
 * Hub version of requireStaffSession: on failure it sends the user to the hub's module
 * connect screen instead of the old Material Tracker login pages.
 */
export async function requireStaffSession(navigate, expectedRole) {
    const session = await getStaffSession();
    if (!session || (expectedRole && !session.roles?.includes(expectedRole))) {
        clearAdminFlags();
        navigate?.('/connect/materials');
        return null;
    }
    persistStaffFlags(session, expectedRole);
    return session;
}

export async function requireAdminSession(navigate) {
    return requireStaffSession(navigate, 'admin');
}

export async function signOutStaff() {
    try {
        await supabase.auth.signOut();
    } catch {
        /* still clear local flags */
    }
    clearAdminFlags();
}

export const signOutAdmin = signOutStaff;

/** SEC-09: re-validate against the server session, not just local flags. */
export async function verifyWorkerSession() {
    const local = getWorkerSession();
    if (!local?.token) return null;
    return cachedVerify(`mt:worker:${local.token}`, () => fetchWorkerSession(local));
}

async function fetchWorkerSession(local) {
    try {
        const { data, error } = await supabase.rpc('verify_worker_session', { p_token: local.token });
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row?.requester_id) return null;
        return { workerId: row.requester_id, workerName: row.name, token: local.token };
    } catch {
        return null;
    }
}

export async function requireWorkerSession(navigate) {
    const session = await verifyWorkerSession();
    if (!session) {
        clearWorkerSession();
        navigate?.('/connect/materials');
        return null;
    }
    return session;
}

export function isMaterialsWorkerConnected() {
    return !!getWorkerSession();
}

export async function isMaterialsStaffConnected(role) {
    const session = await getStaffSession();
    return !!session && (!role || session.roles?.includes(role));
}
