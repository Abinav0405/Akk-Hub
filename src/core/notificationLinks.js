/**
 * Where a notification tap should land: the exact screen (and item) it is about.
 *
 * Notifications come from three back-ends and some still carry old page names from the source
 * apps ('/AdminDashboard', '/ManagerDashboard', '/MySubmissions', '/me'…). In the hub those names
 * are ambiguous — '/AdminDashboard' is both the Attendance and the Site work dashboard — so the
 * title / package id decide the module, and generic dashboards get the right ?section=.
 *
 *   notificationTarget({ path: '/AdminDashboard', packageId: 'abc', role: 'admin' })
 *     → '/progress/admin?package=abc'
 *
 * Only in-app paths are returned (never a URL from a payload); null when there is nothing to open.
 */
import { legacyPath, paths } from '@/app/paths';

const SITE_WORDS = /package|submission|photo|jsr|claim|invoice|site work|export/i;
const MATERIAL_WORDS = /material|stock|take|return request|request (approved|declined)/i;
const LEAVE_WORDS = /leave/i;
const TIMESHEET_WORDS = /timesheet/i;
const PAYSLIP_WORDS = /payslip/i;

function split(path) {
    const [pathname, query = ''] = String(path).split('?');
    return { pathname, params: new URLSearchParams(query) };
}

function join(pathname, params) {
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
}

/** Site-work screen for this role (admin / manager review / employee submissions). */
function progressHome(role) {
    if (role === 'admin') return paths.progress.admin;
    if (role === 'manager') return paths.progress.review;
    return paths.progress.submissions;
}

/**
 * @param {{ path?: string, title?: string, body?: string, packageId?: string, role?: string, module?: string }} n
 * @returns {string | null}
 */
export function notificationTarget(n = {}) {
    const raw = String(n.path || n.route || '').trim().replace(/^#/, '');
    if (/^[a-z]+:/i.test(raw) || raw.startsWith('//')) return null;
    const text = `${n.title || ''} ${n.body || ''}`;
    const role = n.role;
    const { pathname: rawName, params } = split(raw);
    const name = rawName.replace(/^\/+/, '');
    const packageId = n.packageId || params.get('package');
    const isSite = n.module === 'progress' || Boolean(packageId) || SITE_WORDS.test(text);

    // Old Site-work page names → the package itself.
    if (['AdminDashboard', 'ManagerDashboard', 'MySubmissions', 'ExporterDashboard'].includes(name) && isSite) {
        const next = new URLSearchParams(params);
        if (packageId) next.set('package', packageId);
        const target =
            name === 'MySubmissions'
                ? paths.progress.submissions
                : name === 'ExporterDashboard'
                  ? paths.progress.client
                  : progressHome(role || (name === 'AdminDashboard' ? 'admin' : 'manager'));
        return join(target, next);
    }
    // Materials' old manager name.
    if (name === 'ManagerDashboard' && (n.module === 'materials' || MATERIAL_WORDS.test(text))) {
        return join(paths.materials.manage, params);
    }

    if (!raw) {
        if (packageId) return `${progressHome(role)}?package=${encodeURIComponent(packageId)}`;
        return null;
    }

    const resolved = legacyPath(raw.startsWith('/') && name && !name.includes('/') ? name + (params.toString() ? `?${params}` : '') : raw);
    const { pathname, params: q } = split(resolved.startsWith('/') ? resolved : `/${resolved}`);

    // Wrong-role Site-work screens (admins were sent to the manager review page).
    if (pathname === paths.progress.review && role === 'admin') return join(paths.progress.admin, q);
    if (pathname === paths.progress.admin && role === 'manager') return join(paths.progress.review, q);
    if (packageId && pathname.startsWith('/progress') && !q.get('package')) q.set('package', packageId);

    // Generic dashboards → the section the notification is about.
    if (pathname === paths.timesheet.manage && !q.get('section')) {
        if (LEAVE_WORDS.test(text)) q.set('section', 'leaves');
        else if (TIMESHEET_WORDS.test(text)) return paths.timesheet.manageTimesheets;
    }
    if (pathname === paths.timesheet.admin) {
        if (q.get('section') === 'timesheets') q.set('section', 'timesheet-report');
        if (!q.get('section')) {
            if (LEAVE_WORDS.test(text)) q.set('section', 'leaves');
            else if (TIMESHEET_WORDS.test(text)) q.set('section', 'timesheet-report');
            else if (PAYSLIP_WORDS.test(text)) q.set('section', 'payslip-report');
        }
    }
    if (pathname === paths.hubs.supervisor && (LEAVE_WORDS.test(text) || TIMESHEET_WORDS.test(text))) {
        return paths.timesheet.siteShifts;
    }
    if (pathname === paths.hubs.worker && PAYSLIP_WORDS.test(text) && !q.get('open')) q.set('open', 'payslips');
    if (pathname === paths.materials.admin && !q.get('section') && /stock/i.test(text)) q.set('section', 'materials');

    return join(pathname, q);
}
