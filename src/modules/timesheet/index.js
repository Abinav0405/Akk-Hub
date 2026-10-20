// Public exports — timesheet module (Wave 1 T-LIB + Wave 2 SMALL-PAGES + LEGACY-PAGES)
export * from './lib/utils';
export * from './lib/timeUtils';
export * from './lib/leaveService';
export * from './lib/shiftApproval';
export * from './lib/companyForms';
export { default as LeaveCalendar } from './components/LeaveCalendar';
export { default as QRScanner } from './components/QRScanner';
export { default as VehicleQRScanner } from './components/VehicleQRScanner';
export { ShiftApprovalStatusBadge, ShiftApprovalMeta, ShiftApprovalButtons } from './components/ShiftApprovalActions';

// SMALL-PAGES — Claude wires routes; do not import into router from here without paths.js
export { default as LegalNotice } from './pages/LegalNotice';
export { default as AdminAnnouncements } from './pages/AdminAnnouncements';
export { default as AdminForms } from './pages/AdminForms';
export { default as AdminFormDetail } from './pages/AdminFormDetail';
export { default as WorkerFormFill } from './pages/WorkerFormFill';
export { default as WorkerSubmittedForms } from './pages/WorkerSubmittedForms';
export { default as WorkerCompanyForms } from './pages/WorkerCompanyForms';
export { default as WorkerCompanyFormFill } from './pages/WorkerCompanyFormFill';
export { default as WorkerCompanyFormHistory } from './pages/WorkerCompanyFormHistory';
export { default as LeaveHistory } from './pages/LeaveHistory';
export { default as ShiftHistory } from './pages/ShiftHistory';
export { default as WorkerTimesheets } from './pages/WorkerTimesheets';
export { default as Analytics } from './pages/Analytics';
export { default as AttendanceReport } from './pages/AttendanceReport';
export { default as ManagerTimesheets } from './pages/ManagerTimesheets';
export { default as AdminCompanyForms } from './pages/AdminCompanyForms';

// LEGACY-PAGES — big screens (Claude merges role hubs on top; register in router)
export { default as WorkerPortal } from './pages/WorkerPortal';
export { default as AdminDashboard } from './pages/AdminDashboard';
export { default as ManagerDashboard } from './pages/ManagerDashboard';
export { default as SupervisorDashboard } from './pages/SupervisorDashboard';
export { default as History } from './pages/History';
