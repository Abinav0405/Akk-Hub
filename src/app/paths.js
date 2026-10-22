/**
 * Every hub route in one place. Ported module code uses these (or the literal strings).
 *
 * Shape: role-first homes (/me, /site, /manage, /admin) + module routes
 * (/timesheet/*, /materials/*, /progress/*) that each role's navigation points into.
 */
export const paths = {
    home: '/',
    login: '/login',
    quickLogin: '/login/quick',
    verify: '/verify',
    privacy: '/privacy',
    account: '/account',
    notifications: '/notifications',
    connect: (module) => `/connect/${module}`,

    hubs: {
        worker: '/me',
        supervisor: '/site',
        manager: '/manage',
        admin: '/admin',
    },

    adminSites: '/admin/sites',

    myInfo: '/me/info',

    deployment: {
        plan: '/deployment',
        mine: '/me/deployment',
        crew: '/site/crew',
    },

    timesheet: {
        clock: '/timesheet/clock',
        shifts: '/timesheet/shifts',
        leave: '/timesheet/leave',
        leaveHistory: '/timesheet/leave/history',
        payslips: '/timesheet/payslips',
        timesheets: '/timesheet/timesheets',
        forms: '/timesheet/forms',
        formFill: '/timesheet/forms/fill',
        form: (id) => `/timesheet/forms/${id}`,
        companyForms: '/timesheet/company-forms',
        companyFormFill: '/timesheet/company-forms/fill',
        companyFormHistory: '/timesheet/company-forms/history',
        vehicleScan: '/timesheet/vehicles/scan',
        siteShifts: '/timesheet/site-shifts',
        manage: '/timesheet/manage',
        manageTimesheets: '/timesheet/manage/timesheets',
        admin: '/timesheet/admin',
        analytics: '/timesheet/admin/analytics',
        attendance: '/timesheet/admin/attendance',
        announcements: '/timesheet/admin/announcements',
        adminForms: '/timesheet/admin/forms',
        adminForm: (id) => `/timesheet/admin/forms/${id}`,
        adminCompanyForms: '/timesheet/admin/company-forms',
    },

    materials: {
        request: '/materials/request',
        history: '/materials/history',
        log: '/materials/log',
        manage: '/materials/manage',
        admin: '/materials/admin',
    },

    progress: {
        submit: '/progress/submit',
        submissions: '/progress/submissions',
        camera: '/progress/camera',
        review: '/progress/review',
        admin: '/progress/admin',
        client: '/progress/client',
        clientLogin: '/progress/client/login',
    },
};

/** Old page names (createPageUrl('X') / backTo="X") from the three source apps → hub paths. */
const LEGACY = {
    Home: '/',
    AppHome: '/',
    WorkerLogin: '/login',
    WorkerQuickLogin: '/login/quick',
    AdminLogin: '/login?role=admin',
    ManagerLogin: '/login?role=management',
    SupervisorLogin: '/login?role=management&as=supervisor',
    ManagerSupervisorSelection: '/login?role=management',
    ExporterLogin: '/progress/client/login',
    PhotoVerification: '/verify',
    MyAccount: '/account',
    LegalNotice: '/privacy',
    // Timesheet
    WorkerPortal: '/me',
    WorkerTimesheets: '/timesheet/timesheets',
    LeaveHistory: '/timesheet/leave/history',
    ShiftHistory: '/timesheet/shifts',
    WorkerCompanyForms: '/timesheet/company-forms',
    WorkerCompanyFormFill: '/timesheet/company-forms/fill',
    WorkerCompanyFormHistory: '/timesheet/company-forms/history',
    WorkerFormFill: '/timesheet/forms/fill',
    WorkerSubmittedForms: '/timesheet/forms',
    SupervisorDashboard: '/site',
    ManagerTimesheets: '/timesheet/manage/timesheets',
    Analytics: '/timesheet/admin/analytics',
    AttendanceReport: '/timesheet/admin/attendance',
    AdminAnnouncements: '/timesheet/admin/announcements',
    AdminForms: '/timesheet/admin/forms',
    AdminFormDetail: '/timesheet/admin/forms',
    AdminCompanyForms: '/timesheet/admin/company-forms',
    // Materials
    RequestPortal: '/materials/request',
    RequestHistory: '/materials/history',
    History: '/materials/log',
    // Site progress
    SubmitProgress: '/progress/submit',
    MySubmissions: '/progress/submissions',
    ExporterDashboard: '/progress/client',
};

/** Ambiguous names — resolved by the signed-in role. */
/** In-module "back to dashboard" targets (not the hub role home). */
const ROLE_HOME = { AdminDashboard: '/timesheet/admin', ManagerDashboard: '/timesheet/manage' };

export function legacyPath(nameOrPath) {
    if (!nameOrPath) return '/';
    const value = String(nameOrPath);
    if (value.startsWith('/') || value.startsWith('http')) return value;
    const [name, query] = value.split('?');
    const base = LEGACY[name] || ROLE_HOME[name] || `/${name}`;
    return query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base;
}
