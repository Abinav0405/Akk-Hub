/** Quick-action tiles on each role home (most-used actions across the three modules).
 * Keep English `title`/`hint`; add `titleKey`/`hintKey` for i18n (RoleHome reads the keys).
 */
import {
    BarChart3,
    Boxes,
    Building2,
    CalendarDays,
    Camera,
    ClipboardCheck,
    ClipboardList,
    Clock,
    FileSpreadsheet,
    History,
    Megaphone,
    PackagePlus,
    Receipt,
    Wallet,
} from 'lucide-react';
import { paths } from '@/app/paths';

export const HOME_TILES = {
    worker: [
        { icon: Clock, tone: 'timesheet', title: 'Clock in / out', titleKey: 'hub.tile.clock', hint: 'Scan the site QR', hintKey: 'hub.tile.clockHint', to: paths.timesheet.clock },
        { icon: PackagePlus, tone: 'materials', title: 'Materials', titleKey: 'hub.tile.materials', hint: 'Take or return', hintKey: 'hub.tile.materialsHint', to: paths.materials.request },
        { icon: Camera, tone: 'progress', title: 'Site photos', titleKey: 'hub.tile.sitePhotos', hint: 'Before · during · after', hintKey: 'hub.tile.sitePhotosHint', to: paths.progress.submit },
        { icon: CalendarDays, tone: 'timesheet', title: 'Leave', titleKey: 'hub.tile.leave', hint: 'Requests & balance', hintKey: 'hub.tile.leaveHint', to: paths.timesheet.leaveHistory },
        { icon: History, tone: 'timesheet', title: 'My shifts', titleKey: 'hub.tile.myShifts', hint: 'Hours & breaks', hintKey: 'hub.tile.myShiftsHint', to: paths.timesheet.shifts },
        { icon: Wallet, tone: 'timesheet', title: 'Payslips', titleKey: 'hub.tile.payslips', hint: 'Monthly pay', hintKey: 'hub.tile.payslipsHint', to: paths.timesheet.payslips },
        { icon: Boxes, tone: 'materials', title: 'My requests', titleKey: 'hub.tile.myRequests', hint: 'Status & returns', hintKey: 'hub.tile.myRequestsHint', to: paths.materials.history },
        { icon: ClipboardCheck, tone: 'progress', title: 'My submissions', titleKey: 'hub.tile.mySubmissions', hint: 'Approved / declined', hintKey: 'hub.tile.mySubmissionsHint', to: paths.progress.submissions },
    ],
    supervisor: [
        { icon: ClipboardCheck, tone: 'timesheet', title: 'Site shifts', titleKey: 'hub.tile.siteShifts', hint: "Approve today's shifts", hintKey: 'hub.tile.siteShiftsHint', to: paths.timesheet.siteShifts },
    ],
    manager: [
        { icon: ClipboardCheck, tone: 'timesheet', title: 'Shifts & leave', titleKey: 'hub.tile.shiftsLeave', hint: 'Approve and edit', hintKey: 'hub.tile.shiftsLeaveHint', to: paths.timesheet.manage },
        { icon: FileSpreadsheet, tone: 'timesheet', title: 'Timesheets', titleKey: 'hub.tile.timesheets', hint: 'Monthly sheets', hintKey: 'hub.tile.timesheetsHint', to: paths.timesheet.manageTimesheets },
        { icon: Boxes, tone: 'materials', title: 'Material requests', titleKey: 'hub.tile.materialRequests', hint: 'Approve take / return', hintKey: 'hub.tile.materialRequestsHint', to: paths.materials.manage },
        { icon: ClipboardList, tone: 'progress', title: 'Site packages', titleKey: 'hub.tile.sitePackages', hint: 'Review & print', hintKey: 'hub.tile.sitePackagesHint', to: paths.progress.review },
    ],
    admin: [
        { icon: Clock, tone: 'timesheet', title: 'Timesheet admin', titleKey: 'hub.tile.timesheetAdmin', hint: 'Shifts, payroll, people', hintKey: 'hub.tile.timesheetAdminHint', to: paths.timesheet.admin },
        { icon: Boxes, tone: 'materials', title: 'Materials admin', titleKey: 'hub.tile.materialsAdmin', hint: 'Requests & stock', hintKey: 'hub.tile.materialsAdminHint', to: paths.materials.admin },
        { icon: Receipt, tone: 'progress', title: 'Site progress', titleKey: 'hub.tile.siteProgress', hint: 'Packages & billing', hintKey: 'hub.tile.siteProgressHint', to: paths.progress.admin },
        { icon: BarChart3, tone: 'timesheet', title: 'Analytics', titleKey: 'hub.tile.analytics', hint: 'Hours & attendance', hintKey: 'hub.tile.analyticsHint', to: paths.timesheet.analytics },
        { icon: Megaphone, tone: 'timesheet', title: 'Announcements', titleKey: 'hub.tile.announcements', hint: 'To all employees', hintKey: 'hub.tile.announcementsHint', to: paths.timesheet.announcements },
        { icon: CalendarDays, tone: 'timesheet', title: 'Attendance', titleKey: 'hub.tile.attendance', hint: 'Daily report', hintKey: 'hub.tile.attendanceHint', to: paths.timesheet.attendance },
        { icon: History, tone: 'materials', title: 'Material history', titleKey: 'hub.tile.materialHistory', hint: 'Every transaction', hintKey: 'hub.tile.materialHistoryHint', to: paths.materials.log },
        { icon: Building2, tone: 'progress', title: 'Client portal', titleKey: 'hub.tile.clientPortal', hint: 'Reports & claims', hintKey: 'hub.tile.clientPortalHint', to: paths.progress.clientLogin },
    ],
};
