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

/** Always false — mock backend removed; kept so accidental imports stay off. */
export const DEV_MOCK = false;

function makeClient(name, url, anonKey) {
    if (!url || !anonKey) {
        console.warn(
            `[supabase:${name}] VITE_${name.toUpperCase()}_SUPABASE_URL / _ANON_KEY are not set. ` +
                'Copy .env.example to .env and fill them in.',
        );
    }
    // createClient throws on an empty URL; a placeholder keeps the UI bootable without a .env.
    return createClient(url || `https://${name}.invalid.supabase.co`, anonKey || 'missing-anon-key', {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: name === 'timesheet',
            storageKey: `akk.${name}.sb-auth`,
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

export const supabaseClients = {
    timesheet: supabaseTimesheet,
    materials: supabaseMaterials,
    progress: supabaseProgress,
};

/** True when a module's project URL + key are configured. */
export function isBackendConfigured(module) {
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
