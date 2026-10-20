/**
 * Warm the code for each role's main screens while the user is on the home screen, so the
 * first tap on a tab doesn't wait for a chunk download.
 */
import { prefetchModulePage } from '@/app/modulePage';

const ROLE_SCREENS = {
    worker: [
        ['materials', 'RequestPortal'],
        ['progress', 'SubmitProgress'],
        ['timesheet', 'ShiftHistory'],
        ['timesheet', 'LeaveHistory'],
    ],
    supervisor: [['timesheet', 'SupervisorDashboard']],
    manager: [
        ['timesheet', 'ManagerDashboard'],
        ['materials', 'ManagerDashboard'],
        ['progress', 'ManagerDashboard'],
    ],
    admin: [
        ['timesheet', 'AdminDashboard'],
        ['materials', 'AdminDashboard'],
        ['progress', 'AdminDashboard'],
    ],
};

const done = new Set();

function canBackgroundPrefetch() {
    if (typeof window === 'undefined' || document.hidden) return false;

    // On phones, parsing a legacy dashboard in the background competes with the first
    // interactive paint. The route still loads immediately when the employee chooses it.
    if (!window.matchMedia('(min-width: 1024px)').matches) return false;

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(^|-)2g/.test(connection?.effectiveType || '')) return false;

    // Chromium exposes this on the Android devices most affected by background parsing.
    const memory = Number(navigator.deviceMemory);
    return !Number.isFinite(memory) || memory >= 4;
}

const HOME_FOR_PORTAL = {
    employee: () => import('@/pages/employee/EmployeeHome'),
    management: () => import('@/pages/hubs/RoleHome'),
    admin: () => import('@/pages/hubs/RoleHome'),
};

/**
 * On a sign-in screen: warm the hub shell and that portal's home while the person types, so
 * the screen behind the login curtain is ready the moment the password is accepted. Small
 * chunks, so this runs on phones too.
 */
export function prefetchPortalHome(portal) {
    if (typeof window === 'undefined') return undefined;
    const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 600));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(
        () => {
            import('@/ui/hub/HubLayout');
            HOME_FOR_PORTAL[portal]?.();
        },
        { timeout: 2500 }
    );
    return () => cancelIdle(handle);
}

export function prefetchRoleScreens(role) {
    if (!role || done.has(role) || !canBackgroundPrefetch()) return undefined;
    done.add(role);
    const list = ROLE_SCREENS[role] || [];
    const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 1200));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    // One at a time so prefetching never competes with what the user is doing.
    let i = 0;
    let cancelled = false;
    let handle = null;
    const next = () => {
        if (cancelled || document.hidden) return;
        if (i >= list.length) return;
        const [module, name] = list[i++];
        prefetchModulePage(module, name);
        handle = idle(next, { timeout: 4000 });
    };
    handle = idle(next, { timeout: 4000 });

    // A sign-out or role change should not keep downloading dashboard code in the background.
    return () => {
        cancelled = true;
        if (handle != null) cancelIdle(handle);
    };
}
