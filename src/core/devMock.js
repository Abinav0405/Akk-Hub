/**
 * DISABLED — do not re-enable.
 *
 * A prior QA helper replaced every Supabase client with an in-browser fake (`?mock=1` +
 * sessionStorage `akk.hub.mock`). Product requirement: Hub always uses the real
 * `@/core/supabase` clients and live DB. This file remains only so stale imports do not
 * break the build; every export is hard-off.
 */

/** Always false. Mock mode must never turn on. */
export function isDevMock() {
    return false;
}

/** No-op stub — never inject as `global.fetch`. */
export function createMockFetch() {
    throw new Error('[AKK Hub] Mock backend is disabled. Use the real Supabase client from @/core/supabase.');
}
