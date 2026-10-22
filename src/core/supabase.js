/**
 * Interim backend: one Supabase client per source project.
 *
 *   supabaseTimesheet — Timesheet Manager project (also the hub sign-in)
 *   supabaseMaterials — Material Tracker project
 *   supabaseProgress  — Site Progress Tracker project (shared with AKK Camera)
 *
 * Each client gets its own auth storage key, so three Supabase Auth sessions (e.g. an
 * admin signed in to all three projects) never overwrite each other.
 * When the single AKK Hub project exists, all three point at it and this file is the only
 * place that changes.
 *
 * Always uses the real @supabase/supabase-js client and live project URLs/keys from env.
 * No mock / fake fetch layer.
 */
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

/**
 * Switching a browser / phone from the three old projects to the one AKK Hub backend (or back):
 * the Materials and Site-work sign-ins saved for the OLD backend mean nothing to the new one and
 * would make every request fail with "not authenticated" while the screens still look signed in.
 * Drop them once, when the backend changes; the area then asks the person to sign in again.
 */
(function resetSessionsOfPreviousBackend() {
    try {
        const marker = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? env.VITE_SUPABASE_URL : 'legacy';
        const key = 'akk.hub.backend';
        if (localStorage.getItem(key) === marker) return;
        const prefixes = ['akk.materials.', 'akk.progress.', 'akk.hub.conn', 'akk.hub.access', 'akk.hub.lastAutoConnect'];
        // Attendance / admin JWT from the previous backend must not be reused — wrong project
        // or pre-UNIFIED storage key would look "signed in" then blank the shell on verify.
        const exact = [
            'akk.timesheet.sb-auth',
            'akk.hub.timesheet.sb-auth',
            'akk.timesheet.adminLoggedIn',
            'akk.timesheet.adminEmail',
            'akk.timesheet.adminName',
            'akk.hub.authKeyMigration',
        ];
        for (const store of [localStorage, sessionStorage]) {
            const doomed = [];
            for (let i = 0; i < store.length; i += 1) {
                const k = store.key(i);
                if (k && prefixes.some((p) => k.startsWith(p))) doomed.push(k);
            }
            doomed.forEach((k) => store.removeItem(k));
            exact.forEach((k) => store.removeItem(k));
        }
        localStorage.setItem(key, marker);
    } catch {
        /* storage blocked — nothing to clean */
    }
})();

/**
 * UNIFIED clients read `akk.hub.<area>.sb-auth`; pre-UNIFIED builds wrote `akk.<area>.sb-auth`.
 * Without this copy, admin markers stay true while getSession() finds no JWT → guard denies →
 * LoginPage still sees identity → /admin ↔ /login loop → blank shell outlet (white screen).
 * Must run before createClient below.
 */
(function migrateLegacyAuthStorageToHubKeys() {
    try {
        if (!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY)) return;
        const flag = 'akk.hub.authKeyMigration';
        if (localStorage.getItem(flag) === 'hub-v1') return;
        for (const name of ['timesheet', 'materials', 'progress']) {
            const legacy = `akk.${name}.sb-auth`;
            const hub = `akk.hub.${name}.sb-auth`;
            for (const store of [localStorage, sessionStorage]) {
                const from = store.getItem(legacy);
                if (from && !store.getItem(hub)) store.setItem(hub, from);
            }
        }
        localStorage.setItem(flag, 'hub-v1');
    } catch {
        /* storage blocked — clients will treat session as missing */
    }
})();

/** Always false — mock backend removed; kept so accidental imports stay off. */
export const DEV_MOCK = false;

/**
 * One AKK Hub backend: set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. Every area then talks to
 * the same project, each in its own schema (same table and function names as before). The three
 * clients keep separate sign-in storage so staff logins behave exactly as they did.
 * Without those two values the build falls back to the three old projects.
 */
export const UNIFIED = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
export const DB_SCHEMA = UNIFIED
    ? { timesheet: 'attendance', materials: 'materials', progress: 'progress' }
    : { timesheet: 'public', materials: 'public', progress: 'public' };

function makeClient(name, url, anonKey) {
    if (UNIFIED) {
        url = env.VITE_SUPABASE_URL;
        anonKey = env.VITE_SUPABASE_ANON_KEY;
    }
    if (!url || !anonKey) {
        console.warn(
            `[supabase:${name}] VITE_${name.toUpperCase()}_SUPABASE_URL / _ANON_KEY are not set. ` +
                'Copy .env.example to .env and fill them in.',
        );
    }
    // createClient throws on an empty URL; a placeholder keeps the UI bootable without a .env.
    return createClient(url || `https://${name}.invalid.supabase.co`, anonKey || 'missing-anon-key', {
        db: { schema: DB_SCHEMA[name] },
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: name === 'timesheet',
            storageKey: UNIFIED ? `akk.hub.${name}.sb-auth` : `akk.${name}.sb-auth`,
        },
    });
}

export const supabaseTimesheet = makeClient(
    'timesheet',
    env.VITE_TIMESHEET_SUPABASE_URL,
    env.VITE_TIMESHEET_SUPABASE_ANON_KEY,
);

export const supabaseMaterials = makeClient(
    'materials',
    env.VITE_MATERIALS_SUPABASE_URL,
    env.VITE_MATERIALS_SUPABASE_ANON_KEY,
);

export const supabaseProgress = makeClient(
    'progress',
    env.VITE_PROGRESS_SUPABASE_URL,
    env.VITE_PROGRESS_SUPABASE_ANON_KEY,
);

/**
 * Hub-wide functions (worker access, places, admin worker details). Uses the Attendance
 * client's sign-in, so admin calls carry the admin's session. null on the old 3-project setup.
 */
export const supabaseCore = UNIFIED ? supabaseTimesheet.schema('core') : null;

export const supabaseClients = {
    timesheet: supabaseTimesheet,
    materials: supabaseMaterials,
    progress: supabaseProgress,
};

/** True when a module's project URL + key are configured. */
export function isBackendConfigured(module) {
    if (UNIFIED) return true;
    const prefix = { timesheet: 'TIMESHEET', materials: 'MATERIALS', progress: 'PROGRESS' }[module];
    return Boolean(prefix && env[`VITE_${prefix}_SUPABASE_URL`] && env[`VITE_${prefix}_SUPABASE_ANON_KEY`]);
}

let initialProgressAuth;

/**
 * Site Progress Tracker: wait until its Supabase client has finished the first storage
 * recovery (admin pages read the JWT right after load). Kept under the SPT name so ported
 * code (`import { waitForInitialAuthSession } from '@/core/supabase'`) works unchanged.
 */
export function waitForInitialAuthSession() {
    if (!initialProgressAuth) {
        initialProgressAuth = supabaseProgress.auth
            .getSession()
            .then(({ data }) => data?.session ?? null)
            .catch(() => null);
    }
    return initialProgressAuth;
}

/** Edge function names: one project hosts all of them, so on the unified backend they carry an area prefix. */
export const FN = {
    registerAttendance: UNIFIED ? 'att-register-device-token' : 'register-device-token',
    registerMaterials: UNIFIED ? 'mat-register-device-token' : 'register-device-token',
    manageStaff: UNIFIED ? 'mat-manage-staff' : 'manage-staff',
};
