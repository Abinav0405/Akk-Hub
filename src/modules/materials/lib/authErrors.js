/**
 * Readable sign-in error messages for the native app. Never includes the
 * submitted credentials or raw server details.
 */

export function isNetworkError(error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) return true;
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('load failed') ||
        message.includes('timeout')
    );
}

export function describeLoginError(error, fallback) {
    if (isNetworkError(error)) {
        return 'Can’t reach the server. Check your connection and try again.';
    }
    const status = Number(error?.status) || 0;
    if (status === 429) return 'Too many attempts. Wait a moment, then try again.';
    if (status >= 500) return 'The server is having trouble right now. Please try again shortly.';
    return fallback;
}
