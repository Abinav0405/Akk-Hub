/**
 * Shared hand-off after any successful hub sign-in:
 *   1. refresh the hub identity,
 *   2. quietly connect Material Tracker / Site Progress with the same credentials,
 *   3. raise the login curtain and change page underneath it (the guard lowers it).
 */
import { notifyIdentity, homePathFor } from '@/core/auth/identity';
import { startLoginCurtain } from '@/core/auth/loginCurtain';
import { getPostLoginRedirect } from '@/core/auth/timesheetSession';

export function finishHubLogin({ navigate, location, role, name, curtain = 'welcome', connect }) {
    notifyIdentity();
    if (role === 'worker') {
        // One backend: the worker's session opens every area they have access to (no password needed).
        import('@/core/auth/bridges')
            .then((m) => m.linkHubWorker())
            .catch(() => {});
    }
    if (connect?.password) {
        // Fire and forget — module screens show a Connect card for anything that didn't link.
        import('@/core/auth/bridges')
            .then((m) => m.autoConnectModules({ hubRole: role, ...connect }))
            .catch(() => {});
    }
    startLoginCurtain({ variant: curtain, name: name || '' });
    navigate(getPostLoginRedirect(location, homePathFor(role)), { replace: true });
}
