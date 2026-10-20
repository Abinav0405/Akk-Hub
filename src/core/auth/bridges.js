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
import { getAdminProfile, getStoredRoleSession, isAdminAuthenticated } from '@/core/auth/timesheetSession';
import * as materials from '@/core/auth/materialsSession';
import * as progressWorker from '@/core/auth/progress/workerSession';
import * as progressManager from '@/core/auth/progress/managerSession';
import * as progressAdmin from '@/core/auth/progress/adminSession';
import * as progressExporter from '@/core/auth/progress/exporterSession';
import { isBackendConfigured } from '@/core/supabase';

export const MODULES = ['timesheet', 'materials', 'progress'];

export const MODULE_LABELS = {
    timesheet: 'Timesheet',
    materials: 'Material Tracker',
    progress: 'Site Progress',
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
function setConnectionOwner(module) {
    const owner = currentHubOwner();
    if (owner) local.set('hub', `conn.${module}.owner`, owner);
}
function clearConnectionOwner(module) {
    local.remove('hub', `conn.${module}.owner`);
}

/**
 * @returns {'connected' | 'disconnected' | 'unavailable' | 'not-configured'}
 */
export function moduleConnection(hubRole, module) {
    if (module === 'timesheet') return 'connected';
    const role = moduleRoleFor(hubRole, module);
    if (!role) return 'unavailable';
    if (!isBackendConfigured(module)) return 'not-configured';
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
        if (role === 'worker') return progressWorker.isWorkerAuthenticated() ? 'connected' : 'disconnected';
        if (role === 'manager') return progressManager.isManagerAuthenticated() ? 'connected' : 'disconnected';
        if (role === 'admin') return progressAdmin.isAdminAuthenticated() ? 'connected' : 'disconnected';
    }
    return 'disconnected';
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
            }
        }

        let result;
        if (module === 'materials') {
            result =
                role === 'worker'
                    ? await materials.signInRequester({ requesterId: id, password })
                    : await materials.signInStaff({ email: email || id, password, role });
            if (result.ok && role !== 'worker') setStaffMarker('materials', role);
        } else if (module === 'progress') {
            if (role === 'worker') result = await progressWorker.signInWorker({ employeeCode: id, password });
            else if (role === 'manager') result = await progressManager.signInManager({ loginId: email || id, password });
            else result = await progressAdmin.signInAdmin({ email: email || id, password });
        }
        if (result?.ok) {
            setConnectionOwner(module);
            // Owner stamp can fail if hub.id was empty; retry once from live identity.
            if (!hasCurrentOwner(module)) setConnectionOwner(module);
        }
        notify();
        return result?.ok ? { ok: true } : { ok: false, error: result?.error || 'Could not sign in.' };
    } catch (error) {
        return { ok: false, error: error?.message || 'Could not reach the server.' };
    }
}

/**
 * Best-effort silent connect of every module after a hub password sign-in.
 * Never throws; resolves to { materials: 'connected'|'failed'|'skipped', progress: … }.
 */
export async function autoConnectModules({ hubRole, id, email, password }) {
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
