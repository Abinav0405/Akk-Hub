/**
 * Push notifications — placeholder until the backend is merged.
 *
 * Each source app registered FCM tokens with its own Firebase project and edge functions.
 * The hub will have one Firebase project and one `register-device-token` function; until
 * then these are safe no-ops so sign-out paths can call them.
 */
export async function registerPushDevice() {
    return false;
}

export async function unregisterPushDevice() {
    return false;
}

/** Material Tracker name for the same thing. */
export const unregisterPushToken = unregisterPushDevice;

/** Site Progress names. */
export const registerPushForCurrentSession = registerPushDevice;

/** Material Tracker native login helpers (no-ops until hub push exists). */
export function setPendingWorkerPassword() {}
export function schedulePushRegistrationAfterLogin() {}
