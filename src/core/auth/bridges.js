/**
 * Module bridges — how one hub sign-in reaches Material Tracker and Site Progress while
 * the three backends are still separate Supabase projects.
 *
 *   - Each hub role maps to a role in each module (MODULE_ROLES).
 *   - Right after a password sign-in (or a fingerprint unlock, which releases the saved
 *     password) the hub tries the same ID/email + password against the other two projects,
 *     quietly, in the background (autoConnectModules).
 *   - Anything that doesn't connect shows a one-time "Connect" card on that module's screens
 *     (/connect/:module), prefilled with the hub user's ID.
 *
 * When the single AKK Hub backend exists, this file collapses to "always connected".
 */
import { useSyncExternalStore } from 'react';
import { local } from '@/core/storage';
import { getAdminProfile, getRoleSessionToken, getStoredRoleSession, isAdminAuthenticated } from '@/core/auth/timesheetSession';
import * as materials from '@/core/auth/materialsSession';
import * as progressWorker from '@/core/auth/progress/workerSession';
import * as progressManager from '@/core/auth/progress/managerSession';
import * as progressAdmin from '@/core/auth/progress/adminSession';
import * as progressExporter from '@/core/auth/progress/exporterSession';
import { UNIFIED, isBackendConfigured, supabaseCore } from '@/core/supabase';

export const MODULES = ['timesheet', 'materials', 'progress'];

/** What people call each area of the one app (never the old app names). */
export const MODULE_LABELS = {
    timesheet: 'Attendance',
    materials: 'Materials',
    progress: 'Site work',
};

/** hub role → module role (null = no access in that module yet). */
export const MODULE_ROLES = {
    worker: { timesheet: 'worker', materials: 'worker', progress: 'worker' },
    supervisor: { timesheet: 'supervisor', materials: null, progress: null },
    manager: { timesheet: 'manager', materials: 'manager', progress: 'manager' },
    admin: { timesheet: 'admin', materials: 'admin', progress: 'admin' },
};

export function moduleRoleFor(hubRole, module) {
    return MODULE_ROLES[hubRole]?.[module] ?? null;
}

/* ------------------------------------------------------------------ */
/* Connection status (synchronous, from stored sessions)              */
/* ------------------------------------------------------------------ */

const listeners = new Set();
let version = 0;
function notify() {
    version += 1;
    listeners.forEach((fn) => fn());
}
function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Staff connections can't be read synchronously from Supabase Auth; remember what connected. */
function staffMarker(module) {
    return local.get('hub', `conn.${module}`);
}
function setStaffMarker(module, role) {
    local.set('hub', `conn.${module}`, role);
}

/** A module session is valid only for the hub account that linked it. */
function connectionOwner(module) {
    return local.get('hub', `conn.${module}.owner`);
}
/**
 * Prefer hub.id; fall back to the Timesheet session so connect right after login still
 * stamps an owner (avoids ModuleGate loops when hub.id wasn't written yet).
 */
function currentHubOwner() {
    const stored = local.get('hub', 'id');
    if (stored) return stored;
    const roleSession = getStoredRoleSession();
    if (roleSession?.id) {
        local.set('hub', 'id', roleSession.id);
        if (roleSession.role) local.set('hub', 'role', roleSession.role);
        return roleSession.id;
    }
    if (isAdminAuthenticated()) {
        const email = getAdminProfile().email;
        if (email) {
            local.set('hub', 'id', email);
            local.set('hub', 'role', 'admin');
            return email;
        }
    }
    return null;
}
function hasCurrentOwner(module) {
    const owner = currentHubOwner();
    return Boolean(owner && connectionOwner(module) === owner);
}
function setConnectionOwner(module, explicitOwner) {
    const owner = explicitOwner || currentHubOwner();
    if (owner) local.set('hub', `conn.${module}.owner`, owner);
}
function clearConnectionOwner(module) {
    local.remove('hub', `conn.${module}.owner`);
}

/** Push ModuleGate / FinishSetup to re-read after flags change outside connectModule. */
export function refreshModuleConnections() {
    notify();
}

/**
 * Progress link is role-specific. Stale adminLoggedIn beside a worker session (QA: owner
 * `test`) must not count as connected for hub admin — that blanked /progress/admin while
 * useRoleGuard denied and bounced. (Read-only — clear via sanitizeProgressLink.)
 */
function progressConnectedFor(role) {
    if (role === 'worker') return progressWorker.isWorkerAuthenticated();
    if (role === 'manager') return progressManager.isManagerAuthenticated();
    if (role === 'admin') {
        if (!progressAdmin.isAdminAuthenticated()) return false;
        if (!local.get('progress', 'adminEmail')) return false;
        // Worker session from a prior device link must not keep admin "connected".
        if (progressWorker.isWorkerAuthenticated()) return false;
        return true;
    }
    return false;
}

/**
 * Clear contradictory Progress flags (call from effects / deny paths — not during render).
 */
export function sanitizeProgressLink(hubRole) {
    const role = moduleRoleFor(hubRole, 'progress');
    if (!role) return;
    let changed = false;
    if (role === 'admin') {
        if (progressAdmin.isAdminAuthenticated() && (!local.get('progress', 'adminEmail') || progressWorker.isWorkerAuthenticated())) {
            progressAdmin.clearAdminFlags();
            changed = true;
        }
    } else if (role === 'manager') {
        if (progressManager.isManagerAuthenticated() && progressWorker.isWorkerAuthenticated()) {
            progressWorker.clearWorkerSession();
            changed = true;
        }
    } else if (role === 'worker') {
        if (progressWorker.isWorkerAuthenticated() && progressAdmin.isAdminAuthenticated()) {
            progressAdmin.clearAdminFlags();
            changed = true;
        }
    }
    if (changed) {
        clearConnectionOwner('progress');
        notify();
    }
}

/**
 * @returns {'connected' | 'disconnected' | 'unavailable' | 'not-configured'}
 */
export function moduleConnection(hubRole, module) {
    if (module === 'timesheet') return 'connected';
    const role = moduleRoleFor(hubRole, module);
    if (!role) return 'unavailable';
    if (!isBackendConfigured(module)) return 'not-configured';
    // One backend: an admin switches each area on/off per worker (core.worker_access).
    if (UNIFIED && role === 'worker') {
        const access = local.getJSON('hub', 'access');
        if (access && access.owner === currentHubOwner() && access[module] === false) return 'unavailable';
    }
    // Old links without an owner marker intentionally reconnect once. It is safer than
    // allowing a newly signed-in person to use the previous person's persisted session.
    if (!hasCurrentOwner(module)) return 'disconnected';

    if (module === 'materials') {
        if (role === 'worker') return materials.getWorkerSession() ? 'connected' : 'disconnected';
        // staffMarker is set synchronously on connect; sb-auth can lag one tick behind.
        return (
            staffMarker('materials') === role &&
            (materials.hasStoredStaffSession() || materials.hasLocalStaffFlags())
        )
            ? 'connected'
            : 'disconnected';
    }
    if (module === 'progress') {
        return progressConnectedFor(role) ? 'connected' : 'disconnected';
    }
    return 'disconnected';
}

/** Worker area access on the one backend ({ materials, progress }) or null when unknown. */
export function getWorkerAccess() {
    if (!UNIFIED) return null;
    const access = local.getJSON('hub', 'access');
    return access && access.owner === currentHubOwner() ? access : null;
}

export function useWorkerAccess() {
    useSyncExternalStore(subscribe, () => version, () => version);
    return getWorkerAccess();
}

export function useModuleConnection(hubRole, module) {
    useSyncExternalStore(subscribe, () => version, () => version);
    return moduleConnection(hubRole, module);
}

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

/**
 * Sign in to one module's backend.
 * @param {{ hubRole: string, module: 'materials'|'progress', id?: string, email?: string, password: string }} args
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function connectModule({ hubRole, module, id, email, password }) {
    const role = moduleRoleFor(hubRole, module);
    if (!role) return { ok: false, error: 'This module is not part of your role yet.' };
    if (!isBackendConfigured(module)) return { ok: false, error: 'This module’s server is not configured.' };

    try {
        // Drop a previous role's link on this device before writing the new one (role hop).
        if (module === 'materials' && role !== 'worker') {
            const prev = staffMarker('materials');
            if (prev && prev !== role) {
                await materials.signOutStaff().catch(() => {});
                local.remove('hub', 'conn.materials');
                clearConnectionOwner('materials');
            }
        }
        if (module === 'progress') {
            const prevOwner = connectionOwner('progress');
            const owner = currentHubOwner();
            if (prevOwner && owner && prevOwner !== owner) {
                await disconnectModule('progress');
            } else {
                // Same hub user, role-hop / reconnect: drop other Progress portal sessions
                // but keep Export Only (another tab may still be on the client portal).
                if (role !== 'worker') await progressWorker.signOutWorker().catch(() => {});
                if (role !== 'manager') await progressManager.signOutManager().catch(() => {});
                // Fresh flags written by signInAdmin / left cleared for worker|manager.
                progressAdmin.clearAdminFlags();
            }
        }

        let result;
        const loginId = (email || id || '').trim();
        if (module === 'materials') {
            result =
                role === 'worker'
                    ? await materials.signInRequester({ requesterId: id, password })
                    : await materials.signInStaff({ email: loginId, password, role });
            if (result.ok && role !== 'worker') setStaffMarker('materials', role);
        } else if (module === 'progress') {
            if (role === 'worker') result = await progressWorker.signInWorker({ employeeCode: id, password });
            else if (role === 'manager') result = await progressManager.signInManager({ loginId, password });
            else result = await progressAdmin.signInAdmin({ email: loginId, password });
        }
        if (result?.ok) {
            // Prefer the credentials just used when hub.id was still empty.
            const ownerHint = currentHubOwner() || loginId || id || null;
            if (ownerHint && !local.get('hub', 'id')) local.set('hub', 'id', ownerHint);
            setConnectionOwner(module, ownerHint);
            if (!hasCurrentOwner(module)) setConnectionOwner(module, ownerHint);
            // Push: register this phone with the module just linked (no-op on web / when disabled).
            import('@/core/push')
                .then((push) => {
                    if (module === 'materials' && role === 'worker') push.setPendingWorkerPassword(password);
                    return push.registerPushDevice();
                })
                .catch(() => {});
        }
        notify();
        return result?.ok ? { ok: true } : { ok: false, error: result?.error || 'Could not sign in.' };
    } catch (error) {
        return { ok: false, error: error?.message || 'Could not reach the server.' };
    }
}

/**
 * One backend, workers: the hub (Attendance) session token opens Materials and Site photos
 * when the worker's access is on — no second login, works after face / fingerprint sign-in too.
 * Safe to call often (app start, area screens); resolves to the access object or null.
 */
let linking = null;
export function linkHubWorker() {
    if (!UNIFIED) return Promise.resolve(null);
    if (linking) return linking;
    linking = (async () => {
        const session = getStoredRoleSession();
        const token = getRoleSessionToken();
        if (session?.role !== 'worker' || !token) return null;
        const { data, error } = await supabaseCore.rpc('my_access', { p_session_token: token });
        if (error) throw error;
        if (!data) return null; // session ended — the hub's own guard signs the worker out
        const owner = currentHubOwner() || session.id;
        local.setJSON('hub', 'access', { ...data, owner });
        if (data.materials) {
            materials.setWorkerSession({ workerId: data.employee_id, workerName: session.name, token });
            setConnectionOwner('materials', owner);
        } else if (materials.getWorkerSession()?.token === token) {
            materials.clearWorkerSession();
        }
        if (data.progress) {
            progressWorker.adoptHubSession(token, { name: session.name, employeeCode: data.employee_id });
            setConnectionOwner('progress', owner);
        } else if (progressWorker.getWorkerSessionToken() === token) {
            progressWorker.clearWorkerSession();
        }
        notify();
        return data;
    })()
        .catch(() => null)
        .finally(() => {
            linking = null;
        });
    return linking;
}

/**
 * Best-effort silent connect of every module after a hub password sign-in.
 * Never throws; resolves to { materials: 'connected'|'failed'|'skipped', progress: … }.
 */
export async function autoConnectModules({ hubRole, id, email, password }) {
    if (UNIFIED && hubRole === 'worker') {
        const access = await linkHubWorker();
        const outcome = {
            materials: access?.materials ? 'connected' : 'skipped',
            progress: access?.progress ? 'connected' : 'skipped',
        };
        local.setJSON('hub', 'lastAutoConnect', { at: Date.now(), outcome });
        return outcome;
    }
    const outcome = {};
    await Promise.all(
        ['materials', 'progress'].map(async (module) => {
            const status = moduleConnection(hubRole, module);
            if (status === 'connected') {
                outcome[module] = 'connected';
                return;
            }
            if (status !== 'disconnected' || !password) {
                outcome[module] = 'skipped';
                return;
            }
            const res = await connectModule({ hubRole, module, id, email, password });
            outcome[module] = res.ok ? 'connected' : 'failed';
        }),
    );
    // Materials workers: endpoint needs the password once. Hand it over on hub password
    // sign-in when Materials is already linked (connectModule already covers fresh link).
    // Silent app restart has no password → skips Materials register by design.
    if (
        password &&
        moduleRoleFor(hubRole, 'materials') === 'worker' &&
        moduleConnection(hubRole, 'materials') === 'connected'
    ) {
        import('@/core/push')
            .then((push) => {
                push.setPendingWorkerPassword(password);
                return push.registerPushDevice();
            })
            .catch(() => {});
    }
    local.setJSON('hub', 'lastAutoConnect', { at: Date.now(), outcome });
    return outcome;
}

/* ------------------------------------------------------------------ */
/* Disconnect                                                          */
/* ------------------------------------------------------------------ */

export async function disconnectModule(module) {
    const tasks = [];
    if (module === 'materials') {
        materials.clearWorkerSession();
        tasks.push(materials.signOutStaff());
        local.remove('hub', 'conn.materials');
        clearConnectionOwner('materials');
    }
    if (module === 'progress') {
        tasks.push(progressWorker.signOutWorker());
        tasks.push(progressManager.signOutManager());
        tasks.push(progressAdmin.signOutAdmin());
        tasks.push(progressExporter.signOutExporter());
        clearConnectionOwner('progress');
    }
    await Promise.allSettled(tasks);
    notify();
}

export async function disconnectAllModules() {
    await Promise.allSettled([disconnectModule('materials'), disconnectModule('progress')]);
}
