/**
 * The hub route table.
 *
 * Public: Home, sign-in, quick login, Verify a photo, privacy.
 * Signed in (HubLayout = sidebar / tab bar): role homes, account, and every module screen,
 * each gated to the hub roles that use it. Material Tracker / Site Progress screens also sit
 * behind ModuleGate (link that module's account once on this device).
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingScreen } from '@/ui/hub/primitives';
import { ModuleGate, RequireHubRole } from '@/app/guards';
import { modulePage } from '@/app/modulePage';
import { homePathFor, useIdentity } from '@/core/auth/identity';
import { paths } from '@/app/paths';
import Home from '@/pages/Home';

// The signed-in shell isn't needed on Home / sign-in, so it loads with the first portal screen.
const HubLayout = lazy(() => import('@/ui/hub/HubLayout'));
const LoginPage = lazy(() => import('@/pages/login/LoginPage'));
const QuickLogin = lazy(() => import('@/pages/login/QuickLogin'));
const RoleHome = lazy(() => import('@/pages/hubs/RoleHome'));
const EmployeeHome = lazy(() => import('@/pages/employee/EmployeeHome'));
const Account = lazy(() => import('@/pages/Account'));
const Misc = {
    Notifications: lazy(() => import('@/pages/Misc').then((m) => ({ default: m.Notifications }))),
    ConnectPage: lazy(() => import('@/pages/Misc').then((m) => ({ default: m.ConnectPage }))),
    NotFound: lazy(() => import('@/pages/Misc').then((m) => ({ default: m.NotFound }))),
};

const T = (name) => modulePage('timesheet', name);
const M = (name) => modulePage('materials', name);
const P = (name) => modulePage('progress', name);

const ALL = ['worker', 'supervisor', 'manager', 'admin'];
const STAFF = ['manager', 'admin'];

/** [path, Component, roles, module?] */
const MODULE_ROUTES = [
    // Timesheet — employee
    ['/timesheet/shifts', T('ShiftHistory'), ['worker']],
    ['/timesheet/leave/history', T('LeaveHistory'), ['worker']],
    ['/timesheet/timesheets', T('WorkerTimesheets'), ['worker']],
    ['/timesheet/forms', T('WorkerSubmittedForms'), ['worker']],
    ['/timesheet/forms/fill', T('WorkerFormFill'), ['worker']],
    ['/timesheet/forms/:id', T('WorkerFormFill'), ['worker']],
    ['/timesheet/company-forms', T('WorkerCompanyForms'), ['worker']],
    ['/timesheet/company-forms/fill', T('WorkerCompanyFormFill'), ['worker']],
    ['/timesheet/company-forms/history', T('WorkerCompanyFormHistory'), ['worker']],
    // Timesheet — supervisor / manager / admin
    ['/timesheet/site-shifts', T('SupervisorDashboard'), ['supervisor']],
    ['/timesheet/manage', T('ManagerDashboard'), ['manager']],
    ['/timesheet/manage/timesheets', T('ManagerTimesheets'), STAFF],
    ['/timesheet/admin', T('AdminDashboard'), ['admin']],
    ['/timesheet/admin/analytics', T('Analytics'), ['admin']],
    ['/timesheet/admin/attendance', T('AttendanceReport'), ['admin']],
    ['/timesheet/admin/announcements', T('AdminAnnouncements'), ['admin']],
    ['/timesheet/admin/forms', T('AdminForms'), ['admin']],
    ['/timesheet/admin/forms/:id', T('AdminFormDetail'), ['admin']],
    ['/timesheet/admin/company-forms', T('AdminCompanyForms'), ['admin']],
    // Material Tracker
    ['/materials/request', M('RequestPortal'), ['worker'], 'materials'],
    ['/materials/history', M('RequestHistory'), ['worker'], 'materials'],
    ['/materials/manage', M('ManagerDashboard'), ['manager'], 'materials'],
    ['/materials/admin', M('AdminDashboard'), ['admin'], 'materials'],
    ['/materials/log', M('History'), STAFF, 'materials'],
    // Site Progress
    ['/progress/submit', P('SubmitProgress'), ['worker'], 'progress'],
    ['/progress/camera', P('SubmitProgress'), ['worker'], 'progress'],
    ['/progress/submissions', P('MySubmissions'), ['worker'], 'progress'],
    ['/progress/home', P('WorkerPortal'), ['worker'], 'progress'],
    ['/progress/review', P('ManagerDashboard'), ['manager'], 'progress'],
    ['/progress/admin', P('AdminDashboard'), ['admin'], 'progress'],
    // Export Only / client portal is public (outside HubLayout) — see routes below.
    ['/progress/account', P('MyAccount'), STAFF.concat('worker'), 'progress'],
];

const PhotoVerification = P('PhotoVerification');
const LegalNotice = T('LegalNotice');
const ClientLogin = lazy(() => import('@/pages/login/ClientLogin'));
const ClientPortal = lazy(() => import('@/pages/client/ClientPortal'));


/** Soft enter for signed-out routes (home / login / verify) — matches in-shell g-view-enter. */
function ViewEnter({ children }) {
    return <div className="g-view-enter">{children}</div>;
}

/** Public screens (Verify a photo, privacy): plain page, no tab bar — they have their own back button. */
function PublicScreen({ children }) {
    return (
        <ViewEnter>
            <div className="g-page">{children}</div>
        </ViewEnter>
    );
}

/**
 * Legacy Timesheet History.jsx was never routed. Hub had wrongly mounted the worker-shift
 * History UI behind a STAFF gate. Send each role to the real history surface:
 * worker → ShiftHistory; staff/supervisor → their attendance dashboards.
 */
function TimesheetHistoryRedirect() {
    const identity = useIdentity();
    const to = ({
        worker: paths.timesheet.shifts,
        supervisor: paths.timesheet.siteShifts,
        manager: paths.timesheet.manage,
        admin: paths.timesheet.admin,
    })[identity?.role] || homePathFor(identity?.role);
    return <Navigate to={to} replace />;
}

function Guarded({ roles, module, Component }) {
    const screen = <Component />;
    return <RequireHubRole roles={roles}>{module ? <ModuleGate module={module}>{screen}</ModuleGate> : screen}</RequireHubRole>;
}

export default function AppRoutes() {
    return (
        <Suspense fallback={<LoadingScreen />}>
            <Routes>
                {/* Public */}
                <Route path="/" element={<ViewEnter><Home /></ViewEnter>} />
                <Route path="/login" element={<ViewEnter><LoginPage /></ViewEnter>} />
                <Route path="/login/quick" element={<ViewEnter><QuickLogin /></ViewEnter>} />
                <Route path="/verify" element={<PublicScreen><PhotoVerification /></PublicScreen>} />
                <Route path="/privacy" element={<PublicScreen><LegalNotice /></PublicScreen>} />
                <Route path="/legal" element={<Navigate to="/privacy" replace />} />
                <Route path="/Home" element={<Navigate to="/" replace />} />
                {/* Clients (Export Only) — no hub Timesheet identity; own exporter session via useRoleGuard */}
                <Route path="/progress/client/login" element={<ViewEnter><ClientLogin /></ViewEnter>} />
                <Route path="/progress/client" element={<ViewEnter><ClientPortal /></ViewEnter>} />
                <Route path="/progress/client/account" element={<Navigate to="/progress/client?tab=account" replace />} />
                <Route path="/ExporterLogin" element={<Navigate to="/progress/client/login" replace />} />
                <Route path="/ExporterDashboard" element={<Navigate to="/progress/client" replace />} />


                {/* Signed in */}
                <Route element={<HubLayout />}>
                    <Route path="/me" element={<RequireHubRole roles={['worker']}><EmployeeHome /></RequireHubRole>} />
                    {/* Old employee entry points all land on the merged home. */}
                    <Route path="/timesheet/clock" element={<Navigate to="/me" replace />} />
                    <Route path="/timesheet/payslips" element={<Navigate to="/me" replace />} />
                    <Route path="/timesheet/vehicles/scan" element={<Navigate to="/me" replace />} />
                    <Route path="/site" element={<RequireHubRole roles={['supervisor']}><RoleHome /></RequireHubRole>} />
                    <Route path="/manage" element={<RequireHubRole roles={['manager']}><RoleHome /></RequireHubRole>} />
                    <Route path="/admin" element={<RequireHubRole roles={['admin']}><RoleHome /></RequireHubRole>} />
                    <Route path="/account" element={<RequireHubRole roles={ALL}><Account /></RequireHubRole>} />
                    <Route path="/notifications" element={<RequireHubRole roles={ALL}><Misc.Notifications /></RequireHubRole>} />
                    <Route path="/connect/:module" element={<RequireHubRole roles={ALL}><Misc.ConnectPage /></RequireHubRole>} />
                    <Route path="/timesheet/leave" element={<Navigate to="/timesheet/leave/history" replace />} />
                    {/* Orphan worker History.jsx — role-aware redirect (legacy never routed this page). */}
                    <Route path="/timesheet/history" element={<RequireHubRole roles={ALL}><TimesheetHistoryRedirect /></RequireHubRole>} />
                    {MODULE_ROUTES.map(([path, Component, roles, module]) => (
                        <Route key={path} path={path} element={<Guarded roles={roles} module={module} Component={Component} />} />
                    ))}
                    <Route path="*" element={<Misc.NotFound />} />
                </Route>
            </Routes>
        </Suspense>
    );
}
