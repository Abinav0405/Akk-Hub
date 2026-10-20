/**
 * Admin destructive-action PIN (UX friction only — NOT a security secret).
 *
 * Set in the project root `.env` file:
 *   VITE_ADMIN_DELETE_PIN=your-pin-here
 *
 * Template: see `.env.example` in the repo root.
 * Restart `npm run dev` after changing `.env`.
 *
 * SECURITY: VITE_* values ship in the client JS bundle and are readable in the
 * browser. This PIN is intentionally NOT treated as authorization. Destructive
 * deletes must also require a valid admin Supabase Auth session (JWT with
 * app_metadata.role = admin). If the PIN is unset, deletes are blocked.
 *
 * Long-term: move destructive deletes behind an Edge Function that verifies the
 * admin JWT server-side (service role).
 */

let warnedMissingPin = false;

export function getAdminDeletePin() {
    const pin = import.meta.env.VITE_ADMIN_DELETE_PIN;
    if ((typeof pin !== 'string' || !pin.trim()) && !warnedMissingPin) {
        warnedMissingPin = true;
        console.warn(
            '[adminConfig] VITE_ADMIN_DELETE_PIN is not set. Destructive admin actions ' +
                '(delete shift / bulk delete / delete worker) will be blocked until it is configured in .env. ' +
                'Note: this PIN is UX friction only, not a secret.',
        );
    }
    return typeof pin === 'string' ? pin.trim() : '';
}

export function isAdminDeletePinConfigured() {
    return getAdminDeletePin().length > 0;
}

export function verifyAdminDeletePin(input) {
    const expected = getAdminDeletePin();
    if (!expected) return false;
    return String(input ?? '').trim() === expected;
}
