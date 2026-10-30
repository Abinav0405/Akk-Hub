/**
 * Saved accounts on this device — switch between them without signing in again.
 *
 * Every hub / module session lives in this device's storage under `akk.*` (see core/storage.js,
 * timesheetSession.js, materialsSession.js, the shared Supabase key `akk.hub.timesheet.sb-auth`).
 * An account is "added" by signing in to it once; from then on switching just swaps those keys:
 *
 *   1. the active account's session keys are saved into its entry
 *   2. they are cleared from storage
 *   3. the chosen account's saved keys are written back
 *   4. the app reloads on that account's home (fresh Supabase clients, caches and identity)
 *
 * Nothing is revoked server-side when switching, so the saved session stays valid. Device
 * preferences (language, biometric sign-in, intro / onboarding flags, badges seen…) are never
 * swapped. A saved session that has since expired simply lands on sign-in for that account.
 */
import { useSyncExternalStore } from 'react';
import { homePathFor } from '@/core/auth/identity';

const STORE_KEY = 'akk.hub.accounts';
const MAX_ACCOUNTS = 6;

/** Device preferences: stay put when the account changes. */
const DEVICE_PREFS = [
    /^akk\.hub\.accounts$/,
    /^akk\.hub\.(language|introPlayed|introHold|authShared|authKeyMigration|backend|appPreview|chunkReload|permissionsWizardV1|fcmToken|lastRole)$/,
    /^akk\.hub\.(biometricLogin|biometricOfferDeclined|face-login-device|faceLoginDevice)/,
    /^akk\.hub\.(seen|onboarding)\./,
    /^akk\.timesheet\.(lastWorkerId|lastWorkerType|akk_native_permissions_wizard_v1|akk_native_splash_seen|akk_update_prompt_dismissed|logoUrl)$/,
    /^akk\.progress\.(spt_camera_device_id|spt_packageView)$/,
    /^akk\.workers\.view$/,
];

const isSessionKey = (k) => typeof k === 'string' && k.startsWith('akk.') && !DEVICE_PREFS.some((re) => re.test(k));

function stores() {
    const out = [];
    try {
        out.push(['local', window.localStorage]);
    } catch {
        /* blocked */
    }
    try {
        out.push(['session', window.sessionStorage]);
    } catch {
        /* blocked */
    }
    return out;
}

function sessionKeys(store) {
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (isSessionKey(k)) keys.push(k);
    }
    return keys;
}

/** Snapshot of the signed-in account's session keys (both storages). */
function collectSession() {
    const bundle = { local: {}, session: {} };
    for (const [name, store] of stores()) {
        for (const k of sessionKeys(store)) bundle[name][k] = store.getItem(k);
    }
    return bundle;
}

function clearSession() {
    for (const [, store] of stores()) sessionKeys(store).forEach((k) => store.removeItem(k));
}

function applySession(bundle) {
    for (const [name, store] of stores()) {
        Object.entries(bundle?.[name] || {}).forEach(([k, v]) => {
            if (v != null && isSessionKey(k)) store.setItem(k, v);
        });
    }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const listeners = new Set();
let cache = null;

function read() {
    if (cache) return cache;
    try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        cache = Array.isArray(parsed?.accounts) ? parsed : { accounts: [] };
    } catch {
        cache = { accounts: [] };
    }
    return cache;
}

function write(next) {
    cache = next;
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
        /* quota / blocked: switching just won't be offered */
    }
    listeners.forEach((fn) => fn());
}

export function accountKey(identity) {
    if (!identity?.role) return null;
    return `${identity.role}:${String(identity.id || identity.email || identity.name || '').trim().toLowerCase()}`;
}

function summary(identity) {
    return {
        key: accountKey(identity),
        role: identity.role,
        id: identity.id || null,
        name: identity.name || identity.id || identity.role,
        email: identity.email || null,
        workerType: identity.workerType || null,
    };
}

/** Keep the signed-in account in the list (called by the shell whenever identity changes). */
export function rememberAccount(identity) {
    const key = accountKey(identity);
    if (!key) return;
    const { accounts } = read();
    const existing = accounts.find((a) => a.key === key);
    const entry = { ...existing, ...summary(identity), bundle: null, lastUsedAt: Date.now() };
    if (existing && existing.name === entry.name && existing.bundle == null) return;
    write({ accounts: [entry, ...accounts.filter((a) => a.key !== key)].slice(0, MAX_ACCOUNTS) });
}

/** Signing out of the active account forgets it on this device. */
export function forgetAccount(key) {
    if (!key) return;
    const { accounts } = read();
    if (!accounts.some((a) => a.key === key)) return;
    write({ accounts: accounts.filter((a) => a.key !== key) });
}

export function listAccounts() {
    return read().accounts;
}

function subscribe(fn) {
    listeners.add(fn);
    const onStorage = (e) => {
        if (e.key === STORE_KEY) {
            cache = null;
            fn();
        }
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(fn);
        window.removeEventListener('storage', onStorage);
    };
}

export function useSavedAccounts() {
    return useSyncExternalStore(subscribe, listAccounts, listAccounts);
}

/** Saved accounts other than the one signed in now (only these can be switched to). */
export function otherAccounts(accounts, identity) {
    const key = accountKey(identity);
    return accounts.filter((a) => a.key !== key && a.bundle);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Park the signed-in account's session in its entry and clear it from storage. */
function parkActive(identity) {
    const key = accountKey(identity);
    if (!key) return;
    const bundle = collectSession();
    const { accounts } = read();
    const entry = { ...accounts.find((a) => a.key === key), ...summary(identity), bundle, lastUsedAt: Date.now() };
    write({ accounts: [entry, ...accounts.filter((a) => a.key !== key)].slice(0, MAX_ACCOUNTS) });
    clearSession();
}

function reloadTo(path) {
    // A fresh page: new Supabase clients, empty caches, identity read from the swapped storage.
    window.location.replace(path);
}

/** Switch to a saved account. No password; the app reloads on that account's home. */
export function switchAccount(identity, key) {
    const target = read().accounts.find((a) => a.key === key);
    if (!target?.bundle || key === accountKey(identity)) return false;
    parkActive(identity);
    applySession(target.bundle);
    const { accounts } = read();
    write({ accounts: accounts.map((a) => (a.key === key ? { ...a, bundle: null, lastUsedAt: Date.now() } : a)) });
    reloadTo(homePathFor(target.role));
    return true;
}

/** Sign in to another account while keeping this one saved (opens the portal picker). */
export function addAccount(identity) {
    parkActive(identity);
    // Home lists every portal (Employee / Management / Admin); the saved one waits in the dock.
    reloadTo('/');
}

/** From the sign-in screen: go back to a saved account (nobody is signed in right now). */
export function resumeAccount(key) {
    const target = read().accounts.find((a) => a.key === key);
    if (!target?.bundle) return false;
    clearSession();
    applySession(target.bundle);
    const { accounts } = read();
    write({ accounts: accounts.map((a) => (a.key === key ? { ...a, bundle: null, lastUsedAt: Date.now() } : a)) });
    reloadTo(homePathFor(target.role));
    return true;
}

/** Remove a saved (inactive) account from this device. */
export function removeSavedAccount(key) {
    forgetAccount(key);
}
