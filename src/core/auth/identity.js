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
import { UNIFIED, signOutThisDevice, supabaseTimesheet } from '@/core/supabase';
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

/** "worker:1018" — per-account keys for device-only state (e.g. unread badges). */
export function accountKey(identity) {
    if (!identity?.role) return null;
    return `${identity.role}:${String(identity.id || identity.email || identity.name || '').trim().toLowerCase()}`;
}

/*
 * Saved-account switching was removed (2026-10-30): one person per phone, sign out to change.
 * Drop any sessions a test build saved on this device so no other person's sign-in lingers.
 */
try {
    localStorage.removeItem('akk.hub.accounts');
} catch {
    /* storage blocked */
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
        const id = roleSession.id || null;
        return {
            role: roleSession.role,
            id,
            name: roleSession.name || id || roleSession.role,
            workerType: roleSession.workerType || null,
            siteId: roleSession.siteId || null,
            email: roleSession.role === 'manager' ? id : null,
        };
    }
    if (isAdminAuthenticated()) {
        const p = getAdminProfile();
        // Never leave akk.hub.id empty for a signed-in admin — bridges owner checks need it.
        const id = p.email || local.get('hub', 'id') || local.get('hub', 'lastAdminId') || null;
        return {
            role: 'admin',
            id,
            name: p.name || id || 'Admin',
            email: p.email || id,
            workerType: null,
            siteId: null,
        };
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
        // Only write id when we have one — never wipe a good stamp with null mid-flight.
        if (next?.id) {
            local.set('hub', 'id', next.id);
            if (next.role === 'admin') local.set('hub', 'lastAdminId', next.id);
        } else if (!next) {
            local.remove('hub', 'id');
        }
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
        const result = await verifyAdminSession();
        notifyIdentity();
        if (result === true) return 'ok';
        if (result === 'offline') return 'offline';
        return 'denied';
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
    // Stop push to this phone first — the back-ends need the still-valid sessions to remove it.
    await import('@/core/push').then((push) => push.unregisterPushDevice()).catch(() => {});
    const tasks = [];
    if (current?.role === 'admin') tasks.push(signOutAdmin());
    else tasks.push(revokeRoleSession());

    // Module sessions — imported lazily so the sign-in screen doesn't pull them in.
    tasks.push(
        import('@/core/auth/bridges').then((m) => m.disconnectAllModules()).catch(() => {}),
    );
    await Promise.allSettled(tasks);
    // One backend: the areas share one sign-in (a manager's Materials login too) — end it here, this device only.
    if (UNIFIED) await signOutThisDevice(supabaseTimesheet).catch(() => {});

    // Keep convenience prefs (last worker id/type, biometric prefs, language) — clear the rest.
    clearModuleStorage('timesheet', { keep: ['lastWorkerId', 'lastWorkerType'] });
    local.remove('hub', 'role');
    local.remove('hub', 'id');
    local.remove('hub', 'lastAdminId');
    notifyIdentity();
}
