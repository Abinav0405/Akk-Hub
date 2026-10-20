/**
 * Navigation per hub role: the phone tab bar (max 5) and the desktop sidebar groups.
 *
 * Organised by TASK (attendance, materials, site work, people & sites, insights…), never by
 * source app: the person sees one product. Items that open a section inside a dashboard carry
 * `path` + `section` (see app/useHubSection.js); `sectionDefault` marks the section a
 * dashboard opens on, so it is highlighted when the URL has no ?section=.
 *
 * Keep English `label`; add `labelKey` for i18n (HubLayout / RoleHome read the keys).
 */
import {
    BarChart3,
    BellRing,
    Boxes,
    Building2,
    Camera,
    CalendarDays,
    Car,
    ClipboardCheck,
    ClipboardList,
    Clock,
    FileSpreadsheet,
    FileText,
    History,
    House,
    MapPin,
    Megaphone,
    PackagePlus,
    Palette,
    Receipt,
    Send,
    ShieldCheck,
    UserCog,
    UserRound,
    Users,
    Wallet,
} from 'lucide-react';
import { paths } from '@/app/paths';
import { sectionHref } from '@/app/useHubSection';

/** A link to one section of a dashboard. */
function sec(path, section, sectionDefault = false) {
    return { to: sectionDefault ? path : sectionHref(path, section), path, section, sectionDefault };
}

const verifyItem = {
    id: 'verify',
    label: 'Verify a photo',
    labelKey: 'hub.nav.verifyPhoto',
    icon: ShieldCheck,
    to: paths.verify,
};
const accountItem = {
    id: 'account',
    label: 'Account',
    labelKey: 'hub.nav.account',
    icon: UserRound,
    to: paths.account,
};

const TS_ADMIN = paths.timesheet.admin;
const TS_MANAGE = paths.timesheet.manage;
const MAT_ADMIN = paths.materials.admin;
const PR_ADMIN = paths.progress.admin;
const PR_REVIEW = paths.progress.review;

export const NAV = {
    worker: {
        tabs: [
            { id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.worker, end: true },
            { id: 'materials', label: 'Materials', labelKey: 'hub.nav.materials', icon: Boxes, to: paths.materials.request, match: '/materials' },
            { id: 'site', label: 'Site', labelKey: 'hub.nav.site', icon: Camera, to: paths.progress.submit, match: '/progress' },
            { id: 'account', label: 'Account', labelKey: 'hub.nav.account', icon: UserRound, to: paths.account },
        ],
        groups: [
            {
                label: 'Overview',
                labelKey: 'hub.nav.overview',
                items: [{ id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.worker, end: true }],
            },
            {
                label: 'Attendance',
                tone: 'timesheet',
                items: [
                    { id: 'shifts', label: 'My shifts', labelKey: 'hub.nav.myShifts', icon: History, to: paths.timesheet.shifts },
                    { id: 'leave', label: 'Leave', labelKey: 'hub.nav.leave', icon: CalendarDays, to: paths.timesheet.leaveHistory },
                    { id: 'timesheets', label: 'Timesheets', labelKey: 'hub.nav.timesheets', icon: FileSpreadsheet, to: paths.timesheet.timesheets },
                ],
            },
            {
                label: 'Materials',
                labelKey: 'hub.nav.materials',
                tone: 'materials',
                items: [
                    { id: 'mreq', label: 'Take / return', labelKey: 'hub.nav.takeReturn', icon: PackagePlus, to: paths.materials.request },
                    { id: 'mhist', label: 'My requests', labelKey: 'hub.nav.myRequests', icon: History, to: paths.materials.history },
                ],
            },
            {
                label: 'Site photos',
                tone: 'progress',
                items: [
                    { id: 'psubmit', label: 'Submit photos', labelKey: 'hub.nav.submitPhotos', icon: Camera, to: paths.progress.submit },
                    { id: 'psubs', label: 'My submissions', labelKey: 'hub.nav.mySubmissions', icon: ClipboardCheck, to: paths.progress.submissions },
                ],
            },
            {
                label: 'Forms',
                items: [
                    { id: 'cforms', label: 'Company forms', labelKey: 'hub.nav.companyForms', icon: ClipboardList, to: paths.timesheet.companyForms },
                    { id: 'forms', label: 'Feedback forms', labelKey: 'hub.nav.feedbackForms', icon: FileText, to: paths.timesheet.forms },
                ],
            },
            { label: 'More', labelKey: 'hub.nav.more', items: [verifyItem, accountItem] },
        ],
    },

    supervisor: {
        tabs: [
            { id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.supervisor, end: true },
            { id: 'shifts', label: 'Shifts', labelKey: 'hub.nav.shifts', icon: ClipboardCheck, to: paths.timesheet.siteShifts },
            { id: 'verify', label: 'Verify', labelKey: 'hub.nav.verify', icon: ShieldCheck, to: paths.verify },
            { id: 'account', label: 'Account', labelKey: 'hub.nav.account', icon: UserRound, to: paths.account },
        ],
        groups: [
            {
                label: 'Overview',
                labelKey: 'hub.nav.overview',
                items: [{ id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.supervisor, end: true }],
            },
            {
                label: 'Attendance',
                tone: 'timesheet',
                items: [{ id: 'shifts', label: 'Site shifts', labelKey: 'hub.nav.siteShifts', icon: ClipboardCheck, to: paths.timesheet.siteShifts }],
            },
            { label: 'More', labelKey: 'hub.nav.more', items: [verifyItem, accountItem] },
        ],
    },

    manager: {
        tabs: [
            { id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.manager, end: true },
            { id: 'time', label: 'Attendance', icon: Clock, to: TS_MANAGE, match: '/timesheet' },
            { id: 'materials', label: 'Materials', labelKey: 'hub.nav.materials', icon: Boxes, to: paths.materials.manage, match: '/materials' },
            { id: 'site', label: 'Site work', icon: ClipboardList, to: PR_REVIEW, match: '/progress' },
            { id: 'account', label: 'Account', labelKey: 'hub.nav.account', icon: UserRound, to: paths.account },
        ],
        groups: [
            {
                label: 'Overview',
                labelKey: 'hub.nav.overview',
                items: [{ id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.manager, end: true }],
            },
            {
                label: 'Attendance',
                tone: 'timesheet',
                items: [
                    { id: 'tshifts', label: 'Shifts', icon: Clock, ...sec(TS_MANAGE, 'time-tracker', true) },
                    { id: 'tleave', label: 'Leave', labelKey: 'hub.nav.leave', icon: CalendarDays, ...sec(TS_MANAGE, 'leaves') },
                    { id: 'ttimesheets', label: 'Timesheets', labelKey: 'hub.nav.timesheets', icon: FileSpreadsheet, to: paths.timesheet.manageTimesheets },
                    { id: 'tcforms', label: 'Company forms', labelKey: 'hub.nav.companyForms', icon: ClipboardList, ...sec(TS_MANAGE, 'company-forms') },
                ],
            },
            {
                label: 'Materials',
                labelKey: 'hub.nav.materials',
                tone: 'materials',
                items: [{ id: 'mmanage', label: 'Requests', icon: Boxes, to: paths.materials.manage }],
            },
            {
                label: 'Site work',
                tone: 'progress',
                items: [
                    { id: 'ppackages', label: 'Photo packages', icon: ClipboardCheck, ...sec(PR_REVIEW, 'packages', true) },
                    { id: 'pworkers', label: 'Site employees', icon: Users, ...sec(PR_REVIEW, 'workers') },
                    { id: 'pjsr', label: 'JSR', icon: Receipt, ...sec(PR_REVIEW, 'jsr') },
                    { id: 'pbranding', label: 'Branding & settings', icon: Palette, ...sec(PR_REVIEW, 'branding') },
                ],
            },
            { label: 'More', labelKey: 'hub.nav.more', items: [verifyItem, accountItem] },
        ],
    },

    admin: {
        tabs: [
            { id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.admin, end: true },
            { id: 'time', label: 'Attendance', icon: Clock, to: TS_ADMIN, match: '/timesheet' },
            { id: 'materials', label: 'Materials', labelKey: 'hub.nav.materials', icon: Boxes, to: MAT_ADMIN, match: '/materials' },
            { id: 'site', label: 'Site work', icon: ClipboardList, to: PR_ADMIN, match: '/progress' },
            { id: 'account', label: 'Account', labelKey: 'hub.nav.account', icon: UserRound, to: paths.account },
        ],
        groups: [
            {
                label: 'Overview',
                labelKey: 'hub.nav.overview',
                items: [{ id: 'home', label: 'Home', labelKey: 'hub.nav.home', icon: House, to: paths.hubs.admin, end: true }],
            },
            {
                label: 'Attendance & pay',
                tone: 'timesheet',
                items: [
                    { id: 'tshifts', label: 'Shifts', icon: Clock, ...sec(TS_ADMIN, 'time-tracker', true) },
                    { id: 'tleave', label: 'Leave', labelKey: 'hub.nav.leave', icon: CalendarDays, ...sec(TS_ADMIN, 'leaves') },
                    { id: 'ttimesheets', label: 'Timesheets', labelKey: 'hub.nav.timesheets', icon: FileSpreadsheet, ...sec(TS_ADMIN, 'timesheet-report') },
                    { id: 'tpayslips', label: 'Payslips', icon: Wallet, ...sec(TS_ADMIN, 'payslip-report') },
                    { id: 'tattendance', label: 'Attendance report', labelKey: 'hub.nav.attendance', icon: CalendarDays, to: paths.timesheet.attendance },
                ],
            },
            {
                label: 'Materials',
                labelKey: 'hub.nav.materials',
                tone: 'materials',
                items: [
                    { id: 'mrequests', label: 'Requests', icon: Boxes, ...sec(MAT_ADMIN, 'transactions', true) },
                    { id: 'mstock', label: 'Stock', icon: PackagePlus, ...sec(MAT_ADMIN, 'materials') },
                    { id: 'mlog', label: 'Full history', labelKey: 'hub.nav.fullHistory', icon: History, to: paths.materials.log },
                ],
            },
            {
                label: 'Site work',
                tone: 'progress',
                items: [
                    { id: 'ppackages', label: 'Photo packages', icon: ClipboardCheck, ...sec(PR_ADMIN, 'packages', true) },
                    { id: 'pexports', label: 'Export queue', icon: Send, ...sec(PR_ADMIN, 'exports') },
                    { id: 'pjsr', label: 'JSR & billing', icon: Receipt, ...sec(PR_ADMIN, 'jsr') },
                    { id: 'pclient', label: 'Client portal', labelKey: 'hub.nav.clientPortal', icon: Building2, to: paths.progress.clientLogin },
                ],
            },
            {
                label: 'People & sites',
                items: [
                    { id: 'people', label: 'Employees', icon: Users, ...sec(TS_ADMIN, 'worker-info') },
                    { id: 'mrequesters', label: 'Material requesters', icon: UserRound, ...sec(MAT_ADMIN, 'requesters') },
                    { id: 'mmanagers', label: 'Managers', icon: UserCog, ...sec(MAT_ADMIN, 'managers') },
                    { id: 'paccess', label: 'App access', icon: ShieldCheck, ...sec(PR_ADMIN, 'users') },
                    { id: 'tsites', label: 'Sites', icon: MapPin, ...sec(TS_ADMIN, 'sites') },
                    { id: 'msites', label: 'Material sites', icon: MapPin, ...sec(MAT_ADMIN, 'sites') },
                    { id: 'tvehicles', label: 'Vehicles', icon: Car, ...sec(TS_ADMIN, 'vehicles') },
                ],
            },
            {
                label: 'Insights',
                items: [
                    { id: 'tanalytics', label: 'Attendance', icon: BarChart3, to: paths.timesheet.analytics },
                    { id: 'manalytics', label: 'Materials', icon: BarChart3, ...sec(MAT_ADMIN, 'analytics') },
                    { id: 'panalytics', label: 'Site work', icon: BarChart3, ...sec(PR_ADMIN, 'analytics') },
                ],
            },
            {
                label: 'Communication',
                items: [
                    { id: 'tannounce', label: 'Announcements', labelKey: 'hub.nav.announcements', icon: Megaphone, to: paths.timesheet.announcements },
                    { id: 'tforms', label: 'Feedback forms', icon: FileText, to: paths.timesheet.adminForms },
                    { id: 'tcforms', label: 'Company forms', labelKey: 'hub.nav.companyForms', icon: ClipboardList, to: paths.timesheet.adminCompanyForms },
                    { id: 'notifications', label: 'Notifications', labelKey: 'hub.nav.notifications', icon: BellRing, to: paths.notifications },
                ],
            },
            {
                label: 'Settings',
                items: [
                    { id: 'pbranding', label: 'Branding & reports', icon: Palette, ...sec(PR_ADMIN, 'branding') },
                    verifyItem,
                    accountItem,
                ],
            },
        ],
    },
};

export function navFor(role) {
    return NAV[role] || { tabs: [], groups: [] };
}

/** Is this nav item the current screen? Handles plain paths, prefixes and ?section= links. */
export function isNavItemActive(item, pathname, search = '') {
    if (item.path) {
        if (pathname !== item.path) return false;
        const current = new URLSearchParams(search).get('section');
        return item.sectionDefault ? !current || current === item.section : current === item.section;
    }
    if (item.end) return pathname === item.to;
    if (item.match) return pathname.startsWith(item.match);
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
