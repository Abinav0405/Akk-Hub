/**
 * Which Site Progress portal this screen is serving — decides which credential the shared
 * SPT RPCs receive (manager token, exporter token, or the admin JWT).
 *
 * In the source app this was read from the old page names. In the hub it comes from the
 * route (`/progress/admin`, `/progress/review`, `/progress/client`, `/progress/submit`…), then
 * falls back to the hub role of whoever is signed in.
 */
import { getManagerSessionToken, isManagerAuthenticated } from '@/core/auth/progress/managerSession';
import { getExporterSessionToken, isExporterAuthenticated } from '@/core/auth/progress/exporterSession';
import { isAdminAuthenticated } from '@/core/auth/progress/adminSession';
import { local } from '@/core/storage';

const HUB_ROLE_TO_PORTAL = {
    admin: 'admin',
    manager: 'manager',
    supervisor: 'manager',
    worker: 'worker',
    exporter: 'exporter',
};

export function activePortalRole() {
    if (typeof window === 'undefined') return null;
    try {
        const params = new URLSearchParams(window.location.search);
        const roleParam = String(params.get('role') || '').trim().toLowerCase();
        if (['admin', 'manager', 'exporter', 'worker'].includes(roleParam)) return roleParam;

        const path = (window.location.pathname || '').toLowerCase();
        if (path.startsWith('/progress/admin') || path.startsWith('/admin')) return 'admin';
        if (path.startsWith('/progress/review') || path.startsWith('/manage')) return 'manager';
        if (path.startsWith('/progress/client') || path.startsWith('/client')) return 'exporter';
        if (path.startsWith('/progress/submit') || path.startsWith('/progress/submissions') || path.startsWith('/me')) {
            return 'worker';
        }

        const hubRole = local.get('hub', 'role');
        return HUB_ROLE_TO_PORTAL[hubRole] || null;
    } catch {
        return null;
    }
}

/** Manager session token only when this screen is the Manager portal. */
export function portalManagerToken() {
    const portal = activePortalRole();
    if (portal === 'admin' || portal === 'exporter' || portal === 'worker') return null;
    if (portal === 'manager') return getManagerSessionToken() || null;
    if (isAdminAuthenticated()) return null;
    return getManagerSessionToken() || null;
}

/** Export Only session token only when this screen is the client portal. */
export function portalExporterToken() {
    const portal = activePortalRole();
    if (portal === 'admin' || portal === 'manager' || portal === 'worker') return null;
    if (portal === 'exporter') return getExporterSessionToken() || null;
    if (isExporterAuthenticated() && !isManagerAuthenticated() && !isAdminAuthenticated()) {
        return getExporterSessionToken() || null;
    }
    return null;
}
