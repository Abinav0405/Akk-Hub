/**
 * Hub identity — "who is signed in to AKK Hub, and as what".
 *
 * The hub sign-in is the Timesheet Manager sign-in (decision 2026-10-20): workers
 * (foreign/local), supervisors, managers and admins all come from that project. Material
 * Tracker and Site Progress keep their own sessions for now; see bridges.js.
 *
 * useIdentity() is reactive: any sign-in / sign-out / server re-bind calls notifyIdentity().
 */
import { useSyncExternalStore } from 'react';
import { local, clearModuleStorage } from '@/core/storage';
import {
    getAdminProfile,
    getStoredRoleSession,
    isAdminAuthenticated,
    revokeRoleSession,
    signOutAdmin,
    verifyAdminSession,
    verifyRoleSession,
} from '@/core/auth/timesheetSession';

export const HUB_ROLES = ['worker', 'supervisor', 'manager', 'admin'];

export const ROLE_LABELS = {
    worker: 'Employee',
    supervisor: 'Supervisor',
    manager: 'Manager',
    admin: 'Admin',
};

export const HOME_PATHS = {
    worker: '/me',
    supervisor: '/site',
    manager: '/manage',
    admin: '/admin',
};

export function homePathFor(role) {
    return HOME_PATHS[role] || '/';
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const listeners = new Set();
let snapshot;
let snapshotKey;

function computeIdentity() {
    const roleSession = getStoredRoleSession();
    if (roleSession) {
        return {
            role: roleSession.role,
            id: roleSession.id,
            name: roleSession.name || roleSession.id,
            workerType: roleSession.workerType || null,
            siteId: roleSession.siteId || null,
            email: roleSession.role === 'manager' ? roleSession.id : null,
        };
    }
    if (isAdminAuthenticated()) {
        const p = getAdminProfile();
        return { role: 'admin', id: p.email, name: p.name, email: p.email, workerType: null, siteId: null };
    }
    return null;
}

function readSnapshot() {
    const next = computeIdentity();
    const key = next ? JSON.stringify(next) : '';
    if (key !== snapshotKey) {
        snapshotKey = key;
        snapshot = next;
        local.set('hub', 'role', next?.role ?? null);
        // Module links are scoped to this hub account by bridges.js. Keeping the stable
        // subject alongside the role prevents a second person on a shared device from
        // inheriting a still-persisted Materials or Site Progress session.
        local.set('hub', 'id', next?.id ?? null);
        // Survives sign-out / expiry so the sign-in screen reopens on the right tab.
        if (next?.role) local.set('hub', 'lastRole', next.role);
    }
    return snapshot;
}

export function getIdentity() {
    return readSnapshot();
}

export function notifyIdentity() {
    readSnapshot();
    listeners.forEach((fn) => fn());
}

function subscribe(fn) {
    listeners.add(fn);
    const onStorage = (e) => {
        if (!e.key || e.key.startsWith('akk.timesheet.')) fn();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(fn);
        window.removeEventListener('storage', onStorage);
    };
}

export function useIdentity() {
    return useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
}

/* ------------------------------------------------------------------ */
/* Server verification                                                 */
/* ------------------------------------------------------------------ */

/**
 * Re-check the stored session with the server.
 * @returns {Promise<'ok' | 'denied' | 'offline'>}
 */
export async function verifyIdentity(expectedRoles) {
    const current = readSnapshot();
    if (!current) return 'denied';
    if (expectedRoles && !expectedRoles.includes(current.role)) return 'denied';

    if (current.role === 'admin') {
        const ok = await verifyAdminSession();
        notifyIdentity();
        return ok ? 'ok' : 'denied';
    }
    const row = await verifyRoleSession({ keepOnNetworkError: true });
    notifyIdentity();
    if (row?.networkError) return 'offline';
    if (row?.role && (!expectedRoles || expectedRoles.includes(row.role))) return 'ok';
    return 'denied';
}

/* ------------------------------------------------------------------ */
/* Sign out (everything)                                               */
/* ------------------------------------------------------------------ */

export async function signOutEverywhere() {
    const current = readSnapshot();
    const tasks = [];
    if (current?.role === 'admin') tasks.push(signOutAdmin());
    else tasks.push(revokeRoleSession());

    // Module sessions — imported lazily so the sign-in screen doesn't pull them in.
    tasks.push(
        import('@/core/auth/bridges').then((m) => m.disconnectAllModules()).catch(() => {}),
    );
    await Promise.allSettled(tasks);

    // Keep convenience prefs (last worker id/type, biometric prefs, language) — clear the rest.
    clearModuleStorage('timesheet', { keep: ['lastWorkerId', 'lastWorkerType'] });
    local.remove('hub', 'role');
    notifyIdentity();
}
