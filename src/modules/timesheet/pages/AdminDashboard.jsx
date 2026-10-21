import { UNIFIED, supabaseTimesheet as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { Capacitor } from '@capacitor/core';
import { registerPushForAdmin } from '@/modules/timesheet/lib/pushRegistration';
import { adminSetWorkerPassword, verifyAdminSession } from '@/core/auth/timesheetSession';
import { fetchAdminTimesheetHeadTs, useUpdatedAtHeartbeat } from '@/modules/timesheet/lib/smartPolling';
import { getEditableWorkerPassword, isStoredPasswordHash, normalizeWorkerPasswordForSave, hasWorkerPasswordSet } from '@/modules/timesheet/lib/passwordUtils';
import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    ArrowLeft, Download, Search, Clock, PlusCircle, RotateCcw,
    Calendar, User, FileSpreadsheet, Loader2, Trash2, Printer,
    CheckCircle, XCircle, AlertCircle, Edit2, ChevronDown, ChevronUp,
    MapPin, Coffee, Users, Eye, EyeOff, Receipt, UserCheck, FileText, HelpCircle, QrCode, Activity, ClipboardList, Paperclip, Car, Settings,
    History,
} from "lucide-react";
import PageLoader from '@/modules/timesheet/components/PageLoader.jsx';
const VehiclesTab = lazy(() => import('@/modules/timesheet/components/admin/VehiclesTab'));
const TimeTrackerTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/TimeTrackerTab'));
const LeavesTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/LeavesTab'));
const PayslipReportTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/PayslipReportTab'));
const TimesheetReportTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/TimesheetReportTab'));
const WorkerInfoTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/WorkerInfoTab'));
const SitesTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/SitesTab'));
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useIdentity, homePathFor } from '@/core/auth/identity';
import { cn, moduleSheetDialog } from '@/modules/timesheet/lib/utils';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import { useLanguage } from '@/core-i18n';
import { isNativeApp } from '@/core/platform';
import TopBar from '@/ui/hub/TopBar';
import { useHubSection } from '@/app/useHubSection';
import { confirmAction } from '@/ui/native/NativeConfirm';
import {
    archivePayslipBeforeEdit,
    checkTimesheetForPayslip,
    describeTimesheetProblem,
    getTimesheetsForMonth,
    listTimesheetRevisions,
    savePassedOutPayslip,
    updateTimesheetInPlace,
} from '@/modules/timesheet/lib/passedOutDocuments';
import {
    appliedToLines,
    applyPayslipBalances,
    balanceErrorMessage,
    buildBalanceSection,
    getOpenBalancesForPeriod,
    replaceBalanceSection,
    selectionToLines,
} from '@/modules/timesheet/lib/payBalances';
import PayslipBalancePicker from '@/modules/timesheet/components/payroll/PayslipBalancePicker';
import PayBalancesPanel from '@/modules/timesheet/components/payroll/PayBalancesPanel';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import { glassPanel, glassDialog, glassInput, PortalBackdrop, AdminChoiceCard, AdminFieldLabel, AdminToneIcon } from '@/ui/PortalShell';
import { AdminMobileSectionStrip, AdminMorePagesDrawer, ADMIN_TAB_TITLES } from '@/modules/timesheet/components/admin/AdminNavChrome';
import { AdminDashProvider } from '@/modules/timesheet/components/admin/AdminDashContext';
import AdminEditShiftDialog from '@/modules/timesheet/components/admin/AdminEditShiftDialog';
import { setAdminShiftRefreshPaused, isAdminShiftRefreshPaused } from '@/modules/timesheet/lib/adminShiftRefreshPause';
import { format } from "date-fns";
import QRCode from "qrcode";
import { toast } from "sonner";
import { formatTime, formatDate, isSunday, isPublicHoliday, shouldCreditUnworkedPublicHoliday, calculateShiftHours, getWorkDateFromDateTime, countLeaveDaysForDisplay, toSingaporeDateStr, getTodaySingapore, getSingaporeWallClock, addDaysToYmd, ymdEndOfMonth, ymdStartOfNextMonth, normalizeOptionalSiteGps, parseSiteGpsCoords } from '@/modules/timesheet/lib/timeUtils';
import { approximateTime } from '@/modules/timesheet/lib/timeApproximation';

const ADMIN_DASHBOARD_SECTIONS = [
    'time-tracker',
    'leaves',
    'payslip-report',
    'timesheet-report',
    'worker-info',
    'sites',
    'vehicles',
    'salary-report', // legacy alias; remapped to time-tracker on mount
];
import { toDateTimeLocalUtc, fromDateTimeLocalUtc } from '@/modules/timesheet/lib/utils';
import FaceMatchPrompt from '@/modules/timesheet/components/biometric/FaceMatchPrompt';
import AppTour from '@/modules/timesheet/components/AppTour';
import DashboardAnalyticsWidget from '@/modules/timesheet/components/DashboardAnalyticsWidget';
import {
    calculateAge,
    computeCpfWageBase,
    getCPFEmployeeRate,
    getCPFEmployerRate,
    getCpfRatesForBirthday,
    resolveSindaDeduction,
    sindaMonthlyWageBase,
    LOCAL_PAYSLIP_YTD_COLUMNS,
    isPeriodBefore,
    payslipHistoryNetPay,
    roundPayslipMoney,
    sumPayslipLineItems,
    isPaidLeaveTypeName,
    isUnpaidLeaveTypeName,
    isHalfDayLeaveType,
    CPF_OW_CEILING,
    endOfMonthSgt,
    calculateSDL,
    calculateCPFDeductions,
    calculateAccumulatedTotals,
    validateBirthday
} from '@/modules/timesheet/lib/contributionCalculations';
import {
    printWorkerProfile,
    printYearlyPaySummary,
    aggregateYearlyPaySummary,
} from '@/modules/timesheet/lib/workerSearchDocuments';
import {
    applySysOverridesToExtracted,
    mergeAdditionsWithSysOverrides,
    patchPayslipHtml,
    stripSysAdditions
} from '@/modules/timesheet/lib/payslipOverrides';
import {
    buildBatchPayslipPrintDocument,
    formatPayslipPayDate,
    formatPayslipPeriodRange,
    normalizePayslipHtmlForPrint,
} from '@/modules/timesheet/lib/payslipPrint';
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { filterLeavesByDateRange, printLeaveForms } from '@/modules/timesheet/lib/leaveFormPrint';
import { isAdminDeletePinConfigured, verifyAdminDeletePin } from '@/modules/timesheet/lib/adminConfig';
import {
    applyApprovalOnShiftSave,
    approveShiftRecord,
    declineShiftRecord,
    filterShiftsForPayroll,
    getShiftApproverName,
    getShiftEditorName,
    isShiftApproved,
    matchesUnapprovedFilter,
    pendingOnCompleteFields,
    shiftNeedsApprovalActions,
} from '@/modules/timesheet/lib/shiftApproval';
import {
    NEY_LABEL,
    getWorkerPayStatus,
    getEligibleWorkingDaysInMonth,
    isWorkerPayEligibleOnDate,
    monthYearToDateRange,
    workerIsNotInCompany as workerIsNotInCompanyEmployment,
} from '@/modules/timesheet/lib/workerEmploymentPay';
import {
    bulkUpdateLeaveStatus,
    computeLeaveDashboardStats,
    countRequestedLeaveDays,
    DEFAULT_LEAVE_POLICY,
    evaluateLeaveConflicts,
    fetchBlackoutDates,
    fetchLeavePolicy,
    fetchWorkerDirectoryMap,
    getLeaveAttachmentSignedUrl,
    getLeaveStatusLabel,
    halfDayWorkPolicyLabel,
    hasOverlappingLeaveRequest,
    normalizeLeaveType,
    phLeaveRuleLabel,
    prepareLeaveAttachment,
    processLeaveApprovalEffects,
    processLeaveCancellationEffects,
    processLeaveDeletionEffects,
    requiresMedicalAttachment,
    saveLeavePolicy,
    updateLeaveRequestFields,
} from '@/modules/timesheet/lib/leaveService';
import { exportLeaveReportExcel } from '@/modules/timesheet/lib/leaveExport';
import LeaveCalendar from '@/modules/timesheet/components/LeaveCalendar';
import WorkerAccessPanel from '@/modules/timesheet/components/admin/WorkerAccessPanel';
import WorkerAccessTable from '@/modules/timesheet/components/admin/WorkerAccessTable';
import WorkerIdCard from '@/modules/timesheet/components/admin/WorkerIdCard';
import {
    ShiftApprovalButtons,
    ShiftApprovalMeta,
    ShiftApprovalStatusBadge,
} from '@/modules/timesheet/components/ShiftApprovalActions';

const SHIFT_PAGE = 50;

// Production logging system
const DEBUG_MODE = process.env.NODE_ENV === 'development';
const log = {
    info: (message, ...args) => DEBUG_MODE && console.log(message, ...args),
    error: (message, ...args) => console.error(message, ...args), // Always log errors
    warn: (message, ...args) => DEBUG_MODE && console.warn(message, ...args),
    debug: (message, ...args) => DEBUG_MODE && console.debug(message, ...args)
};

// Format number to 4 significant figures
function to4SF(value) {
    if (value === 0 || value === null || value === undefined || isNaN(value)) return '0.00';
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    
    // Handle very small numbers
    if (Math.abs(num) < 0.0001) return '0.00';
    
    // Calculate the order of magnitude
    const magnitude = Math.floor(Math.log10(Math.abs(num)));
    const factor = Math.pow(10, 3 - magnitude);
    
    // Round to 4 significant figures
    const rounded = Math.round(num * factor) / factor;
    
    // Format with appropriate decimal places (max 4 decimals for precision)
    if (magnitude >= 2) {
        return rounded.toFixed(0);
    } else if (magnitude >= 1) {
        return rounded.toFixed(1);
    } else if (magnitude >= 0) {
        return rounded.toFixed(2);
    } else if (magnitude >= -1) {
        return rounded.toFixed(3);
    } else {
        return rounded.toFixed(4);
    }
}

/** Matches worker-info table: red rows when not currently in company. */
function workerIsNotInCompany(w) {
    return workerIsNotInCompanyEmployment(w);
}

/** Inner HTML of payslip documents for batch print (stored HTML may be full <html>...</html>). */
function extractPayslipDocumentBodyInner(html) {
    if (!html || typeof html !== 'string') return '';
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return (m ? m[1] : html).trim();
}

/** Head inner markup (styles, fonts) merged when printing multiple payslips at once. */
function collectPayslipDocumentHeadInner(html) {
    if (!html || typeof html !== 'string') return '';
    const m = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
    return m ? m[1].trim() : '';
}

function partitionWorkersDirectoryForDisplay(workers) {
    const active = [];
    const leftCompany = [];
    for (const w of workers || []) {
        if (workerIsNotInCompany(w)) leftCompany.push(w);
        else active.push(w);
    }
    const byEmployeeId = (a, b) =>
        String(a.employee_id ?? '').localeCompare(String(b.employee_id ?? ''), undefined, { numeric: true });
    active.sort(byEmployeeId);
    leftCompany.sort(byEmployeeId);
    return { active, leftCompany };
}

function normalizeRejoinDatesInput(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const normalized = [
        ...new Set(
            arr
                .map((d) => (typeof d === 'string' ? d.trim() : String(d ?? '').trim()))
                .filter(Boolean)
        ),
    ].sort((a, b) => a.localeCompare(b));
    return normalized;
}

function parseRejoinDatesFromWorkerRow(row) {
    const r = row?.rejoin_dates;
    if (Array.isArray(r)) return normalizeRejoinDatesInput(r.map((x) => String(x)));
    return [];
}

function formatRejoinDatesCell(row) {
    const ds = parseRejoinDatesFromWorkerRow(row);
    return ds.length ? ds.join(', ') : '—';
}

function parseIsoDateSafe(s) {
    if (!s || typeof s !== 'string') return null;
    const t = Date.parse(`${s.trim()}T00:00:00`);
    return Number.isNaN(t) ? null : t;
}

/** Validates cessation vs rejoins and employed state (admin edit worker form). */
function validateWorkerEmploymentTimeline({ inCompany, dateJoined, dateOfCessation, rejoinDatesNormalized }) {
    const cessationTrim =
        dateOfCessation && String(dateOfCessation).trim() ? String(dateOfCessation).trim() : '';
    const rejoins = rejoinDatesNormalized || [];
    const active = inCompany !== false && inCompany !== 0;
    const dj = parseIsoDateSafe(dateJoined);
    const ct = cessationTrim ? parseIsoDateSafe(cessationTrim) : null;

    const rejoinTimes = rejoins.map((r) => parseIsoDateSafe(r)).filter((t) => t != null);
    const maxRejoin = rejoinTimes.length ? Math.max(...rejoinTimes) : null;

    if (rejoins.length > 0 && !cessationTrim) {
        return {
            ok: false,
            message:
                'Enter a date of cessation before adding rejoin dates (the leave date before each return).',
        };
    }

    if (dj != null && rejoinTimes.some((rt) => rt != null && rt < dj)) {
        return {
            ok: false,
            message: "Every rejoin date must be on or after the worker's original date joined.",
        };
    }

    if (cessationTrim && ct == null) {
        return { ok: false, message: 'Date of cessation is invalid.' };
    }

    if (ct != null && dj != null && ct < dj) {
        return {
            ok: false,
            message: 'Date of cessation cannot be before date joined.',
        };
    }

    if (active && cessationTrim && maxRejoin == null) {
        return {
            ok: false,
            message:
                'While the worker is in company again with a cessation date on file, add at least one rejoin date on or after that cessation—or clear the cessation date.',
        };
    }

    if (cessationTrim && maxRejoin != null && maxRejoin < ct) {
        return {
            ok: false,
            message: 'Every rejoin date must be on or after the cessation date.',
        };
    }

    if (!active && cessationTrim && maxRejoin != null && ct != null && ct < maxRejoin) {
        return {
            ok: false,
            message:
                'Date of cessation must be on or after the latest rejoin date before marking as no longer employed.',
        };
    }

    return { ok: true };
}

export default function AdminDashboard() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const identity = useIdentity();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
    const [workerIdFilter, setWorkerIdFilter] = useState('');
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deletePin, setDeletePin] = useState('');
    const [deletePinError, setDeletePinError] = useState('');
    const [showIndividualDeletePinDialog, setShowIndividualDeletePinDialog] = useState(false);
    const [individualDeletePin, setIndividualDeletePin] = useState('');
    const [individualDeletePinError, setIndividualDeletePinError] = useState('');
    const [pendingDeleteShiftId, setPendingDeleteShiftId] = useState(null);
    const [showPrintDialog, setShowPrintDialog] = useState(false);
    const [printWorkerTypeDialog, setPrintWorkerTypeDialog] = useState(false);
    const [printSelectedWorkerType, setPrintSelectedWorkerType] = useState(''); // 'local' or 'foreign'
    const [printMonthYear, setPrintMonthYear] = useState('');
    const [printWorkerId, setPrintWorkerId] = useState('');
    const [printDeductions, setPrintDeductions] = useState([{ type: '', amount: '' }]);
    const [printSalaryPaidDate, setPrintSalaryPaidDate] = useState('');
    const [printBonus, setPrintBonus] = useState('');
    const [printAdditions, setPrintAdditions] = useState([{ name: '', value: '' }]);
    // Multi-print (several worker IDs, per-worker payslip configuration)
    const [showMultiPrintDialog, setShowMultiPrintDialog] = useState(false);
    const [multiPrintStep, setMultiPrintStep] = useState(1); // 1: month + IDs, 2: configure workers
    const [multiPrintMonth, setMultiPrintMonth] = useState('');
    const [multiPrintIds, setMultiPrintIds] = useState('');
    const [multiPrintSalaryPaidDate, setMultiPrintSalaryPaidDate] = useState('');
    const [multiPrintWorkers, setMultiPrintWorkers] = useState([]);
    const [multiPrintProgress, setMultiPrintProgress] = useState({ current: 0, total: 0, isGenerating: false });
    const [showPayslipDialog, setShowPayslipDialog] = useState(false);
    const [payslipWorkerId, setPayslipWorkerId] = useState('');
    const [payslipMonth, setPayslipMonth] = useState('');
    const [payslipSalaryPaidDate, setPayslipSalaryPaidDate] = useState('');
    const [payslipDeductions, setPayslipDeductions] = useState([{ type: '', amount: '' }]);
    // Pass Out Payslip states
    const [showPassOutPayslipDialog, setShowPassOutPayslipDialog] = useState(false);
    const [passOutPayslipMode, setPassOutPayslipMode] = useState(''); // 'individual' or 'all'
    const [passOutPayslipWorkerId, setPassOutPayslipWorkerId] = useState('');
    const [passOutPayslipMonth, setPassOutPayslipMonth] = useState('');
    const [passOutPayslipSalaryPaidDate, setPassOutPayslipSalaryPaidDate] = useState('');
    const [passOutPayslipDeductions, setPassOutPayslipDeductions] = useState([{ type: '', amount: '' }]);
    // Pay balances for the individual pass-out (open balances, ticked amounts, amount actually paid)
    const [passOutPayslipBalances, setPassOutPayslipBalances] = useState([]);
    const [passOutPayslipBalanceSel, setPassOutPayslipBalanceSel] = useState({});
    const [passOutPayslipAmountPaid, setPassOutPayslipAmountPaid] = useState('');
    const [passOutPayslipBonus, setPassOutPayslipBonus] = useState('');
    const [passOutPayslipAdditions, setPassOutPayslipAdditions] = useState([{ name: '', value: '' }]);
    const [passOutPayslipAllWorkers, setPassOutPayslipAllWorkers] = useState([]);
    const [passOutPayslipAllStep, setPassOutPayslipAllStep] = useState(1); // 1: date range, 2: configure workers
    const [passOutPayslipProgress, setPassOutPayslipProgress] = useState({ current: 0, total: 0, isGenerating: false });
    // Pass Out Timesheet states (approval workflow)
    const [showPassOutTimesheetDialog, setShowPassOutTimesheetDialog] = useState(false);
    const [passOutTimesheetMode, setPassOutTimesheetMode] = useState(''); // 'individual', 'group', 'all'
    const [passOutTimesheetMonth, setPassOutTimesheetMonth] = useState('');
    const [passOutTimesheetWorkerId, setPassOutTimesheetWorkerId] = useState('');
    const [passOutTimesheetWorkerIds, setPassOutTimesheetWorkerIds] = useState(''); // comma-separated for group
    const [passOutTimesheetProgress, setPassOutTimesheetProgress] = useState({ current: 0, total: 0, isGenerating: false });
    const [payslipReportMonth, setPayslipReportMonth] = useState('');
    const [payslipReportData, setPayslipReportData] = useState(null);
    const [timesheetReportMonth, setTimesheetReportMonth] = useState('');
    const [timesheetReportData, setTimesheetReportData] = useState(null);
    const [editingPayslip, setEditingPayslip] = useState(null);
    const [payslipEditForm, setPayslipEditForm] = useState({
        basic_pay: '',
        ot_pay: '',
        sun_ph_pay: '',
        monthly_allowance: '',
        incentive_allowance: '',
        bonus: '',
        custom_additions: [],
        cpf_employee_deduction: '',
        sinda_deduction: '',
        total_deductions: '',
        net_pay: ''
    });
    const [siteFilter, setSiteFilter] = useState('all');
    const [workerTypeFilter, setWorkerTypeFilter] = useState('all'); // 'all' | 'local' | 'foreign'
    const [expandedCards, setExpandedCards] = useState(new Set());
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);
    const [logoUrl, setLogoUrl] = useState(localStorage.getItem(storageKey('timesheet', 'logoUrl')) || '/Akk-logo.jpg');
    const [showLeaveHistory, setShowLeaveHistory] = useState(false);
    const [leavePrintFromDate, setLeavePrintFromDate] = useState('');
    const [leavePrintToDate, setLeavePrintToDate] = useState('');
    const [isPrintingLeaveForms, setIsPrintingLeaveForms] = useState(false);
    /** Latest shifts.created_at (global head) seen by the poll heartbeat — ref avoids stale closures and null baseline bugs */
    const shiftPollHeadTsRef = useRef(null);
    const [isTutorialRunning, setIsTutorialRunning] = useState(false);
    const [activeDashboardTab, setActiveDashboardTab] = useHubSection('time-tracker', ADMIN_DASHBOARD_SECTIONS);
    // Long lists render in pages: ~1,000 shift cards at once made the screen crawl.
    const [shiftLimit, setShiftLimit] = useState(SHIFT_PAGE);
    const [leaveLimit, setLeaveLimit] = useState(SHIFT_PAGE);
    const adminTutorialSteps = useMemo(() => ([
        {
            id: 'admin-header',
            target: '[data-tour="admin-header"]',
            content: "This is the Admin Dashboard. You can control shifts, payroll outputs, worker records, and system setup from here.",
            disableBeacon: true
        },
        {
            id: 'admin-tabs',
            target: '[data-tour="admin-tabs"]',
            content: "These tabs are your main modules. The tutorial highlights each module so new admins can navigate faster.",
        },
        {
            id: 'admin-time-tracker',
            target: '[data-tour="admin-tab-time-tracker"]',
            content: "Time Tracker is used for shift operations: monitoring shifts, creating/editing entries, and applying filters.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-filters-prompt',
            target: '[data-tour="admin-filters"]',
            title: "Filter system overview",
            content: "This is the filter system. Would you like a deeper walkthrough for each filter button and field?",
            data: {
                activateTab: 'time-tracker',
                prompt: {
                    yesLabel: "Yes, go deeper",
                    noLabel: "No, next section",
                    noGoToId: "admin-action-export"
                }
            }
        },
        {
            target: '[data-tour="admin-filter-search"]',
            content: "Search filter: type worker name, ID, or site text to narrow shifts quickly.",
            data: { activateTab: 'time-tracker' }
        },
        {
            target: '[data-tour="admin-filter-status"]',
            content: "Status tabs filter shifts by all/completed/in-progress for quick review.",
            data: { activateTab: 'time-tracker' }
        },
        {
            target: '[data-tour="admin-filter-date"]',
            content: "Date tabs switch all/month/year filtering, then month/year selectors refine the range.",
            data: { activateTab: 'time-tracker' }
        },
        {
            target: '[data-tour="admin-filter-site"]',
            content: "Site dropdown isolates shifts to a single work location.",
            data: { activateTab: 'time-tracker' }
        },
        {
            target: '[data-tour="admin-filter-worker-id"]',
            content: "Worker ID filter narrows the list to a specific employee.",
            data: { activateTab: 'time-tracker' }
        },
        {
            target: '[data-tour="admin-edit-shift"]',
            content: "Edit button opens the shift editor for corrections to time, breaks, or leave type.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-action-export',
            target: '[data-tour="admin-action-export"]',
            content: "Export Excel downloads current Time Tracker data based on active filters.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-action-print',
            target: '[data-tour="admin-action-print"]',
            content: "Print Timesheet & Payslip opens the print flow for preparing documents by selected worker and period.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-action-passout',
            target: '[data-tour="admin-action-passout"]',
            content: "Pass Out Payslip publishes payslip and timesheet documents to worker accounts for the selected period.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-action-create-shift',
            target: '[data-tour="admin-action-create-shift"]',
            content: "Create Shift is for manual shift entry with work date, site, break slots, and leave type controls.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-action-delete-all',
            target: '[data-tour="admin-action-delete-all"]',
            content: "Delete All removes shifts in bulk and is protected by PIN to avoid accidental data loss.",
            data: { activateTab: 'time-tracker' }
        },
        {
            id: 'admin-leaves-tab',
            target: '[data-tour="admin-tab-leaves"]',
            content: "Leaves tab is where admins review and approve or reject worker leave requests.",
            data: { activateTab: 'leaves' }
        },
        {
            target: '[data-tour="admin-leaves-panel"]',
            content: "This panel lists pending leave requests with key details such as duration, dates, and reason.",
            data: { activateTab: 'leaves' }
        },
        {
            target: '[data-tour="admin-leaves-history"]',
            content: "History opens the processed leave archive for audit and follow-up checks.",
            data: { activateTab: 'leaves' }
        },
        {
            id: 'admin-payslip',
            target: '[data-tour="admin-tab-payslip"]',
            content: "Payslip Report summarizes generated payslip values for each worker and supports quick validation.",
            data: { activateTab: 'payslip-report' }
        },
        {
            target: '[data-tour="admin-payslip-panel"]',
            content: "Use the month selector and load button to review all passed-out payslip values quickly.",
            data: { activateTab: 'payslip-report' }
        },
        {
            id: 'admin-timesheet',
            target: '[data-tour="admin-tab-timesheet"]',
            content: "Timesheet tab shows monthly totals (Basic, OT, Sun/PH) and lets you lock or unlock timesheet access per worker.",
            data: { activateTab: 'timesheet-report' }
        },
        {
            target: '[data-tour="admin-timesheet-panel"]',
            content: "Load Timesheet Data to calculate totals for workers who have passed-out records in that month.",
            data: { activateTab: 'timesheet-report' }
        },
        {
            target: '[data-tour="admin-timesheet-load"]',
            content: "This button runs the monthly timesheet aggregation before lock/unlock actions.",
            data: { activateTab: 'timesheet-report' }
        },
        {
            id: 'admin-worker-info',
            target: '[data-tour="admin-tab-worker-info"]',
            content: "Worker Information is where you create or update worker profiles, salary fields, and status settings.",
            data: { activateTab: 'worker-info' }
        },
        {
            target: '[data-tour="admin-worker-info-panel"]',
            content: "This page provides quick actions like Add Worker, Edit Worker, Delete Worker, and manager management.",
            data: { activateTab: 'worker-info' }
        },
        {
            target: '[data-tour="admin-worker-add"]',
            content: "Add Worker opens onboarding forms for new local or foreign worker records.",
            data: { activateTab: 'worker-info' }
        },
        {
            id: 'admin-sites',
            target: '[data-tour="admin-tab-sites"]',
            content: "Sites is used to manage available work locations that appear in shift creation and tracking flows.",
            data: { activateTab: 'sites' }
        },
        {
            target: '[data-tour="admin-sites-panel"]',
            content: "Sites page manages site metadata and QR tokens used for attendance scanning.",
            data: { activateTab: 'sites' }
        },
        {
            target: '[data-tour="admin-sites-add"]',
            content: "Add Site creates a new site and issues its QR token for worker scans.",
            data: { activateTab: 'sites' }
        },
    ]), []);

    const handleAdminTourStepChange = (step) => {
        const stepTab = step?.data?.activateTab;
        if (stepTab) {
            setActiveDashboardTab(stepTab);
        }
    };
        
        
    // New state for enhanced monthly payslip generation
    const [showMonthlyPayslipDialog, setShowMonthlyPayslipDialog] = useState(false);
    const [monthlyPayslipPeriod, setMonthlyPayslipPeriod] = useState({ startDate: '', endDate: '' });
    const [monthlyPayslipWorkers, setMonthlyPayslipWorkers] = useState([]);
    const [monthlyPayslipStep, setMonthlyPayslipStep] = useState(1); // 1: period, 2: workers list, 3: individual worker setup
    const [showEditShiftDialog, setShowEditShiftDialog] = useState(false);
    const [editingShift, setEditingShift] = useState(null);
    const [approvingShiftId, setApprovingShiftId] = useState(null);
    const [editSaveAndApprove, setEditSaveAndApprove] = useState(false);
    const adminShiftSaveApproveRef = useRef(false);
    const [shiftEditData, setShiftEditData] = useState({
        entry_time: '',
        leave_time: '',
        breaks: [{ lunch_start: '', lunch_end: '' }],
        leave_type: '__none__',
        originalBreaks: []
    });
    
    // Cache for breaks data to avoid repeated queries
    const [breaksCache, setBreaksCache] = useState(new Map());

    // Optimized function to get breaks data with caching
    const getBreaksData = async (shiftId) => {
        // Check cache first - this should be instant for most cases
        if (breaksCache.has(shiftId)) {
            log.debug('Using cached breaks for shift:', shiftId);
            return breaksCache.get(shiftId);
        }

        // Fetch from database only if not in cache (should rarely happen)
        log.debug('Fetching breaks for shift:', shiftId);
        const { data: breaks } = await supabase
            .from('breaks')
            .select('*')
            .eq('shift_id', shiftId)
            .order('break_start', { ascending: true });

        // Cache the result for future use
        setBreaksCache(prev => new Map(prev).set(shiftId, breaks || []));
        log.debug('Cached breaks for shift:', shiftId, breaks);
        
        return breaks || [];
    };

    const [showCreateShiftDialog, setShowCreateShiftDialog] = useState(false);
    const [createShiftData, setCreateShiftData] = useState({
        worker_id: '',
        site_id: '',
        work_date: '',
        entry_time: '',
        leave_time: '',
        breaks: [{ lunch_start: '', lunch_end: '' }],
        leave_type: '__none__'
    });

    const timeTrackerFormOpen =
        showEditShiftDialog ||
        showCreateShiftDialog ||
        showPrintDialog ||
        printWorkerTypeDialog ||
        showMultiPrintDialog ||
        showPassOutPayslipDialog ||
        showPassOutTimesheetDialog ||
        showDeleteDialog ||
        showIndividualDeletePinDialog;

    const [showAddSiteDialog, setShowAddSiteDialog] = useState(false);
    const [showEditSiteDialog, setShowEditSiteDialog] = useState(false);
    
    // Manager management state
    const [showManagerDialog, setShowManagerDialog] = useState(false);
    const [editingManager, setEditingManager] = useState(null);
    const [managerFormData, setManagerFormData] = useState({
        email: '',
        password_hash: '',
        name: ''
    });

    // Supervisor management state
    const [showSupervisorDialog, setShowSupervisorDialog] = useState(false);
    const [editingSupervisor, setEditingSupervisor] = useState(null);
    const [supervisorFormData, setSupervisorFormData] = useState({
        supervisor_id: '',
        password_hash: '',
        name: '',
        site_id: '',
        email: '',
        phone: ''
    });
    const [pendingDeleteSite, setPendingDeleteSite] = useState(null);
    const [editingSite, setEditingSite] = useState(null);
    const [siteFormData, setSiteFormData] = useState({
        id: '',
        site_name: '',
        latitude: '',
        longitude: '',
        qr_token: ''
    });
    const [siteQrDataUrl, setSiteQrDataUrl] = useState('');
    /** Row action: show QR in a dialog (mobile WebViews often ignore <a download>) */
    const [siteQrPreview, setSiteQrPreview] = useState(null);

    const generateId = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    const generateQrToken = (name) => {
        const rawName = (name || siteFormData.site_name || 'SITE').toString().trim();
        const base = rawName.replace(/\s+/g, '_').toUpperCase();
        return `${base}_TOKEN`;
    };

    useEffect(() => {
        setActiveDashboardTab((tab) => (tab === 'salary-report' ? 'time-tracker' : tab));
    }, []);

    useEffect(() => {
        let isActive = true;
        const token = siteFormData.qr_token;
        if (!token) {
            setSiteQrDataUrl('');
            return () => {
                isActive = false;
            };
        }

        QRCode.toDataURL(token, { margin: 1, width: 256 })
            .then((url) => {
                if (isActive) setSiteQrDataUrl(url);
            })
            .catch(() => {
                if (isActive) setSiteQrDataUrl('');
            });

        return () => {
            isActive = false;
        };
    }, [siteFormData.qr_token, showAddSiteDialog, showEditSiteDialog]);

    const pad2 = (value) => String(value).padStart(2, '0');

    const formatAmount = (value) => {
        if (value === null || value === undefined || value === '') return '0.00';
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return '0.00';
        return num.toFixed(2);
    };

    // Leave editing states
    const [showEditLeaveDialog, setShowEditLeaveDialog] = useState(false);
    const [editingLeave, setEditingLeave] = useState(null);
    const [leaveEditData, setLeaveEditData] = useState({
        leave_type: '',
        leave_duration: '',
        from_date: '',
        to_date: ''
    });
    const [leaveEditSoftWarnings, setLeaveEditSoftWarnings] = useState([]);
    const [leaveEditHardWarnings, setLeaveEditHardWarnings] = useState([]);
    const [selectedLeaveIds, setSelectedLeaveIds] = useState([]);
    const [showLeavePolicyDialog, setShowLeavePolicyDialog] = useState(false);
    const [leavePolicyForm, setLeavePolicyForm] = useState({ ...DEFAULT_LEAVE_POLICY });
    const [blackoutForm, setBlackoutForm] = useState({
        from_date: '',
        to_date: '',
        site_id: '',
        reason: '',
    });
    const [showCreateLeaveDialog, setShowCreateLeaveDialog] = useState(false);
    const [adminLeaveData, setAdminLeaveData] = useState({
        employee_id: '',
        leave_type: 'Annual Leave',
        leave_duration: 'full_day',
        from_date: '',
        to_date: '',
        reason: '',
    });
    const [adminLeaveAttachment, setAdminLeaveAttachment] = useState(null);

    // Worker Information states
    const [showWorkerTypeDialog, setShowWorkerTypeDialog] = useState(false);
    const [showAddWorkerDialog, setShowAddWorkerDialog] = useState(false);
    const [showEditWorkerDialog, setShowEditWorkerDialog] = useState(false);
    const [showDeleteWorkerDialog, setShowDeleteWorkerDialog] = useState(false);
    const [selectedWorkerType, setSelectedWorkerType] = useState(''); // 'local' or 'foreign'
    const [editWorkerId, setEditWorkerId] = useState('');
    const [editWorkerType, setEditWorkerType] = useState(''); // 'local' | 'foreign' — pinned for edit save
    const [deleteWorkerId, setDeleteWorkerId] = useState('');
    const [deleteWorkerType, setDeleteWorkerType] = useState(''); // Store worker type for deletion
    const [showFaceIDEnrollmentDialog, setShowFaceIDEnrollmentDialog] = useState(false);
    const [faceIDEnrollmentWorker, setFaceIDEnrollmentWorker] = useState(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [deletePasswordError, setDeletePasswordError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showWorkerSearchDialog, setShowWorkerSearchDialog] = useState(false);
    const [workerSearchId, setWorkerSearchId] = useState('');
    const [workerSearchLoading, setWorkerSearchLoading] = useState(false);
    const [workerSearchResult, setWorkerSearchResult] = useState(null);
    const [showYearlySummaryDialog, setShowYearlySummaryDialog] = useState(false);
    const [yearlySummaryYear, setYearlySummaryYear] = useState(String(new Date().getFullYear()));
    const [workerFormData, setWorkerFormData] = useState({
        employee_id: '',
        nric_fin: '',
        employee_name: '',
        designation: '',
        date_joined: '',
        bank_account_number: '',
        ot_rate_per_hour: '',
        sun_ph_rate_per_day: '',
        basic_salary_per_day: '',
        monthly_allowance: '150',
        password: '',
        annual_leave_limit: '10',
        medical_leave_limit: '14',
        hospitalization_leave_limit: '60',
        annual_leave_balance: '10',
        medical_leave_balance: '14',
        hospitalization_leave_balance: '60',
        birthday: '',
        name: '',
        password_hash: '',
        stored_password_encrypted: false,
        face_id_enabled: true, // Default to enabled
        in_company: true,
        date_of_cessation: '',
        rejoin_dates: [],
        sinda_eligible: false
    });

    // Calculated values for Local workers
    const [calculatedCPFEmployee, setCalculatedCPFEmployee] = useState(0);
    const [calculatedCPFEmployer, setCalculatedCPFEmployer] = useState(0);
    const [calculatedSINDA, setCalculatedSINDA] = useState(0);

    const [accumulatedCPFEmployee, setAccumulatedCPFEmployee] = useState(0);
    const [accumulatedEmployerCPF, setAccumulatedEmployerCPF] = useState(0);
    const [totalAccumulatedSalary, setTotalAccumulatedSalary] = useState(0);

    // Helper function to fetch worker details from either local_worker_details or worker_details
    const fetchWorkerDetails = async (workerId) => {
        try {
            // Try local_worker_details first
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('*')
                .eq('employee_id', workerId)
                .single();

            if (!localError && localWorker) {
                return { ...localWorker, type: 'local' };
            }

            // If not found in local_worker_details, try worker_details
            const { data: foreignWorker, error: foreignError } = await supabase
                .from('worker_details')
                .select('*')
                .eq('employee_id', workerId)
                .single();

            if (!foreignError && foreignWorker) {
                return { ...foreignWorker, type: 'foreign' };
            }

            // If we get here, worker wasn't found in either table
            console.warn('Worker not found in any table:', workerId);
            return null;

        } catch (error) {
            console.error('Error fetching worker details:', error);
            return null;
        }
    };

    // Function to calculate accumulated values
    const calculateAccumulatedValues = async (workerId, currentMonth, currentYear) => {
        try {
            const workerDetails = await fetchWorkerDetails(workerId);
            if (!workerDetails) {
                console.warn('Worker details not found, using 0 for accumulated values');
                setTotalAccumulatedSalary(0);
                setAccumulatedCPFEmployee(0);
                setAccumulatedEmployerCPF(0);
                return;
            }

            const nextMonthStart = ymdStartOfNextMonth(currentYear, currentMonth);
            let totalSalary = 0;
            let totalEmployeeCPF = 0;
            let totalEmployerCPF = 0;

            if (workerDetails.type === 'local') {
                const { data: payslipRows, error } = await supabase
                    .from('local_worker_payslip_history')
                    .select(LOCAL_PAYSLIP_YTD_COLUMNS)
                    .eq('employee_id', workerId)
                    .eq('period_year', Number(currentYear))
                    .lte('period_month', Number(currentMonth));
                if (error) throw error;

                (payslipRows || []).forEach((row) => {
                    totalSalary += payslipHistoryNetPay(row);
                    totalEmployeeCPF += parseFloat(row.cpf_employee || 0);
                    totalEmployerCPF += parseFloat(row.cpf_employer || 0);
                });
            } else {
                const { data: payslipRows, error } = await supabase
                    .from('payslip_history')
                    .select('total_additions, cpf_employee_deduction, cpf_employer_contribution, payslip_month')
                    .eq('worker_id', workerId)
                    .lt('payslip_month', nextMonthStart);
                if (error) throw error;

                (payslipRows || []).forEach((row) => {
                    totalSalary += parseFloat(row.total_additions || 0);
                    totalEmployeeCPF += parseFloat(row.cpf_employee_deduction || 0);
                    totalEmployerCPF += parseFloat(row.cpf_employer_contribution || 0);
                });
            }

            setTotalAccumulatedSalary(Number(totalSalary.toFixed(2)));
            setAccumulatedCPFEmployee(Number(totalEmployeeCPF.toFixed(2)));
            setAccumulatedEmployerCPF(Number(totalEmployerCPF.toFixed(2)));

        } catch (error) {
            console.error('Error calculating accumulated values:', error);
            // Set to 0 if error occurs
            setTotalAccumulatedSalary(0);
            setAccumulatedCPFEmployee(0);
            setAccumulatedEmployerCPF(0);
        }
    };

    const queryClient = useQueryClient();
    const adminEmail = sessionStorage.getItem(storageKey('timesheet', 'adminEmail'));
    const [adminStatusId, setAdminStatusId] = useState(null);

    useEffect(() => {
        if (!adminEmail) return undefined;
        void registerPushForAdmin(adminEmail);
        return undefined;
    }, [adminEmail]);

    // Leave requests query - ALL requests for history
    const { data: allLeaveRequests = [], isLoading: isLoadingAllLeaveRequests } = useQuery({
        queryKey: ['allLeaveRequests'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('leave_requests')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!data?.length) return [];

            const directoryMap = await fetchWorkerDirectoryMap(
                supabase,
                data.map((request) => request.employee_id),
                'employee_id, employee_name, in_company'
            );

            return data.map((request) => ({
                ...request,
                employee_name: directoryMap.get(request.employee_id)?.employee_name || 'Unknown',
                in_company: directoryMap.get(request.employee_id)?.in_company,
            }));
        },
        staleTime: 30000, // Consider data fresh for 30 seconds
        gcTime: 5 * 60 * 1000 // Garbage collect after 5 minutes
    });

    // Pending leave requests query
    const { data: leaveRequests = [], isLoading: isLoadingLeaveRequests } = useQuery({
        queryKey: ['leaveRequests'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('leave_requests')
                .select('*')
                .in('status', ['pending_admin', 'pending'])
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!data?.length) return [];
            const directoryMap = await fetchWorkerDirectoryMap(
                supabase,
                data.map((request) => request.employee_id),
                'employee_id, employee_name, in_company'
            );

            return data
                .map((request) => ({
                    ...request,
                    employee_name: directoryMap.get(request.employee_id)?.employee_name || 'Unknown',
                    in_company: directoryMap.get(request.employee_id)?.in_company,
                }))
                .filter((request) => !workerIsNotInCompanyEmployment(request));
        },
        refetchInterval: 30000, // Refresh every 30 seconds (optimized from 3 seconds for better performance)
    });

    const { data: leavePolicySettings } = useQuery({
        queryKey: ['leavePolicySettings'],
        queryFn: () => fetchLeavePolicy(supabase),
        staleTime: 60_000,
    });

    const { data: leaveBlackoutDates = [] } = useQuery({
        queryKey: ['leaveBlackoutDates'],
        queryFn: () => fetchBlackoutDates(supabase),
        staleTime: 60_000,
    });

    const leaveDashboardStats = useMemo(
        () => computeLeaveDashboardStats(allLeaveRequests),
        [allLeaveRequests]
    );

    const openLeaveAttachment = async (attachmentPath) => {
        const url = await getLeaveAttachmentSignedUrl(supabase, attachmentPath);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else toast.error('Could not open attachment');
    };

    // Delete leave request mutation
    const deleteLeaveMutation = useMutation({
        mutationFn: async (leaveId) => {
            const { data: leaveRequest, error: fetchError } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('id', leaveId)
                .single();

            if (fetchError) throw fetchError;

            await processLeaveDeletionEffects(supabase, leaveRequest);

            const { error: deleteError } = await supabase
                .from('leave_requests')
                .delete()
                .eq('id', leaveId);

            if (deleteError) throw deleteError;

            return leaveRequest;
        },
        onSuccess: (data, leaveId) => {
            log.info('LEAVE DELETE SUCCESSFUL - Leave ID:', leaveId, 'Worker:', data.employee_id);

            // Force refetch all relevant queries
            queryClient.refetchQueries({ queryKey: ['allLeaveRequests'] });
            queryClient.refetchQueries({ queryKey: ['leaveRequests'] });
            queryClient.refetchQueries({ queryKey: ['shifts'] });
            queryClient.refetchQueries({ queryKey: ['workerData'] });
            queryClient.refetchQueries({ queryKey: ['workerLeaveHistory'] });
            queryClient.refetchQueries({ queryKey: ['workerLeaveHistory', data.employee_id] });

            // Close the leave history dialog to force UI refresh
            setShowLeaveHistory(false);

            toast.success('Leave request deleted successfully!');
        },
        onError: (error) => {
            console.error('LEAVE DELETE FAILED:', error);
            toast.error(`Failed to delete leave request: ${error.message}`);
        },
    });

    const handlePrintSingleLeaveForm = async (request) => {
        try {
            setIsPrintingLeaveForms(true);
            const result = await printLeaveForms({ requests: [request], logoUrl });
            toast.success(
                result?.mode === 'share'
                    ? 'Leave form ready — choose an app to save, print, or share'
                    : 'Opening leave form for printing…'
            );
        } catch (error) {
            toast.error(error?.message || 'Failed to print leave form');
        } finally {
            setIsPrintingLeaveForms(false);
        }
    };

    const handlePrintLeaveFormsInRange = async () => {
        if (!leavePrintFromDate || !leavePrintToDate) {
            toast.error('Select both from and to dates');
            return;
        }
        if (leavePrintFromDate > leavePrintToDate) {
            toast.error('From date must be on or before to date');
            return;
        }
        const filtered = filterLeavesByDateRange(allLeaveRequests, leavePrintFromDate, leavePrintToDate);
        if (!filtered.length) {
            toast.error('No leave requests overlap that date range');
            return;
        }
        try {
            setIsPrintingLeaveForms(true);
            const rangeLabel = `${formatDate(leavePrintFromDate)} — ${formatDate(leavePrintToDate)}`;
            const result = await printLeaveForms({ requests: filtered, logoUrl, rangeLabel });
            toast.success(
                result?.mode === 'share'
                    ? `Leave forms ready — choose an app to save, print, or share (${filtered.length})`
                    : `Opening ${filtered.length} leave form(s) for printing…`
            );
        } catch (error) {
            toast.error(error?.message || 'Failed to print leave forms');
        } finally {
            setIsPrintingLeaveForms(false);
        }
    };

    // Update leave status mutation
    const updateLeaveStatus = useMutation({
        mutationFn: async ({ id, status, adminNotes, rejectionReason }) => {
            const { data: leaveRequest, error: fetchError } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError) throw fetchError;

            const normalizedLeaveType = normalizeLeaveType(leaveRequest.leave_type);
            const employeeId = leaveRequest.employee_id;

            if (status === 'cancelled') {
                await processLeaveCancellationEffects(supabase, leaveRequest);
            }

            const previousStatus = leaveRequest.status;

            if (status === 'approved') {
                const policy = leavePolicySettings || (await fetchLeavePolicy(supabase));
                const requestedDays = countRequestedLeaveDays(leaveRequest);
                if (
                    requiresMedicalAttachment({
                        leaveType: normalizedLeaveType,
                        requestedDays,
                        policy,
                    }) &&
                    !leaveRequest.attachment_path
                ) {
                    throw new Error(
                        `Cannot approve: Medical/Hospitalization leave of ${policy.mc_attachment_min_days}+ day(s) requires an attachment.`
                    );
                }

                const conflictCheck = await evaluateLeaveConflicts({
                    supabase,
                    employeeId,
                    fromDate: leaveRequest.from_date,
                    toDate: leaveRequest.to_date,
                    leaveType: normalizedLeaveType,
                    leaveDuration: leaveRequest.leave_duration,
                    siteId: leaveRequest.site_id || null,
                    attachmentPath: leaveRequest.attachment_path || null,
                    excludingLeaveId: leaveRequest.id,
                    policy,
                });
                if (conflictCheck.hard?.length) {
                    throw new Error(conflictCheck.hard[0]);
                }

                const overlap = await hasOverlappingLeaveRequest({
                    supabase,
                    employeeId,
                    fromDate: leaveRequest.from_date,
                    toDate: leaveRequest.to_date,
                    excludingLeaveId: leaveRequest.id,
                });
                if (overlap) {
                    throw new Error('Cannot approve because this leave overlaps another active leave request.');
                }

                const { error: preApproveError } = await supabase
                    .from('leave_requests')
                    .update({
                        status: 'approved',
                        admin_notes: adminNotes,
                        leave_type: normalizedLeaveType,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
                if (preApproveError) throw preApproveError;

                try {
                    await processLeaveApprovalEffects(supabase, {
                        ...leaveRequest,
                        leave_type: normalizedLeaveType,
                        status: 'approved',
                    });
                } catch (approvalEffectsError) {
                    await supabase
                        .from('leave_requests')
                        .update({
                            status: previousStatus,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', id);
                    throw approvalEffectsError;
                }

                return leaveRequest;
            }

            const rejectReason =
                status === 'rejected'
                    ? String(rejectionReason || adminNotes || '').trim()
                    : null;
            if (status === 'rejected' && !rejectReason) {
                throw new Error('A rejection reason is required');
            }

            const updatePayload = {
                status,
                admin_notes: status === 'rejected' ? rejectReason : adminNotes,
                leave_type: normalizedLeaveType,
                updated_at: new Date().toISOString(),
            };
            if (status === 'rejected') {
                updatePayload.rejection_reason = rejectReason;
            }

            const { error: updateError } = await supabase
                .from('leave_requests')
                .update(updatePayload)
                .eq('id', id);
            if (updateError) throw updateError;

            return leaveRequest;
        },
        onSuccess: (data) => {
            // Invalidate all relevant queries to refresh data immediately
            queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
            queryClient.invalidateQueries({ queryKey: ['workerData'] }); // Force balance refresh
            queryClient.invalidateQueries({ queryKey: ['workerLeaveHistory'] }); // Force history refresh
            queryClient.invalidateQueries({ queryKey: ['workerLeaveHistory', data.employee_id] });
            setSelectedLeaveIds([]);

            toast.success('Leave request updated successfully - refreshing data...');

            // Silent refresh: Invalidate all queries to force data refresh without page reload
            setTimeout(() => {
                log.debug('Silent refresh of all data after leave approval...');
                queryClient.invalidateQueries({ queryKey: ['workerData'] });
                queryClient.invalidateQueries({ queryKey: ['workerLeaveHistory'] });
                queryClient.invalidateQueries({ queryKey: ['workerLeaveHistory', data.employee_id] });
                queryClient.invalidateQueries({ queryKey: ['workerBalance'] });
                queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
                queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
                queryClient.invalidateQueries({ queryKey: ['shifts'] });
            }, 1000);
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to update leave request');
        },
    });

    const bulkLeaveStatusMutation = useMutation({
        mutationFn: async ({ leaveIds, status, rejectionReason }) => {
            if (status === 'approved') {
                const policy = leavePolicySettings || (await fetchLeavePolicy(supabase));
                for (const id of leaveIds) {
                    const leaveRequest = leaveRequests.find((r) => r.id === id)
                        || allLeaveRequests.find((r) => r.id === id);
                    if (!leaveRequest) continue;
                    const requestedDays = countRequestedLeaveDays(leaveRequest);
                    if (
                        requiresMedicalAttachment({
                            leaveType: leaveRequest.leave_type,
                            requestedDays,
                            policy,
                        }) &&
                        !leaveRequest.attachment_path
                    ) {
                        throw new Error(
                            `Cannot approve ${leaveRequest.employee_id}: MC/Hospitalization attachment required.`
                        );
                    }
                }
            }
            return bulkUpdateLeaveStatus(supabase, {
                leaveIds,
                status,
                rejectionReason: rejectionReason || null,
                adminNotes: rejectionReason || null,
            });
        },
        onSuccess: (results) => {
            const ok = (results || []).filter((r) => r.ok).length;
            const fail = (results || []).length - ok;
            if (fail) toast.error(`${ok} updated, ${fail} failed`);
            else toast.success(`${ok} leave request(s) updated`);
            setSelectedLeaveIds([]);
            queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
            queryClient.invalidateQueries({ queryKey: ['workerData'] });
        },
        onError: (error) => toast.error(error?.message || 'Bulk update failed'),
    });

    const saveLeavePolicyMutation = useMutation({
        mutationFn: async (updates) => saveLeavePolicy(supabase, updates),
        onSuccess: () => {
            toast.success('Leave policy saved');
            queryClient.invalidateQueries({ queryKey: ['leavePolicySettings'] });
        },
        onError: (e) => toast.error(e?.message || 'Failed to save policy'),
    });

    const addBlackoutMutation = useMutation({
        mutationFn: async (row) => {
            const { error } = await supabase.from('leave_blackout_dates').insert([row]);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Blackout period added');
            setBlackoutForm({ from_date: '', to_date: '', site_id: '', reason: '' });
            queryClient.invalidateQueries({ queryKey: ['leaveBlackoutDates'] });
        },
        onError: (e) => toast.error(e?.message || 'Failed to add blackout'),
    });

    const deleteBlackoutMutation = useMutation({
        mutationFn: async (id) => {
            const { error } = await supabase.from('leave_blackout_dates').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Blackout removed');
            queryClient.invalidateQueries({ queryKey: ['leaveBlackoutDates'] });
        },
        onError: (e) => toast.error(e?.message || 'Failed to delete blackout'),
    });

    const promptLeaveRejectReason = () => {
        const reason = prompt('Reason for rejection (required):');
        if (reason === null) return null;
        const trimmed = String(reason).trim();
        if (!trimmed) {
            toast.error('A rejection reason is required');
            return null;
        }
        return trimmed;
    };

    const handleExportLeaveReport = async () => {
        const workerNameById = {};
        for (const r of allLeaveRequests) {
            if (r.employee_id) workerNameById[r.employee_id] = r.employee_name || '';
        }
        for (const w of localWorkers || []) {
            if (w.employee_id) workerNameById[w.employee_id] = w.employee_name || w.name || '';
        }
        for (const w of foreignWorkers || []) {
            if (w.employee_id) workerNameById[w.employee_id] = w.employee_name || w.name || '';
        }
        const siteNameById = {};
        for (const s of allSites || []) {
            if (s.id) siteNameById[s.id] = s.name || s.site_name || s.id;
        }
        const rows = leaveRequests?.length ? leaveRequests : allLeaveRequests;
        await exportLeaveReportExcel(rows, {
            filename: `leave-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`,
            workerNameById,
            siteNameById,
        });
        toast.success(`Exported ${rows.length} leave row(s)`);
    };

    const createLeaveOnBehalf = useMutation({
        mutationFn: async () => {
            if (!adminLeaveData.employee_id || !adminLeaveData.leave_type || !adminLeaveData.from_date || !adminLeaveData.to_date) {
                throw new Error('Fill in all required leave fields');
            }

            const normalizedType = normalizeLeaveType(adminLeaveData.leave_type);
            const overlap = await hasOverlappingLeaveRequest({
                supabase,
                employeeId: adminLeaveData.employee_id,
                fromDate: adminLeaveData.from_date,
                toDate: adminLeaveData.to_date,
            });
            if (overlap) {
                throw new Error('Cannot create leave because dates overlap an active leave.');
            }

            const daysRequested = countRequestedLeaveDays({
                ...adminLeaveData,
                leave_type: normalizedType,
            });
            const policy = leavePolicySettings || (await fetchLeavePolicy(supabase));
            if (
                requiresMedicalAttachment({
                    leaveType: normalizedType,
                    requestedDays: daysRequested,
                    policy,
                }) &&
                !adminLeaveAttachment
            ) {
                throw new Error(
                    `Medical/Hospitalization leave of ${policy?.mc_attachment_min_days ?? 1}+ day(s) requires an attachment.`
                );
            }

            let attachment_path = null;
            if (adminLeaveAttachment) {
                const prepared = await prepareLeaveAttachment(adminLeaveAttachment);
                const safeName = (prepared.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
                const uploadPath = `${adminLeaveData.employee_id}/${Date.now()}_${safeName}`;
                const { error: uploadError } = await supabase.storage
                    .from('leave-attachments')
                    .upload(uploadPath, prepared, { upsert: false, contentType: prepared.type || undefined });
                if (uploadError) {
                    throw new Error(uploadError.message || 'Could not upload the attachment');
                }
                attachment_path = uploadPath;
            }

            const { data: inserted, error: insertError } = await supabase
                .from('leave_requests')
                .insert({
                    employee_id: adminLeaveData.employee_id,
                    leave_type: normalizedType,
                    leave_duration: adminLeaveData.leave_duration,
                    from_date: adminLeaveData.from_date,
                    to_date: adminLeaveData.to_date,
                    reason: adminLeaveData.reason || 'Created by admin',
                    status: 'pending_admin',
                    admin_notes: 'Created by admin',
                    days_requested: daysRequested,
                    attachment_path,
                })
                .select('id')
                .single();
            if (insertError) throw insertError;

            await updateLeaveStatus.mutateAsync({
                id: inserted.id,
                status: 'approved',
                adminNotes: `Approved on create by admin`,
            });
        },
        onSuccess: () => {
            toast.success('Leave created and approved');
            setShowCreateLeaveDialog(false);
            setAdminLeaveData({
                employee_id: '',
                leave_type: 'Annual Leave',
                leave_duration: 'full_day',
                from_date: '',
                to_date: '',
                reason: '',
            });
            setAdminLeaveAttachment(null);
            queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
            queryClient.invalidateQueries({ queryKey: ['workerData'] });
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
        },
        onError: (error) => {
            toast.error(error.message || 'Failed to create leave');
        },
    });

    // Generate bulk payslips mutation
    const generateBulkPayslips = useMutation({
        mutationFn: async () => {
            const currentDate = new Date();
            const currentYear = currentDate.getFullYear();
            const currentMonth = currentDate.getMonth() + 1;

            // Get all local and foreign workers
            const [localResult, foreignResult] = await Promise.all([
                supabase.from('local_worker_details').select('*').order('employee_id'),
                supabase.from('worker_details').select('*').order('employee_id')
            ]);

            if (localResult.error) throw localResult.error;
            if (foreignResult.error) throw foreignResult.error;

            const allWorkers = [
                ...(localResult.data || []).map(w => ({ ...w, worker_type: 'local' })),
                ...(foreignResult.data || []).map(w => ({ ...w, worker_type: 'foreign' }))
            ];

            if (allWorkers.length === 0) {
                throw new Error('No workers found in the system');
            }

            // Get working days for the month
            const { data: workingDaysData, error: workingDaysError } = await supabase
                .from('working_days_config')
                .select('working_days')
                .eq('year', currentYear)
                .eq('month', currentMonth)
                .maybeSingle();

            if (workingDaysError || !workingDaysData) {
                toast.error(`Working days configuration missing for ${currentYear}-${String(currentMonth).padStart(2, '0')}`);
                throw new Error('Working days configuration not found for current month');
            }

            const workingDays = workingDaysData.working_days;

            // Process each worker
            const payslipPromises = allWorkers.map(async (worker) => {
                try {
                    // Get all shifts for the worker in the current month
                    const startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
                    const endDate = ymdStartOfNextMonth(currentYear, currentMonth);

                    const { data: workerShifts, error: shiftsError } = await supabase
                        .from('shifts')
                        .select('*')
                        .eq('worker_id', worker.employee_id)
                        .gte('work_date', startDate)
                        .lt('work_date', endDate)
                        .order('work_date', { ascending: true });

                    if (shiftsError) throw shiftsError;

                    let payrollShifts = filterShiftsForPayroll(workerShifts || []);
                    if (payrollShifts.length > 0) {
                        const shiftIds = payrollShifts.map((shift) => shift.id);
                        const { data: allBreaks } = await supabase
                            .from('breaks')
                            .select('*')
                            .in('shift_id', shiftIds)
                            .order('break_start', { ascending: true });
                        const breaksByShiftId = {};
                        (allBreaks || []).forEach((breakRow) => {
                            if (!breaksByShiftId[breakRow.shift_id]) breaksByShiftId[breakRow.shift_id] = [];
                            breaksByShiftId[breakRow.shift_id].push(breakRow);
                        });
                        payrollShifts = payrollShifts.map((shift) => ({
                            ...shift,
                            breaks: breaksByShiftId[shift.id] || []
                        }));
                    }

                    // Calculate totals
                    let monthlyBasicHours = 0;
                    let totalWorkedHours = 0;
                    let monthlySundayHours = 0;
                    let monthlyPayableOtHours = 0;
                    let monthlyIncentiveHours = 0;
                    const shiftsByDate = {};

                    payrollShifts.forEach((shift) => {
                        if (!shiftsByDate[shift.work_date]) shiftsByDate[shift.work_date] = [];
                        shiftsByDate[shift.work_date].push(shift);
                    });

                    Object.entries(shiftsByDate).forEach(([workDate, dayShifts]) => {
                        if (!isWorkerPayEligibleOnDate(worker, workDate)) return;
                        let dayBasicHours = 0;
                        let daySundayHours = 0;
                        let dayOtHours = 0;

                        dayShifts.forEach((shift) => {
                            if (shift.has_left && !shift.leave_type) {
                                const recalc = calculateShiftHours(
                                    shift.entry_time,
                                    shift.leave_time,
                                    shift.breaks || [],
                                    shift.work_date
                                );
                                dayBasicHours += recalc.basicHours;
                                daySundayHours += recalc.sundayHours;
                                dayOtHours += recalc.otHours;
                            }
                        });

                        monthlyBasicHours += dayBasicHours;
                        monthlySundayHours += daySundayHours;
                        totalWorkedHours += (dayBasicHours + daySundayHours + dayOtHours);
                        monthlyPayableOtHours += Math.min(dayOtHours, 2);
                        monthlyIncentiveHours += Math.max(dayOtHours - 2, 0);
                    });

                    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        if (!isWorkerPayEligibleOnDate(worker, dateStr)) continue;
                        const dayShifts = shiftsByDate[dateStr] || [];
                        if (shouldCreditUnworkedPublicHoliday(dateStr) && dayShifts.length === 0) {
                            monthlyBasicHours += 8;
                        }
                    }

                    const totalBasicDays = monthlyBasicHours / 8;
                    const totalSunPhDays = monthlySundayHours / 8;

                    // Calculate salary components
                    const monthlyBasicSalary = worker.basic_salary_per_day;
                    const dailyBasicSalary = monthlyBasicSalary / workingDays;
                    const basicPay = dailyBasicSalary * totalBasicDays;

                    const otPay = monthlyPayableOtHours * worker.ot_rate_per_hour;
                    const incentiveAllowance = monthlyIncentiveHours * worker.ot_rate_per_hour;

                    const sunPhPay = totalSunPhDays * worker.sun_ph_rate_per_day;

                    const baseMonthlyAllowance = (parseFloat(worker.monthly_allowance ?? 0) || 0);
                    const monthlyAllowance = Math.min(
                        baseMonthlyAllowance,
                        Math.max(0, baseMonthlyAllowance * (totalBasicDays / workingDays))
                    );

                    const bonusAmount = 0; // No bonus for bulk generation

                    // Calculate CPF, SINDA, SDL for Local workers
                    let cpfEmployeeDeduction = 0;
                    let cpfEmployerContribution = 0;
                    let sindaDeduction = 0;
                    let sdlContribution = 0;

                    if (worker.worker_type === 'local') {
                        const { totalCpfBase: cpfWageBase } = computeCpfWageBase({
                            basicPay,
                            otPay,
                            sunPhPay,
                            allowances: monthlyAllowance + incentiveAllowance,
                            bonus: bonusAmount,
                        });

                        const payslipMonthDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
                        const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(
                            worker.birthday,
                            endOfMonthSgt(payslipMonthDate)
                        );

                        // Keep stored % rates in sync for display
                        await supabase
                            .from('local_worker_details')
                            .update({
                                cpf_employee_contribution: cpfEmployeeRate,
                                cpf_employer_contribution: cpfEmployerRate
                            })
                            .eq('employee_id', worker.employee_id);

                        cpfEmployeeDeduction = calculateCPFDeductions(
                            cpfWageBase,
                            cpfEmployeeRate,
                            0
                        ).employeeDeduction;

                        cpfEmployerContribution = calculateCPFDeductions(
                            cpfWageBase,
                            0,
                            cpfEmployerRate
                        ).employerContribution;

                    const sindaWageBase = sindaMonthlyWageBase({
                        basicPay,
                        otPay,
                        sunPhPay,
                        allowances: monthlyAllowance + incentiveAllowance,
                        bonus: bonusAmount,
                    });
                    sindaDeduction = resolveSindaDeduction(sindaWageBase, worker);
                        sdlContribution = calculateSDL(cpfWageBase);
                    }

                    // Calculate total additions and deductions
                    const totalAdditions = basicPay + otPay + sunPhPay + monthlyAllowance + incentiveAllowance + bonusAmount;
                    const totalDeductions = cpfEmployeeDeduction + sindaDeduction;
                    const netTotalPay = totalAdditions - totalDeductions;

                    // Create payslip history record
                    const payslipHistoryData = {
                        worker_id: worker.employee_id,
                        worker_type: worker.worker_type,
                        payslip_month: `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`,
                        payslip_year: currentYear,
                        basic_pay: Math.round(basicPay * 100) / 100,
                        ot_pay: Math.round(otPay * 100) / 100,
                        sun_ph_pay: Math.round(sunPhPay * 100) / 100,
                        allowance1: Math.round(monthlyAllowance * 100) / 100, // Monthly allowance
                        allowance2: Math.round(incentiveAllowance * 100) / 100, // Excess OT allowance
                        total_additions: Math.round(totalAdditions * 100) / 100,
                        cpf_employee_deduction: Math.round(cpfEmployeeDeduction * 100) / 100,
                        sinda_deduction: Math.round(sindaDeduction * 100) / 100,
                        cpf_employer_contribution: Math.round(cpfEmployerContribution * 100) / 100,
                        sdl_contribution: Math.round(sdlContribution * 100) / 100,
                        total_deductions: Math.round(totalDeductions * 100) / 100,
                        net_pay: Math.round(netTotalPay * 100) / 100
                    };

                    // Insert into payslip_history
                    const { error: insertError } = await supabase
                        .from('payslip_history')
                        .upsert([payslipHistoryData], { onConflict: 'worker_id,payslip_month,payslip_year' });

                    if (insertError) {
                        console.error('Error inserting payslip for worker:', worker.employee_id, insertError);
                        throw new Error(`Failed to generate payslip for ${worker.employee_name}`);
                    }

                    return {
                        worker_id: worker.employee_id,
                        worker_name: worker.employee_name || worker.name,
                        success: true
                    };

                } catch (workerError) {
                    console.error('Error processing worker:', worker.employee_id, workerError);
                    return {
                        worker_id: worker.employee_id,
                        worker_name: worker.employee_name || worker.name,
                        success: false,
                        error: workerError.message
                    };
                }
            });

            const results = await Promise.all(payslipPromises);

            // Check for failures
            const failures = results.filter(r => !r.success);
            if (failures.length > 0) {
                throw new Error(`Failed to generate payslips for ${failures.length} workers: ${failures.map(f => f.worker_name).join(', ')}`);
            }

            return {
                totalWorkers: allWorkers.length,
                successful: results.filter(r => r.success).length
            };
        },
        onSuccess: (data) => {
            toast.success(`Successfully generated payslips for ${data.successful} workers`);
            queryClient.invalidateQueries({ queryKey: ['foreignPayslipHistory'] });
        },
        onError: (error) => {
            toast.error('Failed to generate bulk payslips');
            console.error('Bulk payslip generation error:', error);
        }
    });

    // Extract values from stored payslip HTML so the report matches View/Print (same source as passed-out payslip).
    // Supports: (A) printTimesheetAndPayslip grid — .salary-box / .amount-label / .amount-large, TOTAL ADDITIONS, NET PAY
    //           (B) legacy printPayslip — .item-label / .item-amount, Total Additions, Total Salary
    const extractPayslipValues = (payslipHTML) => {
        if (!payslipHTML) return {};

        const values = {
            basic_pay: 0,
            ot_pay: 0,
            sun_ph_pay: 0,
            monthly_allowance: 0,
            incentive_allowance: 0,
            bonus: 0,
            total_additions: 0,
            total_deductions: 0,
            net_pay: 0,
            cpf_employee_deduction: 0,
            sinda_deduction: 0
        };

        /** Parse $1,234.56 or -$99.00 or $0.00 from text */
        const parseMoney = (text) => {
            if (text == null || text === '') return 0;
            const s = String(text).replace(/,/g, '');
            const m = s.match(/-?\s*\$?\s*([\d.]+)/);
            return m ? Math.abs(parseFloat(m[1])) : 0;
        };

        const extractAmount = (text) => parseMoney(text);

        // Prefer payslip-only HTML so timesheet page numbers never leak into extraction
        let htmlSlice = payslipHTML;
        const page2 = payslipHTML.indexOf('<!-- PAGE 2: PAYSLIP -->');
        if (page2 !== -1) htmlSlice = payslipHTML.slice(page2);

        // --- (A) Grid template: amount in .amount-large within same .salary-box as .amount-label ---
        const getAmountFromLabel = (doc, labelPattern) => {
            const labels = doc.querySelectorAll('.amount-label');
            for (const label of labels) {
                const txt = label.textContent.trim();
                if (labelPattern.test(txt)) {
                    const box = label.closest('.salary-box') || label.parentElement;
                    const amountEl = box?.querySelector('.amount-large') || label.previousElementSibling;
                    if (amountEl) return extractAmount(amountEl.textContent);
                }
            }
            return 0;
        };

        // --- (B) Legacy printPayslip: .item-label + .item-amount in .earnings-row / .deductions-row ---
        const getItemRowAmount = (doc, labelPattern) => {
            const candidates = doc.querySelectorAll('.earnings-row .item-label, .deductions-row .item-label');
            for (const lab of candidates) {
                if (labelPattern.test(lab.textContent.trim())) {
                    const row = lab.closest('.earnings-row, .deductions-row') || lab.parentElement;
                    const amt = row?.querySelector('.item-amount') || lab.nextElementSibling;
                    if (amt && amt.textContent) return extractAmount(amt.textContent);
                }
            }
            return 0;
        };

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlSlice, 'text/html');

            values.basic_pay = getAmountFromLabel(doc, /^Basic Pay/i) || getItemRowAmount(doc, /^Basic Pay$/i);
            values.ot_pay = getAmountFromLabel(doc, /^OT Pay/i) || getItemRowAmount(doc, /^OT Pay$/i);
            values.sun_ph_pay = getAmountFromLabel(doc, /^Sun\/PH/i) || getItemRowAmount(doc, /^Sunday\/PH Pay$/i);
            values.monthly_allowance = getAmountFromLabel(doc, /^Monthly Allowance/i) || getItemRowAmount(doc, /^Monthly Allowance$/i);
            values.incentive_allowance = getAmountFromLabel(doc, /^Incentive(\s+Allowance)?$/i) || getItemRowAmount(doc, /^Incentive Allowance$/i);
            values.bonus = getAmountFromLabel(doc, /^Bonus$/i) || getItemRowAmount(doc, /^Bonus$/i);
            values.cpf_employee_deduction = getAmountFromLabel(doc, /^CPF Employee/i) || getItemRowAmount(doc, /^CPF Employee/i);
            values.sinda_deduction = getAmountFromLabel(doc, /^SINDA$/i) || getItemRowAmount(doc, /^SINDA$/i);

            const amountLabels = doc.querySelectorAll('.amount-label');
            // TOTAL ADDITIONS / TOTAL DEDUCTIONS / NET PAY — amount may be before or after the label
            const amountFromTotalLabel = (labelText) => {
                for (const el of amountLabels) {
                    if (el.textContent.trim() !== labelText) continue;
                    const box = el.closest('.salary-box') || el.parentElement;
                    const amountEl = box?.querySelector('.amount-large') || el.nextElementSibling || el.previousElementSibling;
                    if (amountEl) return extractAmount(amountEl.textContent);
                }
                return 0;
            };
            values.total_additions = amountFromTotalLabel('TOTAL ADDITIONS');
            values.total_deductions = amountFromTotalLabel('TOTAL DEDUCTIONS');
            values.net_pay = amountFromTotalLabel('NET PAY');

            // Legacy totals: "Total Additions" / "Total Deductions" / "Total Salary"
            if (!values.total_additions) {
                const v = getItemRowAmount(doc, /^Total Additions$/i);
                if (v) values.total_additions = v;
            }
            if (!values.total_deductions) {
                const v = getItemRowAmount(doc, /^Total Deductions$/i);
                if (v) values.total_deductions = v;
            }
            if (!values.net_pay) {
                const totalAmt = doc.querySelector('.total-section .total-amount');
                if (totalAmt) values.net_pay = extractAmount(totalAmt.textContent);
            }

            // Regex fallbacks (legacy / odd templates only). Skip when the modern grid is present:
            // amounts sit in .amount-large *before* the .amount-label, so "OT Pay...$" matches the wrong $ later in the file.
            // Using `if (!values.ot_pay)` also treats real $0 OT as "missing" and corrupts OT with the first $ after "OT Pay" in the HTML string.
            const pick = (re) => {
                const m = htmlSlice.match(re);
                return m ? parseMoney(m[1] || m[0]) : 0;
            };
            const hasModernSalaryGrid = !!doc.querySelector('.salary-box.addition-box');
            if (!hasModernSalaryGrid) {
                if (!values.basic_pay) values.basic_pay = pick(/Basic Pay[^$]*\$([\d,]+\.?\d*)/i);
                if (!values.ot_pay) values.ot_pay = pick(/OT Pay[^$]*\$([\d,]+\.?\d*)/i);
                if (!values.sun_ph_pay) {
                    values.sun_ph_pay = pick(/Sun\/PH[^$]*\$([\d,]+\.?\d*)/i) || pick(/Sunday\/PH Pay[^$]*\$([\d,]+\.?\d*)/i);
                }
                if (!values.monthly_allowance) values.monthly_allowance = pick(/Monthly Allowance[^$]*\$([\d,]+\.?\d*)/i);
                if (!values.incentive_allowance) {
                    values.incentive_allowance = pick(/Incentive(?:\s+Allowance)?[^$]*\$([\d,]+\.?\d*)/i);
                }
                if (!values.bonus) values.bonus = pick(/\bBonus[^$]*\$([\d,]+\.?\d*)/i);
                if (!values.total_additions) {
                    values.total_additions = pick(/TOTAL ADDITIONS[^$]*\$([\d,]+\.?\d*)/i) || pick(/Total Additions[^$]*\$([\d,]+\.?\d*)/i);
                }
                if (!values.total_deductions) {
                    values.total_deductions = pick(/TOTAL DEDUCTIONS[^$]*\$([\d,]+\.?\d*)/i) || pick(/Total Deductions[^$]*\$([\d,]+\.?\d*)/i);
                }
                if (!values.net_pay) {
                    values.net_pay = pick(/NET PAY[^$]*\$([\d,]+\.?\d*)/i)
                        || pick(/class="total-amount"[^>]*>\s*\$([\d,]+\.?\d*)/i)
                        || pick(/Total Salary[^$]*\$([\d,]+\.?\d*)/i);
                }
                if (!values.cpf_employee_deduction) values.cpf_employee_deduction = pick(/CPF Employee[^$]*\$([\d,]+\.?\d*)/i);
                if (!values.sinda_deduction) values.sinda_deduction = pick(/\bSINDA[^$]*\$([\d,]+\.?\d*)/i);
            }
        } catch (error) {
            log.error('Error extracting payslip values from HTML:', error);
        }

        return values;
    };

    const netsFromIssuedPayslipsBeforeMonth = async (workerId, year, month) => {
        const y = Number(year);
        const m = Number(month);
        const { data: issued } = await supabase
            .from('passed_out_payslips')
            .select('start_date, payslip_html, created_at')
            .eq('worker_id', workerId)
            .gte('start_date', `${y}-01-01`)
            .lte('start_date', `${y}-12-31`)
            .order('created_at', { ascending: true });

        const latestByMonth = new Map();
        (issued || []).forEach((row) => {
            const mm = parseInt(String(row.start_date || '').slice(5, 7), 10);
            if (Number.isFinite(mm) && mm < m) latestByMonth.set(mm, row);
        });

        const byMonth = new Map();
        latestByMonth.forEach((row, mm) => {
            const extracted = extractPayslipValues(row.payslip_html);
            const net = Number(extracted.net_pay) || 0;
            if (net > 0) byMonth.set(mm, net);
        });
        return byMonth;
    };

    const computeLocalYtd = async (workerId, year, month, current = {}) => {
        const y = Number(year);
        const m = Number(month);
        const { data: payslipHistory } = await supabase
            .from('local_worker_payslip_history')
            .select(LOCAL_PAYSLIP_YTD_COLUMNS)
            .eq('employee_id', workerId)
            .eq('period_year', y)
            .order('period_month', { ascending: true });

        const issuedNets = await netsFromIssuedPayslipsBeforeMonth(workerId, y, m);
        const previous = (payslipHistory || []).filter((p) => isPeriodBefore(p, y, m));
        const months = new Set([
            ...previous.map((p) => Number(p.period_month)),
            ...issuedNets.keys(),
        ]);

        let accumulatedSalary = 0;
        months.forEach((mm) => {
            if (issuedNets.has(mm)) {
                accumulatedSalary += issuedNets.get(mm);
                return;
            }
            const row = previous.find((p) => Number(p.period_month) === mm);
            if (row) accumulatedSalary += payslipHistoryNetPay(row);
        });

        let cpfEmployeeAccumulated = 0;
        let employerCPFAccumulated = 0;
        previous.forEach((p) => {
            cpfEmployeeAccumulated += Number(p.cpf_employee) || 0;
            employerCPFAccumulated += Number(p.cpf_employer) || 0;
        });

        return {
            accumulatedSalary: roundPayslipMoney(accumulatedSalary + (Number(current.net) || 0)),
            cpfEmployeeAccumulated: roundPayslipMoney(cpfEmployeeAccumulated + (Number(current.cpfEmp) || 0)),
            employerCPFAccumulated: roundPayslipMoney(employerCPFAccumulated + (Number(current.cpfEr) || 0)),
        };
    };

    // Fetch payslip report data from passed_out_payslips table
    const fetchPayslipReport = useMutation({
        mutationFn: async () => {
            if (!payslipReportMonth) throw new Error('Please select a month');
            const [year, month] = payslipReportMonth.split('-');
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const monthEnd = ymdEndOfMonth(year, month);
            
            // Fetch all passed out payslips that overlap with the selected month
            const allPayslips = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;
            
            while (hasMore) {
                const { data, error } = await supabase
                    .from('passed_out_payslips')
                    .select('*')
                    .or(`start_date.lte.${monthEnd},end_date.gte.${monthStart}`)
                    .order('worker_id', { ascending: true })
                    .order('created_at', { ascending: false })
                    .range(offset, offset + batchSize - 1);
                
                if (error) throw error;
                
                if (data) {
                    allPayslips.push(...data);
                }
                
                // Check if we have more records
                if (data && data.length < batchSize) {
                    hasMore = false;
                } else {
                    offset += batchSize;
                }
                
                // Safety check to prevent infinite loop
                if (offset > 10000) {
                    log.warn('Reached maximum offset limit, stopping pagination');
                    hasMore = false;
                }
            }
            
            // Filter to only include payslips that are within the selected month
            // and extract values from HTML
            const processedPayslips = allPayslips
                .filter(payslip => {
                    const startDate = new Date(payslip.start_date);
                    const endDate = new Date(payslip.end_date);
                    const monthStartDate = new Date(monthStart);
                    const monthEndDate = new Date(monthEnd);
                    
                    // Check if payslip period overlaps with selected month
                    return (startDate <= monthEndDate && endDate >= monthStartDate);
                })
                .map(payslip => {
                    // Extract values from HTML, then apply admin DB overrides (_sys_* in additions)
                    const extractedValues = extractPayslipValues(payslip.payslip_html);
                    const additions = payslip.additions || [];
                    const extractedValuesMerged = applySysOverridesToExtracted(extractedValues, additions);
                    
                    // Extract from additions JSONB
                    const monthlyAllowanceFromAdditions = additions.find(a => 
                        a.name && (a.name.toLowerCase().includes('monthly') || a.name.toLowerCase().includes('allowance'))
                    )?.value || 0;
                    const incentiveFromAdditions = additions.find(a => 
                        a.name && a.name.toLowerCase().includes('incentive')
                    )?.value || 0;
                    
                    // Extract from deductions JSONB
                    const deductions = payslip.deductions || [];
                    const cpfFromDeductions = deductions.find(d => 
                        d.type && d.type.toLowerCase().includes('cpf')
                    )?.amount || 0;
                    const sindaFromDeductions = deductions.find(d => 
                        d.type && d.type.toLowerCase().includes('sinda')
                    )?.amount || 0;
                    
                    return {
                        id: payslip.id,
                        worker_id: payslip.worker_id,
                        worker_type: payslip.worker_type,
                        payslip_type: payslip.payslip_type,
                        start_date: payslip.start_date,
                        end_date: payslip.end_date,
                        payslip_date: payslip.payslip_date,
                        salary_paid_date: payslip.salary_paid_date,
                        payslip_html: payslip.payslip_html || '',
                        amount_paid: payslip.amount_paid,
                        amount_payable: payslip.amount_payable,
                        balances_applied: payslip.balances_applied || [],
                        basic_pay: extractedValuesMerged.basic_pay || 0,
                        ot_pay: extractedValuesMerged.ot_pay || 0,
                        sun_ph_pay: extractedValuesMerged.sun_ph_pay || 0,
                        monthly_allowance: Number.isFinite(extractedValuesMerged.monthly_allowance)
                            ? extractedValuesMerged.monthly_allowance
                            : (parseFloat(monthlyAllowanceFromAdditions) || 0),
                        incentive_allowance: Number.isFinite(extractedValuesMerged.incentive_allowance)
                            ? extractedValuesMerged.incentive_allowance
                            : (parseFloat(incentiveFromAdditions) || 0),
                        bonus: extractedValuesMerged.bonus || parseFloat(payslip.bonus) || 0,
                        total_additions: extractedValuesMerged.total_additions || 0,
                        total_deductions: extractedValuesMerged.total_deductions || 0,
                        net_pay: extractedValuesMerged.net_pay || 0,
                        cpf_employee_deduction: extractedValuesMerged.cpf_employee_deduction || parseFloat(cpfFromDeductions) || 0,
                        sinda_deduction: extractedValuesMerged.sinda_deduction || parseFloat(sindaFromDeductions) || 0,
                        custom_additions: additions,
                        created_at: payslip.created_at
                    };
                });
            
            return processedPayslips;
        },
        onSuccess: (data) => {
            setPayslipReportData(data);
            toast.success(`Found ${data.length} payslips for the selected month`);
        },
        onError: (error) => {
            toast.error('Failed to fetch payslip report');
            console.error('Payslip report error:', error);
        }
    });

    const fetchPassedOutTimesheetsFn = async () => {
        if (!timesheetReportMonth) return [];
        const [yearStr, monthStr] = timesheetReportMonth.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const { data: rows, error } = await supabase
            .from('passed_out_timesheets')
            .select('*')
            .eq('year', year)
            .eq('month', month)
            .order('created_at', { ascending: false });

        if (error) throw error;
        const records = rows || [];

        const workerIds = [...new Set(records.map(r => r.worker_id))];
        if (workerIds.length === 0) return records.map(r => ({ ...r, worker_name: r.worker_id }));

        const { data: localWorkers } = await supabase.from('local_worker_details').select('employee_id, employee_name').in('employee_id', workerIds);
        const { data: foreignWorkers } = await supabase.from('worker_details').select('employee_id, employee_name').in('employee_id', workerIds);
        const nameMap = new Map([
            ...(localWorkers || []).map(w => [String(w.employee_id), w.employee_name]),
            ...(foreignWorkers || []).map(w => [String(w.employee_id), w.employee_name])
        ]);

        return records.map(r => ({ ...r, worker_name: nameMap.get(String(r.worker_id)) || r.worker_id }));
    };

    const { data: adminPassedOutTimesheets = [], refetch: refetchAdminTimesheets, isFetching: isFetchingAdminTimesheets } = useQuery({
        queryKey: ['adminPassedOutTimesheets', timesheetReportMonth],
        queryFn: fetchPassedOutTimesheetsFn,
        enabled: activeDashboardTab === 'timesheet-report' && !!timesheetReportMonth,
        refetchInterval: false,
        refetchIntervalInBackground: false,
    });

    const pollAdminTimesheets = useCallback(() => {
        void refetchAdminTimesheets();
    }, [refetchAdminTimesheets]);

    const fetchAdminTimesheetHead = useCallback(async () => {
        if (!timesheetReportMonth) return null;
        const [yearStr, monthStr] = timesheetReportMonth.split('-');
        return fetchAdminTimesheetHeadTs(Number(yearStr), Number(monthStr));
    }, [timesheetReportMonth]);

    useUpdatedAtHeartbeat({
        enabled: activeDashboardTab === 'timesheet-report' && !!timesheetReportMonth,
        intervalMs: 3000,
        queryFn: fetchAdminTimesheetHead,
        onChange: pollAdminTimesheets,
    });

    const passedOutTimesheetsData = activeDashboardTab === 'timesheet-report' ? adminPassedOutTimesheets : [];

    const deletePassedOutTimesheet = useMutation({
        mutationFn: async (id) => {
            const { error } = await supabase.from('passed_out_timesheets').delete().eq('id', id);
            if (error) throw error;
            return id;
        },
        onSuccess: () => {
            toast.success('Timesheet deleted');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (error) => {
            toast.error('Failed to delete timesheet');
            console.error(error);
        }
    });

    const resendSameTimesheet = useMutation({
        mutationFn: async (record) => {
            const { error } = await supabase.from('passed_out_timesheets').update({
                status: 'pending_worker',
                worker_approved_at: null,
                worker_declined_at: null,
                worker_decline_reason: null,
                manager_approved_at: null,
                manager_declined_at: null,
                manager_decline_reason: null,
                updated_at: new Date().toISOString()
            }).eq('id', record.id);
            if (error) throw error;
            return record.id;
        },
        onSuccess: () => {
            toast.success('Same timesheet resent to worker for re-approval');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (error) => {
            toast.error('Failed to resend timesheet');
            console.error(error);
        }
    });

    const adminApproveTimesheet = useMutation({
        mutationFn: async (record) => {
            const adminName = localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'Admin';
            const { error } = await supabase.from('passed_out_timesheets').update({
                status: 'approved',
                manager_approved_at: new Date().toISOString(),
                manager_name: adminName,
                manager_declined_at: null,
                manager_decline_reason: null,
                updated_at: new Date().toISOString()
            }).eq('id', record.id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet approved');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to approve');
            console.error(e);
        }
    });

    const [adminDeclineTimesheetDialog, setAdminDeclineTimesheetDialog] = useState(null);
    const [adminDeclineReason, setAdminDeclineReason] = useState('');
    /** { ts, revisions } — earlier versions of one passed-out timesheet. */
    const [timesheetHistory, setTimesheetHistory] = useState(null);
    const openTimesheetHistory = async (ts) => {
        try {
            setTimesheetHistory({ ts, revisions: await listTimesheetRevisions(ts.id) });
        } catch (error) {
            console.error('Error loading timesheet history:', error);
            toast.error('Could not load timesheet history');
        }
    };
    const previewHtml = (html) => {
        const win = window.open('', '', 'height=800,width=1000');
        if (!win) return;
        win.document.write(html || '');
        win.document.close();
    };
    const adminDeclineTimesheet = useMutation({
        mutationFn: async ({ id, reason }) => {
            const adminName = localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'Admin';
            const { error } = await supabase.from('passed_out_timesheets').update({
                status: 'declined_by_manager',
                manager_declined_at: new Date().toISOString(),
                manager_name: adminName,
                manager_decline_reason: reason || '',
                updated_at: new Date().toISOString()
            }).eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet declined');
            setAdminDeclineTimesheetDialog(null);
            setAdminDeclineReason('');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to decline');
            console.error(e);
        }
    });

    const adminResendToWorker = useMutation({
        mutationFn: async (record) => {
            const adminName = localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'Admin';
            const { error } = await supabase.from('passed_out_timesheets').update({
                status: 'returned_to_worker',
                manager_name: adminName,
                worker_approved_at: null,
                worker_declined_at: null,
                worker_decline_reason: null,
                manager_approved_at: null,
                manager_declined_at: null,
                manager_decline_reason: null,
                updated_at: new Date().toISOString()
            }).eq('id', record.id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet returned to worker for re-approval');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to resend');
            console.error(e);
        }
    });

    const recreateAndResendTimesheet = useMutation({
        mutationFn: async (record) => {
            const monthYear = `${record.year}-${String(record.month).padStart(2, '0')}`;
            const timesheetHTML = await generateTimesheetHTMLForPassOut(record.worker_id, monthYear);
            // Same document: archive the current version, then update this row.
            await updateTimesheetInPlace(record, timesheetHTML);
            return record.id;
        },
        onSuccess: () => {
            toast.success('Timesheet updated and sent back to worker for re-approval');
            queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (error) => {
            toast.error('Failed to recreate and resend timesheet');
            console.error(error);
        }
    });

    const getAdminTimesheetStatusFooter = (ts) => {
        const base = 'margin-top:24px;padding:12px;font-weight:600;text-align:center;border-radius:8px;';
        const statusMap = {
            pending_worker: { style: base + 'background:#fef3c7;color:#92400e;', text: 'Not approved yet' },
            returned_to_worker: { style: base + 'background:#dbeafe;color:#1e40af;', text: ts.manager_name ? `Returned back to worker for re-approval by ${ts.manager_name}` : 'Returned back to worker for re-approval' },
            awaiting_manager: { style: base + 'background:#dcfce7;color:#166534;', text: 'Submitted by employee, awaiting manager' },
            awaiting_admin: { style: base + 'background:#dcfce7;color:#166534;', text: 'Submitted by employee, awaiting admin' },
            approved: (() => {
                const base = 'margin-top:24px;padding:12px;';
                const approverName = ts.manager_name || 'manager/admin';
                const sigHtml = `<div style="border-bottom:1px solid #333;width:220px;height:24px;margin-bottom:12px;"></div><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;"><span>Employee signature</span><span>Approved by ${approverName}</span></div>`;
                return { style: base, text: sigHtml };
            })(),
            declined_by_worker: { style: base + 'background:#fee2e2;color:#991b1b;', text: ts.worker_decline_reason ? `Declined by worker: ${ts.worker_decline_reason}` : 'Declined by worker' },
            declined_by_manager: (() => {
                const workerPart = ts.worker_decline_reason ? `Declined by worker: ${ts.worker_decline_reason}` : null;
                const managerPart = `Declined by manager${ts.manager_name ? ` (${ts.manager_name})` : ''}${ts.manager_decline_reason ? `: ${ts.manager_decline_reason}` : ''}`.trim() || 'Declined by manager';
                return {
                    style: base + 'background:#fee2e2;color:#991b1b;',
                    text: [workerPart, managerPart].filter(Boolean).join('. ')
                };
            })()
        };
        return statusMap[ts.status] || statusMap.pending_worker;
    };

    const handleViewPassedOutTimesheet = (ts) => {
        let html = ts.timesheet_html || '';
        const row = getAdminTimesheetStatusFooter(ts);
        const footer = row.text ? `<div style="${row.style || ''}">${row.text}</div>` : `<div style="${row.style}"></div>`;
        html = html.replace('</body>', footer + '</body>');
        const win = window.open('', '', 'height=800,width=1000');
        win.document.write(html);
        win.document.close();
    };

    /** Print every loaded passed-out timesheet in one dialog (one timesheet per page break). */
    const handlePrintAllPassedOutTimesheets = async () => {
        try {
            const list = [...(passedOutTimesheetsData || [])]
                .filter((ts) => ts.timesheet_html && String(ts.timesheet_html).trim())
                .sort((a, b) => String(a.worker_id ?? '').localeCompare(String(b.worker_id ?? ''), undefined, { numeric: true }));
            if (list.length === 0) {
                toast.error('No timesheets to print');
                return;
            }

            const headInner = collectPayslipDocumentHeadInner(list[0].timesheet_html);
            const pages = list
                .map((ts, i) => {
                    const row = getAdminTimesheetStatusFooter(ts);
                    const footer = `<div style="${row.style || ''}">${row.text || ''}</div>`;
                    const inner = extractPayslipDocumentBodyInner(ts.timesheet_html);
                    const brk = i < list.length - 1 ? 'page-break-after: always; break-after: page;' : '';
                    return `<div class="multi-print-worker" style="${brk}">${inner}${footer}</div>`;
                })
                .join('\n');
            const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${headInner}</head><body>${pages}</body></html>`;

            const result = await printOrShareHtmlDocument(doc, {
                title: 'Print all timesheets',
                fileName: `Timesheets_${timesheetReportMonth || 'batch'}_${list.length}.pdf`,
                printDelayMs: 500,
            });
            toast.success(
                result?.mode === 'share'
                    ? `Choose an app to save, print, or share (${list.length} timesheet${list.length !== 1 ? 's' : ''})`
                    : `Print dialog opened (${list.length} timesheet${list.length !== 1 ? 's' : ''}) — use "Save as PDF" if needed`
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    const handleDownloadPassedOutTimesheet = async (ts) => {
        try {
            let html = ts.timesheet_html || '';
            const row = getAdminTimesheetStatusFooter(ts);
            const footer = row.text ? `<div style="${row.style || ''}">${row.text}</div>` : `<div style="${row.style}"></div>`;
            html = html.replace('</body>', footer + '</body>');
            const result = await printOrShareHtmlDocument(html, {
                title: 'Print timesheet',
                fileName: `Timesheet_${ts.worker_id || 'worker'}_${ts.month}_${ts.year}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? 'Choose an app to save, print, or share the PDF'
                    : 'Print dialog opened — use "Save as PDF" to download'
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    const handleViewPassedOutPayslipReport = (payslip) => {
        const html = payslip.payslip_html || '';
        if (!html.trim()) {
            toast.error('Payslip preview not available for this record');
            return;
        }
        const win = window.open('', '', 'height=800,width=1000');
        win.document.write(normalizePayslipHtmlForPrint(html, { standalone: true }));
        win.document.close();
    };

    const handlePrintPassedOutPayslipReport = async (payslip) => {
        try {
            const html = payslip.payslip_html || '';
            if (!html.trim()) {
                toast.error('Payslip preview not available for this record');
                return;
            }
            const printHtml = normalizePayslipHtmlForPrint(html, { standalone: true });
            const result = await printOrShareHtmlDocument(printHtml, {
                title: 'Print payslip',
                fileName: `Payslip_${payslip.worker_id || 'worker'}_${Date.now()}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? 'Choose an app to save, print, or share the PDF'
                    : 'Print dialog opened — use "Save as PDF" to download'
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    /** Print every loaded payslip in one dialog (each on its own printed page where possible). */
    const handlePrintAllPassedOutPayslipReport = async () => {
        try {
            const list = (payslipReportData || []).filter((p) => p.payslip_html && String(p.payslip_html).trim());
            if (list.length === 0) {
                toast.error('No payslip documents to print');
                return;
            }
            const doc = buildBatchPayslipPrintDocument(list.map((p) => p.payslip_html));
            const result = await printOrShareHtmlDocument(doc, {
                title: 'Print all payslips',
                fileName: `Payslips_Batch_${Date.now()}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? `Choose an app to save, print, or share (${list.length} payslip${list.length !== 1 ? 's' : ''})`
                    : `Print dialog opened (${list.length} payslip${list.length !== 1 ? 's' : ''}) — use "Save as PDF" if needed`
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    /** Print only the payslip report summary table (no individual payslip documents). */
    const handlePrintPayslipReportSummary = async () => {
        try {
            const list = payslipReportData || [];
            if (list.length === 0) {
                toast.error('No data to print');
                return;
            }

            const esc = (v) => {
                if (v == null || v === '') return '—';
                return String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            };

            const fmtMoney = (n) => {
                const x = Number(n);
                if (Number.isNaN(x)) return '$0.00';
                return `$${x.toFixed(2)}`;
            };

            let monthLabel = '—';
            if (payslipReportMonth && String(payslipReportMonth).includes('-')) {
                const parts = payslipReportMonth.split('-');
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10) - 1;
                if (!Number.isNaN(y) && !Number.isNaN(m)) {
                    monthLabel = new Date(y, m, 1).toLocaleDateString('en-SG', {
                        month: 'long',
                        year: 'numeric',
                    });
                }
            }

            const rowsHtml = list
                .map(
                    (p) => `
            <tr>
                <td class="mono">${esc(p.worker_id)}</td>
                <td>${esc(p.worker_type)}</td>
                <td class="num">${fmtMoney(p.basic_pay)}</td>
                <td class="num">${fmtMoney(p.ot_pay)}</td>
                <td class="num">${fmtMoney(p.sun_ph_pay)}</td>
                <td class="num">${fmtMoney(p.monthly_allowance)}</td>
                <td class="num">${fmtMoney(p.incentive_allowance)}</td>
                <td class="num">${fmtMoney(p.bonus)}</td>
                <td class="num">${fmtMoney(p.total_additions)}</td>
                <td class="num">${fmtMoney(p.total_deductions)}</td>
                <td class="num net">${fmtMoney(p.net_pay)}</td>
            </tr>`
                )
                .join('');

            const logoSrc = logoUrl.startsWith('http')
                ? logoUrl
                : new URL(logoUrl, window.location.origin).href;

            const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Payslip Report Summary — ${esc(monthLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 20px;
      color: #0f172a;
      background: #f1f5f9;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 100%;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      padding: 24px 28px 32px;
      border: 1px solid #e2e8f0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 16px;
      margin-bottom: 18px;
      border-bottom: 3px solid #475569;
    }
    .brand-logo {
      width: 72px;
      height: 72px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .brand-text { min-width: 0; }
    .brand h1 { margin: 0 0 4px; font-size: 1.35rem; font-weight: 700; }
    .brand p { margin: 0; font-size: 0.9rem; color: #64748b; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 22px;
      margin-bottom: 18px;
      font-size: 0.82rem;
      color: #475569;
    }
    .meta strong { color: #334155; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead .group th {
      background: #e2e8f0;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 10px 8px;
      border: 1px solid #cbd5e1;
      text-align: left;
    }
    thead .group th.sep { border-left: 2px solid #94a3b8; }
    thead .cols th {
      background: #f8fafc;
      font-weight: 600;
      padding: 8px 6px;
      border: 1px solid #e2e8f0;
      white-space: nowrap;
    }
    thead .cols th.sep { border-left: 2px solid #cbd5e1; }
    thead .cols th.num { text-align: right; }
    tbody td {
      padding: 7px 6px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 10px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    tbody td.net {
      font-weight: 700;
      color: #047857;
      background: #ecfdf5 !important;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { border: none; border-radius: 0; padding: 0; }
      thead { display: table-header-group; }
      tbody tr { page-break-inside: avoid; }
      thead .group th { background: #e2e8f0 !important; }
      tbody td.net { background: #ecfdf5 !important; }
    }
    @page { size: landscape; margin: 10mm; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="brand">
      <img src="${esc(logoSrc)}" alt="AKK Engineering" class="brand-logo" />
      <div class="brand-text">
        <h1>Payslip report summary</h1>
        <p>AKK ENGINEERING PTE. LTD. — passed-out payslips</p>
      </div>
    </div>
    <div class="meta">
      <span><strong>Month:</strong> ${esc(monthLabel)}</span>
      <span><strong>Records:</strong> ${list.length}</span>
    </div>
    <table>
      <thead>
        <tr class="group">
          <th colspan="2">Worker</th>
          <th colspan="6" class="sep">Earnings &amp; components</th>
          <th colspan="3" class="sep">Totals</th>
        </tr>
        <tr class="cols">
          <th>ID</th>
          <th>Type</th>
          <th class="sep num">Basic</th>
          <th class="num">OT</th>
          <th class="num">Sun/PH</th>
          <th class="num">Monthly</th>
          <th class="num">Incentive</th>
          <th class="num">Bonus</th>
          <th class="sep num">Additions</th>
          <th class="num">Deductions</th>
          <th class="num">Net pay</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`;

            const result = await printOrShareHtmlDocument(doc, {
                title: 'Print payslip summary',
                fileName: `Payslip_Summary_${Date.now()}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? `Choose an app to save, print, or share (${list.length} record${list.length !== 1 ? 's' : ''})`
                    : `Print dialog opened — summary (${list.length} record${list.length !== 1 ? 's' : ''})`
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    /** Print the month's passed-out timesheet summary (status table + counts, no individual timesheets). */
    const handlePrintTimesheetReportSummary = async () => {
        try {
            const list = passedOutTimesheetsData || [];
            if (list.length === 0) {
                toast.error('No data to print');
                return;
            }

            const esc = (v) => {
                if (v == null || v === '') return '—';
                return String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            };

            const fmtDateTime = (v) => {
                if (!v) return '';
                const d = new Date(v);
                if (Number.isNaN(d.getTime())) return '';
                return d.toLocaleString('en-SG', {
                    timeZone: 'Asia/Singapore',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                });
            };

            let monthLabel = '—';
            if (timesheetReportMonth && String(timesheetReportMonth).includes('-')) {
                const [y, m] = timesheetReportMonth.split('-').map((p) => parseInt(p, 10));
                if (!Number.isNaN(y) && !Number.isNaN(m)) {
                    monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-SG', {
                        month: 'long',
                        year: 'numeric',
                    });
                }
            }

            const statusMeta = {
                pending_worker: { label: 'Not approved yet', tone: 'amber' },
                returned_to_worker: { label: 'Returned to worker', tone: 'blue' },
                awaiting_manager: { label: 'Awaiting manager', tone: 'lime' },
                awaiting_admin: { label: 'Awaiting admin', tone: 'lime' },
                approved: { label: 'Approved', tone: 'green' },
                declined_by_worker: { label: 'Declined by worker', tone: 'red' },
                declined_by_manager: { label: 'Declined by manager', tone: 'red' },
            };
            const statusOrder = Object.keys(statusMeta);

            const counts = {};
            list.forEach((ts) => {
                counts[ts.status] = (counts[ts.status] || 0) + 1;
            });
            const countChips = statusOrder
                .filter((s) => counts[s])
                .map((s) => `<span class="chip ${statusMeta[s].tone}">${esc(statusMeta[s].label)}: <strong>${counts[s]}</strong></span>`)
                .join('');

            const sorted = [...list].sort((a, b) =>
                String(a.worker_id ?? '').localeCompare(String(b.worker_id ?? ''), undefined, { numeric: true })
            );

            const rowsHtml = sorted
                .map((ts) => {
                    const meta = statusMeta[ts.status] || { label: ts.status, tone: 'amber' };
                    const notes = [
                        ts.worker_decline_reason ? `Worker: ${ts.worker_decline_reason}` : '',
                        ts.manager_decline_reason ? `Manager: ${ts.manager_decline_reason}` : '',
                    ].filter(Boolean).join(' · ');
                    return `
            <tr>
                <td class="mono">${esc(ts.worker_id)}</td>
                <td>${esc(ts.worker_name)}</td>
                <td>${esc(ts.worker_type)}</td>
                <td><span class="pill ${meta.tone}">${esc(meta.label)}</span></td>
                <td>${esc(fmtDateTime(ts.worker_approved_at) || (ts.worker_declined_at ? `Declined ${fmtDateTime(ts.worker_declined_at)}` : ''))}</td>
                <td>${esc(ts.manager_name)}</td>
                <td>${esc(fmtDateTime(ts.manager_approved_at) || (ts.manager_declined_at ? `Declined ${fmtDateTime(ts.manager_declined_at)}` : ''))}</td>
                <td>${esc(fmtDateTime(ts.created_at))}</td>
                <td>${esc(notes)}</td>
            </tr>`;
                })
                .join('');

            const logoSrc = logoUrl.startsWith('http')
                ? logoUrl
                : new URL(logoUrl, window.location.origin).href;

            const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Timesheet Report Summary — ${esc(monthLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 20px;
      color: #0f172a;
      background: #f1f5f9;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 100%;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      padding: 24px 28px 32px;
      border: 1px solid #e2e8f0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 16px;
      margin-bottom: 18px;
      border-bottom: 3px solid #475569;
    }
    .brand-logo { width: 72px; height: 72px; object-fit: contain; flex-shrink: 0; }
    .brand h1 { margin: 0 0 4px; font-size: 1.35rem; font-weight: 700; }
    .brand p { margin: 0; font-size: 0.9rem; color: #64748b; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 22px;
      margin-bottom: 12px;
      font-size: 0.82rem;
      color: #475569;
    }
    .meta strong { color: #334155; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .chip, .pill {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 11px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      white-space: nowrap;
    }
    .amber { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .blue { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
    .lime { background: #f7fee7; border-color: #bef264; color: #3f6212; }
    .green { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
    .red { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th {
      background: #e2e8f0;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 9px 6px;
      border: 1px solid #cbd5e1;
      text-align: left;
      white-space: nowrap;
    }
    tbody td { padding: 7px 6px; border: 1px solid #e2e8f0; vertical-align: middle; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 10px; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { border: none; border-radius: 0; padding: 0; }
      thead { display: table-header-group; }
      tbody tr { page-break-inside: avoid; }
    }
    @page { size: landscape; margin: 10mm; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="brand">
      <img src="${esc(logoSrc)}" alt="AKK Engineering" class="brand-logo" />
      <div>
        <h1>Timesheet report summary</h1>
        <p>AKK ENGINEERING PTE. LTD. — passed-out timesheets</p>
      </div>
    </div>
    <div class="meta">
      <span><strong>Month:</strong> ${esc(monthLabel)}</span>
      <span><strong>Records:</strong> ${list.length}</span>
      <span><strong>Printed:</strong> ${esc(fmtDateTime(new Date()))}</span>
    </div>
    <div class="chips">${countChips}</div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
          <th>Worker response</th>
          <th>Manager</th>
          <th>Manager response</th>
          <th>Passed out</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`;

            const result = await printOrShareHtmlDocument(doc, {
                title: 'Print timesheet summary',
                fileName: `Timesheet_Summary_${timesheetReportMonth || Date.now()}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? `Choose an app to save, print, or share (${list.length} record${list.length !== 1 ? 's' : ''})`
                    : `Print dialog opened — summary (${list.length} record${list.length !== 1 ? 's' : ''})`
            );
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    // Toggle monthly timesheet lock for a worker (no longer used - kept for compatibility)
    const toggleTimesheetLock = useMutation({
        mutationFn: async ({ workerId, lock }) => {
            if (!timesheetReportMonth) throw new Error('Please select a month');

            const [year, month] = timesheetReportMonth.split('-');
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const monthEnd = ymdEndOfMonth(year, month);

            // Only update existing passed out records in selected month overlap
            const { data: existingRows, error: fetchError } = await supabase
                .from('passed_out_payslips')
                .select('id')
                .eq('worker_id', workerId)
                .lte('start_date', monthEnd)
                .gte('end_date', monthStart);

            if (fetchError) throw fetchError;
            if (!existingRows || existingRows.length === 0) {
                throw new Error('No passed out timesheet found for this worker/month');
            }

            const { error: updateError } = await supabase
                .from('passed_out_payslips')
                .update({ timesheet_locked: lock })
                .eq('worker_id', workerId)
                .lte('start_date', monthEnd)
                .gte('end_date', monthStart);

            if (updateError) throw updateError;

            return { workerId: String(workerId), lock };
        },
        onSuccess: ({ workerId, lock }) => {
            setTimesheetReportData((prev) =>
                (prev || []).map((row) =>
                    String(row.worker_id) === String(workerId)
                        ? { ...row, timesheet_locked: lock }
                        : row
                )
            );
            toast.success(`Timesheet ${lock ? 'locked' : 'unlocked'} successfully`);
            queryClient.invalidateQueries({ queryKey: ['passedOutPayslips'] });
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to update timesheet lock');
            console.error('Timesheet lock update error:', error);
        }
    });

    // Delete payslip handler
    const deletePayslip = useMutation({
        mutationFn: async (payslipId) => {
            // Delete from passed_out_payslips
            const { error: passedOutError } = await supabase
                .from('passed_out_payslips')
                .delete()
                .eq('id', payslipId);
            
            if (passedOutError) throw passedOutError;
            
            return payslipId;
        },
        onSuccess: () => {
            toast.success('Payslip deleted successfully');
            fetchPayslipReport.mutate(); // Refresh the list
            queryClient.invalidateQueries({ queryKey: ['passedOutPayslips'] }); // Refresh worker portal
        },
        onError: (error) => {
            toast.error(balanceErrorMessage(error) || 'Failed to delete payslip');
            console.error('Delete payslip error:', error);
        }
    });

    // Update payslip handler
    const updatePayslip = useMutation({
        mutationFn: async ({ payslipId, updates }) => {
            // Archive the issued version, then edit this same row (never a new copy).
            const row = await archivePayslipBeforeEdit(payslipId);
            const isStatutory = (d) => /cpf|sinda/i.test(String(d?.type || ''));
            const customDeductions = (row.deductions || []).filter((d) => d && d.type && !isStatutory(d));
            const otherDeductions = customDeductions.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
            const fullUpdates = { ...updates, other_deductions: otherDeductions };

            const mergedAdditions = mergeAdditionsWithSysOverrides(
                updates.custom_additions ?? row.additions ?? [],
                fullUpdates
            );
            let patchedHtml = patchPayslipHtml(row.payslip_html, fullUpdates);

            // Pay balances: re-record what was paid against the (possibly changed) net pay, then
            // refresh the Balances block. Runs before saving so a blocked change saves nothing.
            const applied = row.balances_applied || [];
            const paidInput = updates.amount_paid;
            const amountPaid = paidInput === '' || paidInput == null ? null : paidInput;
            if (applied.length > 0 || row.amount_paid != null || amountPaid != null) {
                const num = (x) => parseFloat(x) || 0;
                const netEarned =
                    num(updates.basic_pay) + num(updates.ot_pay) + num(updates.sun_ph_pay) +
                    num(updates.monthly_allowance) + num(updates.incentive_allowance) + num(updates.bonus) +
                    stripSysAdditions(updates.custom_additions ?? row.additions ?? []).reduce((sum, a) => sum + num(a.value), 0) -
                    (num(updates.cpf_employee_deduction) + num(updates.sinda_deduction) + otherDeductions);
                await applyPayslipBalances({
                    payslipId,
                    netPay: netEarned,
                    uses: applied.map((a) => ({ balance_id: a.balance_id, amount: a.amount })),
                    amountPaid,
                });
                patchedHtml = replaceBalanceSection(
                    patchedHtml,
                    buildBalanceSection({ netPay: netEarned, lines: appliedToLines(applied), amountPaid }).html
                );
            }

            const { error: passedOutError } = await supabase
                .from('passed_out_payslips')
                .update({
                    bonus: parseFloat(updates.bonus) || 0,
                    additions: mergedAdditions,
                    deductions: [
                        ...customDeductions,
                        ...(updates.cpf_employee_deduction ? [{ type: 'CPF Employee', amount: String(updates.cpf_employee_deduction) }] : []),
                        ...(updates.sinda_deduction ? [{ type: 'SINDA', amount: String(updates.sinda_deduction) }] : [])
                    ],
                    payslip_html: patchedHtml,
                    revision: (row.revision || 1) + 1
                })
                .eq('id', payslipId);

            if (passedOutError) throw passedOutError;

            // Keep the local payslip history copy (used for YTD / CPF totals) in step.
            if (row.worker_type === 'local') {
                const num = (x) => parseFloat(x) || 0;
                const totalAdditions =
                    num(updates.basic_pay) + num(updates.ot_pay) + num(updates.sun_ph_pay) +
                    num(updates.monthly_allowance) + num(updates.incentive_allowance) + num(updates.bonus) +
                    stripSysAdditions(mergedAdditions).reduce((sum, a) => sum + num(a.value), 0);
                const totalDeductions = num(updates.cpf_employee_deduction) + num(updates.sinda_deduction) + otherDeductions;
                const [periodYear, periodMonth] = String(row.start_date).split('-').map(Number);
                const { error: historyError } = await supabase
                    .from('local_worker_payslip_history')
                    .update({
                        basic_salary: num(updates.basic_pay),
                        ot_pay: num(updates.ot_pay),
                        sunday_pay: num(updates.sun_ph_pay),
                        monthly_allowance: num(updates.monthly_allowance),
                        incentive_allowance: num(updates.incentive_allowance),
                        bonus: num(updates.bonus),
                        cpf_employee: num(updates.cpf_employee_deduction),
                        sinda_contribution: num(updates.sinda_deduction),
                        total_additions: totalAdditions,
                        total_deductions: totalDeductions,
                        net_pay: totalAdditions - totalDeductions
                    })
                    .eq('employee_id', row.worker_id)
                    .eq('period_year', periodYear)
                    .eq('period_month', periodMonth);
                if (historyError) console.error('Payslip saved, but local payslip history not updated:', historyError);
            }
            
            return payslipId;
        },
        onSuccess: () => {
            toast.success('Payslip updated successfully');
            setEditingPayslip(null);
            fetchPayslipReport.mutate(); // Refresh the list
            queryClient.invalidateQueries({ queryKey: ['passedOutPayslips'] }); // Refresh worker portal
        },
        onError: (error) => {
            toast.error(balanceErrorMessage(error) || 'Failed to update payslip');
            console.error('Update payslip error:', error);
        }
    });

    // Enhanced monthly payslip handlers
    const handleMonthlyPayslipPeriodSubmit = async () => {
        try {
            log.debug('Monthly payslip period:', monthlyPayslipPeriod);
            
            // Get all workers (not just those with shifts)
            const [localResult, foreignResult] = await Promise.all([
                supabase.from('local_worker_details').select('*'),
                supabase.from('worker_details').select('*')
            ]);

            const allWorkers = [
                ...(localResult.data || []).map(w => ({ ...w, worker_type: 'local' })),
                ...(foreignResult.data || []).map(w => ({ ...w, worker_type: 'foreign' }))
            ].sort((a, b) => a.employee_id.localeCompare(b.employee_id));

            if (allWorkers.length === 0) {
                toast.error('No workers found in the system');
                return;
            }

            // Get shifts for the selected period (optional - for payslip calculations)
            const { data: workerShifts, error: shiftsError } = await supabase
                .from('shifts')
                .select('*')
                .gte('work_date', monthlyPayslipPeriod.startDate)
                .lte('work_date', monthlyPayslipPeriod.endDate);

            if (shiftsError) {
                console.error('Shifts query error:', shiftsError);
            }

            log.info('Found workers:', allWorkers.length);
            // Initialize all workers with default payslip configuration
            const workersWithConfig = allWorkers.map(worker => ({
                ...worker,
                bonus: '0',
                additions: [{ name: '', value: '' }],
                deductions: [{ type: '', amount: '' }],
                isConfiguring: false
            }));

            setMonthlyPayslipWorkers(workersWithConfig);
            setMonthlyPayslipStep(2);
            toast.success(`Found ${allWorkers.length} workers for payslip generation`);
        } catch (error) {
            toast.error('Failed to load workers');
            console.error('Error:', error);
        }
    };

    const handleConfigureWorkerPayslip = (worker) => {
        // Store the selected worker and move to step 3
        setMonthlyPayslipWorkers(prev => prev.map(w => 
            w.employee_id === worker.employee_id ? { ...w, isConfiguring: true } : w
        ));
        setMonthlyPayslipStep(3);
    };

    const handleGenerateAllPayslips = async () => {
        try {
            setIsBulkPrinting(true);
            
            for (const worker of monthlyPayslipWorkers) {
                await generateIndividualPayslip(worker);
            }
            
            toast.success(`Generated ${monthlyPayslipWorkers.length} payslips successfully`);
            setShowMonthlyPayslipDialog(false);
            setMonthlyPayslipStep(1);
            setMonthlyPayslipPeriod({ startDate: '', endDate: '' });
            setMonthlyPayslipWorkers([]);
        } catch (error) {
            toast.error('Failed to generate payslips');
            console.error('Error:', error);
        } finally {
            setIsBulkPrinting(false);
        }
    };

    const generateIndividualPayslip = async (worker) => {
        const startDate = monthlyPayslipPeriod.startDate;
        if (!startDate) {
            throw new Error('Start date is required for monthly payslip generation');
        }
        const monthYear = `${new Date(startDate).getFullYear()}-${String(new Date(startDate).getMonth() + 1).padStart(2, '0')}`;
        // Deprecated local calculator removed: delegate to canonical payroll path.
        await printTimesheetAndPayslip(
            worker.employee_id,
            monthYear,
            worker.deductions || [],
            worker.salary_paid_date || '',
            worker.bonus || '',
            worker.additions || [],
            false
        );
    };

    /** Browser only, once per browser profile — native uses first-launch flow in `main.jsx`. */
    useEffect(() => {
        if (Capacitor.isNativePlatform()) return;
        if (!("Notification" in window) || Notification.permission !== "default") return;
        try {
            const k = 'akk_web_admin_notification_prompt_v1';
            if (localStorage.getItem(k) === '1') return;
            localStorage.setItem(k, '1');
            Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                    log.debug("Notification permission granted");
                }
            });
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!adminEmail) return undefined;
        let cancelled = false;
        import('@/modules/timesheet/lib/realtimeSubscriptions').then((m) => {
            if (!cancelled) m.startAdminRealtimeNotifications();
        });
        return () => {
            cancelled = true;
            import('@/modules/timesheet/lib/realtimeSubscriptions').then((m) => m.stopAdminRealtimeNotifications());
        };
    }, [adminEmail]);

    // Admin online status tracking (heartbeat system)
    useEffect(() => {
        if (!adminEmail) return;

        let isMounted = true;
        let statusId = adminStatusId;

        const setOnlineStatus = async () => {
            try {
                // First try to update existing status
                const { data: existingStatus } = await supabase
                    .from('admin_status')
                    .select('*')
                    .limit(1);

                if (existingStatus && existingStatus.length > 0) {
                    const { error } = await supabase
                        .from('admin_status')
                        .update({
                            admin_email: adminEmail,
                            last_seen: new Date().toISOString(),
                            is_online: true
                        })
                        .eq('id', existingStatus[0].id);
                    if (error) throw error;
                    if (isMounted) {
                        statusId = existingStatus[0].id;
                        setAdminStatusId(existingStatus[0].id);
                    }
                } else {
                    // Create new status record
                    const { data, error } = await supabase
                        .from('admin_status')
                        .insert([{
                            admin_email: adminEmail,
                            last_seen: new Date().toISOString(),
                            is_online: true
                        }])
                        .select()
                        .single();
                    if (error) throw error;
                    if (isMounted) {
                        statusId = data.id;
                        setAdminStatusId(data.id);
                    }
                }
            } catch (error) {
                console.error('Failed to set online status:', error);
            }
        };

        setOnlineStatus();

        // Heartbeat every 5 seconds (skip while tab hidden)
        const heartbeat = setInterval(async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                if (statusId) {
                    await supabase
                        .from('admin_status')
                        .update({
                            admin_email: adminEmail,
                            last_seen: new Date().toISOString(),
                            is_online: true
                        })
                        .eq('id', statusId);
                }
            } catch (error) {
                console.error('Heartbeat failed:', error);
            }
        }, 5000);

        // Cleanup on page unload
        const handleBeforeUnload = () => {
            if (statusId) {
                navigator.sendBeacon(
                    `${supabase.supabaseUrl}/rest/v1/admin_status?id=eq.${statusId}`,
                    JSON.stringify({ is_online: false })
                );
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            isMounted = false;
            clearInterval(heartbeat);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (statusId) {
                supabase
                    .from('admin_status')
                    .update({ is_online: false })
                    .eq('id', statusId);
            }
        };
    }, [adminEmail]);

    const { data: shifts = [], isLoading, isFetching, isError: isShiftsError, error: shiftsError, refetch } = useQuery({
        queryKey: ['shifts', dateFilter, selectedMonth, selectedYear],
        queryFn: async () => {
            log.debug('Fetching shifts for admin:', adminEmail, 'enabled:', !!adminEmail);
            
            // Date filter applied per batch (rebuild query each page — supabase builders are mutable)
            let rangeStart = null;
            let rangeEnd = null;
            if (dateFilter === 'month' && selectedMonth) {
                const [year, month] = selectedMonth.split('-');
                rangeStart = `${year}-${month.padStart(2, '0')}-01`;
                rangeEnd = ymdEndOfMonth(year, month);
            } else if (dateFilter === 'year' && selectedYear) {
                rangeStart = `${selectedYear}-01-01`;
                rangeEnd = `${selectedYear}-12-31`;
            } else {
                // Default: past 35 days (no future dates)
                const todayYmd = getTodaySingapore();
                rangeEnd = todayYmd;
                rangeStart = addDaysToYmd(todayYmd, -35);
            }

            // Fetch shifts in batches. Include `id` in ORDER BY so page windows don't overlap
            // when work_date/entry_time tie (PostgREST range pagination otherwise can duplicate rows).
            const allShifts = [];
            const seenShiftIds = new Set();
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;

            while (hasMore) {
                let pageQuery = supabase
                    .from('shifts')
                    .select('*')
                    .is('leave_type', null);

                if (rangeStart) pageQuery = pageQuery.gte('work_date', rangeStart);
                if (rangeEnd) pageQuery = pageQuery.lte('work_date', rangeEnd);

                const { data, error } = await pageQuery
                    .order('work_date', { ascending: false })
                    .order('entry_time', { ascending: false })
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .range(offset, offset + batchSize - 1);

                if (error) {
                    console.error('Error fetching shifts:', error);
                    throw error;
                }

                if (!data || data.length === 0) {
                    hasMore = false;
                } else {
                    for (const row of data) {
                        if (!row?.id || seenShiftIds.has(row.id)) continue;
                        seenShiftIds.add(row.id);
                        allShifts.push(row);
                    }
                    if (data.length < batchSize) {
                        hasMore = false;
                    }
                    offset += batchSize;
                }
            }

            log.debug('Fetched shifts:', allShifts?.length || 0, 'shifts');

            // If we have shifts, fetch related data separately to avoid relationship ambiguity
            if (allShifts && allShifts.length > 0) {
                const workerIds = [...new Set(allShifts.map(shift => shift.worker_id))];
                const siteIds = [...new Set(allShifts.map(shift => shift.site_id))];
                const shiftIds = allShifts.map(shift => shift.id);

                log.info('Fetching workers for IDs:', workerIds);
                // Fetch workers from both local_worker_details and worker_details tables
                const [localWorkersResult, foreignWorkersResult] = await Promise.all([
                    supabase
                        .from('local_worker_details')
                        .select('employee_id, employee_name')
                        .in('employee_id', workerIds),
                    supabase
                        .from('worker_details')
                        .select('employee_id, employee_name')
                        .in('employee_id', workerIds)
                ]);

                const localWorkers = localWorkersResult.data || [];
                const foreignWorkers = foreignWorkersResult.data || [];
                const localWorkerIds = new Set(localWorkers.map((w) => String(w.employee_id)));
                const foreignWorkerIds = new Set(foreignWorkers.map((w) => String(w.employee_id)));

                // Combine workers from both tables (local first for name lookup)
                const workers = [...localWorkers, ...foreignWorkers];

                const workersError = localWorkersResult.error || foreignWorkersResult.error;

                if (workersError) console.error('Workers fetch error:', workersError);

                log.debug('Fetching sites for IDs:', siteIds);
                // Fetch sites
                const { data: sites, error: sitesError } = await supabase
                    .from('sites')
                    .select('id, site_name, latitude, longitude')
                    .in('id', siteIds);

                if (sitesError) console.error('Sites fetch error:', sitesError);

                // Fetch breaks in batches to avoid URL length issues
                const allBreaks = [];
                const batchSize = 100; // Process 100 shift IDs at a time
                
                for (let i = 0; i < shiftIds.length; i += batchSize) {
                    const batch = shiftIds.slice(i, i + batchSize);
                    const { data: batchBreaks, error: batchError } = await supabase
                        .from('breaks')
                        .select('*')
                        .in('shift_id', batch.length > 0 ? batch : [''])
                        .order('break_start', { ascending: true });
                    
                    if (batchError) {
                        console.error('Breaks batch fetch error:', batchError);
                        continue; // Continue with next batch even if one fails
                    }
                    
                    if (batchBreaks) {
                        allBreaks.push(...batchBreaks);
                    }
                }

                const breaksByShiftId = {};
                if (allBreaks) {
                    allBreaks.forEach(breakItem => {
                        if (!breaksByShiftId[breakItem.shift_id]) breaksByShiftId[breakItem.shift_id] = [];
                        breaksByShiftId[breakItem.shift_id].push(breakItem);
                    });
                }

                // Pre-populate breaks cache with fetched data
                const initialBreaksCache = new Map();
                Object.keys(breaksByShiftId).forEach(shiftId => {
                    initialBreaksCache.set(shiftId, breaksByShiftId[shiftId]);
                });
                setBreaksCache(initialBreaksCache);
                log.debug('Pre-populated breaks cache with', initialBreaksCache.size, 'shifts');

                // Merge data into shifts
                const shiftsWithData = allShifts.map(shift => {
                    const wid = String(shift.worker_id);
                    const worker_type = localWorkerIds.has(wid)
                        ? 'local'
                        : foreignWorkerIds.has(wid)
                          ? 'foreign'
                          : null;
                    return {
                        ...shift,
                        worker_type,
                        workers: workers?.find((w) => String(w.employee_id) === wid) || null,
                        sites: sites?.find((s) => s.id === shift.site_id) || null,
                        breaks: breaksByShiftId[shift.id] || [],
                    };
                });

                log.debug('Merged shifts with data:', shiftsWithData.length);
                // Debug: Check for duplicate breaks
                shiftsWithData.forEach(shift => {
                    if (shift.breaks && shift.breaks.length > 1) {
                        log.debug(`Shift ${shift.id} has ${shift.breaks.length} breaks:`, shift.breaks);
                    }
                });
                
                return shiftsWithData;
            }

            return allShifts || [];
        },
        refetchInterval: false, // Disabled - using smart polling instead
        enabled: !!adminEmail, // Only fetch if admin is logged in
        staleTime: 30000, // Consider data fresh for 30 seconds
        gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes (replaces cacheTime)
        refetchOnWindowFocus: () => !isAdminShiftRefreshPaused(),
        refetchOnReconnect: () => !isAdminShiftRefreshPaused(),
    });

    const { data: allSites = [], isLoading: isLoadingSites } = useQuery({
        queryKey: ['sites'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('sites')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!adminEmail,
        staleTime: 60000, // Consider data fresh for 1 minute
        gcTime: 5 * 60 * 1000 // Garbage collect after 5 minutes
    });

    // Smart polling: compare global newest shifts.created_at to last seen value.
    // Previously required latestShiftTimestamp to be non-null, so when the list was empty
    // (or baseline never set) new clock-ins from the APK never triggered a refetch.
    useEffect(() => {
        if (!adminEmail) return;

        shiftPollHeadTsRef.current = null;

        const smartHeartbeat = setInterval(async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (isAdminShiftRefreshPaused()) return;
            try {
                const { data: latestShiftData, error } = await supabase
                    .from('shifts')
                    .select('created_at')
                    .is('leave_type', null)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (error) {
                    console.error('Smart heartbeat error:', error);
                    return;
                }

                const headTs = latestShiftData?.[0]?.created_at;
                if (!headTs) return;

                if (shiftPollHeadTsRef.current !== headTs) {
                    shiftPollHeadTsRef.current = headTs;
                    log.debug('Shift head timestamp changed — refetching shifts');
                    refetch();
                }
            } catch (error) {
                console.error('Smart heartbeat failed:', error);
            }
        }, 5000);

        return () => clearInterval(smartHeartbeat);
    }, [adminEmail, refetch]);

    const wasTimeTrackerFormOpenRef = useRef(false);
    useEffect(() => {
        setAdminShiftRefreshPaused(timeTrackerFormOpen);
        if (timeTrackerFormOpen) {
            queryClient.cancelQueries({ queryKey: ['shifts'] });
            wasTimeTrackerFormOpenRef.current = true;
            return;
        }
        if (wasTimeTrackerFormOpenRef.current) {
            wasTimeTrackerFormOpenRef.current = false;
            refetch();
        }
    }, [timeTrackerFormOpen, queryClient, refetch]);
    useEffect(() => () => setAdminShiftRefreshPaused(false), []);

    const { data: localWorkers = [], isLoading: isLoadingLocalWorkers } = useQuery({
        queryKey: ['local-workers'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('local_worker_details')
                .select('*')
                .order('employee_id', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: !!adminEmail,
        staleTime: 60000, // Consider data fresh for 1 minute
        gcTime: 5 * 60 * 1000 // Garbage collect after 5 minutes
    });

    const { data: foreignWorkers = [], isLoading: isLoadingForeignWorkers } = useQuery({
        queryKey: ['foreign-workers'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('worker_details')
                .select('*')
                .order('employee_id', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: !!adminEmail,
        staleTime: 60000, // Consider data fresh for 1 minute
        gcTime: 5 * 60 * 1000 // Garbage collect after 5 minutes
    });

    const localWorkersDirectory = useMemo(
        () => partitionWorkersDirectoryForDisplay(localWorkers),
        [localWorkers]
    );
    const foreignWorkersDirectory = useMemo(
        () => partitionWorkersDirectoryForDisplay(foreignWorkers),
        [foreignWorkers]
    );

    // Managers query
    const { data: managersData = [], isLoading: isLoadingManagers, refetch: refetchManagers } = useQuery({
        queryKey: ['managers'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('managers')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!adminEmail
    });

    // Supervisors query
    const { data: supervisorsData = [], isLoading: isLoadingSupervisors, refetch: refetchSupervisors } = useQuery({
        queryKey: ['supervisors'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('supervisors')
                .select(`
                    *,
                    sites:site_id (
                        id,
                        site_name
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!adminEmail
    });

    const managers = managersData;
    const supervisors = supervisorsData;

    const prevShiftsRef = useRef([]);

    useEffect(() => {
        const checkNewShifts = async () => {
            if (!isLoading && shifts.length >= 0) {
                const isAdmin = !!adminEmail;
                if (!isAdmin) return;

                const newShifts = shifts.filter(s =>
                    !prevShiftsRef.current.find(ps => ps.id === s.id)
                );

                if (newShifts.length > 0) {
                    toast.info(`${newShifts.length} new shift(s) recorded`, {
                        description: 'Time tracking update',
                        duration: 2000, // Show for 2 seconds
                    });
                }
            }

            prevShiftsRef.current = shifts;
        };

        // Check immediately, not just when shifts change
        checkNewShifts();
    }, [shifts, isLoading, adminEmail]);

    const deleteAllMutation = useMutation({
        mutationFn: async () => {
            // Get count of records that will be deleted for logging
            const { data: recordsToDelete, error: countError } = await supabase
                .from('shifts')
                .select('id', { count: 'exact' })
                .neq('id', '00000000-0000-0000-0000-000000000000');
            
            if (countError) throw countError;
            // Proceed with deletion
            const { error, data } = await supabase
                .from('shifts')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000')
                .select();
            
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
            toast.success('All shift history deleted successfully');
            setShowDeleteDialog(false);
            setPassword('');
        },
        onError: (error) => {
            console.error('Error deleting all shifts:', error);
            toast.error('Failed to delete shift history');
        }
    });

    const deleteShiftMutation = useMutation({
        mutationFn: async (shiftId) => {
            if (!shiftId || shiftId === 'undefined' || shiftId === 'null') {
                throw new Error('Invalid shift ID provided for deletion');
            }
            // First, verify the shift exists
            const { data: shiftExists, error: checkError } = await supabase
                .from('shifts')
                .select('id, worker_id, work_date')
                .eq('id', shiftId)
                .single();
            
            if (checkError || !shiftExists) {
                throw new Error(`Shift not found with ID: ${shiftId}`);
            }
            
            // Now delete it
            const { error, data } = await supabase
                .from('shifts')
                .delete()
                .eq('id', shiftId)
                .select();
            
            if (error) throw error;
            // Ensure only one record was deleted
            if (data && data.length > 1) {
                throw new Error(`Unexpected: Multiple records (${data.length}) were deleted. This should not happen.`);
            }
            
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
            toast.success('Shift deleted successfully');
        },
        onError: (error) => {
            console.error('Error deleting shift:', error);
            toast.error(`Failed to delete shift: ${error.message}`);
        }
    });

    const addSiteMutation = useMutation({
        mutationFn: async (siteData) => {
            const { data, error } = await supabase
                .from('sites')
                .insert([siteData])
                .select('*')
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (createdSite) => {
            queryClient.invalidateQueries({ queryKey: ['sites'] });
            toast.success(`Site added. QR Token: ${createdSite.qr_token}`);
            setShowAddSiteDialog(false);
            setEditingSite(createdSite);
            setSiteFormData({
                id: createdSite.id || '',
                site_name: createdSite.site_name || '',
                latitude: createdSite.latitude ?? '',
                longitude: createdSite.longitude ?? '',
                qr_token: createdSite.qr_token || ''
            });
            setShowEditSiteDialog(true);
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to add site');
        }
    });

    const updateSiteMutation = useMutation({
        mutationFn: async ({ id, updates }) => {
            const { data, error } = await supabase
                .from('sites')
                .update(updates)
                .eq('id', id)
                .select('*')
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (updatedSite) => {
            queryClient.invalidateQueries({ queryKey: ['sites'] });
            toast.success(`Site updated. QR Token: ${updatedSite.qr_token}`);
            setEditingSite(updatedSite);
            setSiteFormData({
                id: updatedSite.id || '',
                site_name: updatedSite.site_name || '',
                latitude: updatedSite.latitude ?? '',
                longitude: updatedSite.longitude ?? '',
                qr_token: updatedSite.qr_token || ''
            });
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to update site');
        }
    });

    const deleteSiteMutation = useMutation({
        mutationFn: async (siteId) => {
            const { error } = await supabase
                .from('sites')
                .delete()
                .eq('id', siteId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sites'] });
            toast.success('Site deleted');
            setPendingDeleteSite(null);
        },
        onError: (error) => {
            toast.error(error?.message || 'Failed to delete site');
        }
    });

    const openAddSiteDialog = () => {
        const id = generateId();
        setSiteFormData({
            id,
            site_name: '',
            latitude: '',
            longitude: '',
            qr_token: ''
        });
        setSiteQrDataUrl('');
        setShowAddSiteDialog(true);
    };

    const openEditSiteDialog = (site) => {
        const gps = parseSiteGpsCoords(site);
        setEditingSite(site);
        setSiteFormData({
            id: site.id || '',
            site_name: site.site_name || '',
            latitude: gps ? gps.latitude : '',
            longitude: gps ? gps.longitude : '',
            qr_token: site.qr_token || ''
        });
        setShowEditSiteDialog(true);
    };

    const downloadSiteQr = async ({ qr_token, site_name }) => {
        if (!qr_token) {
            toast.error('QR token not available for this site');
            return;
        }
        try {
            const dataUrl = await QRCode.toDataURL(qr_token, { margin: 2, width: 512 });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${(site_name || 'site').replaceAll(' ', '_')}_qr.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) {
            toast.error('Failed to generate QR code');
        }
    };

    const openSiteQrPreview = async (site) => {
        if (!site?.qr_token) {
            toast.error('QR token not available for this site');
            return;
        }
        try {
            const dataUrl = await QRCode.toDataURL(site.qr_token, { margin: 2, width: 512 });
            setSiteQrPreview({
                site_name: site.site_name || 'Site',
                qr_token: site.qr_token,
                dataUrl
            });
        } catch (e) {
            console.error(e);
            toast.error('Failed to generate QR code');
        }
    };

    // Manager management functions
    const handleAddManager = () => {
        setEditingManager(null);
        setManagerFormData({
            email: '',
            password_hash: '',
            name: ''
        });
    };

    const handleEditManager = (manager) => {
        setEditingManager(manager);
        setManagerFormData({
            email: manager.email,
            password_hash: manager.password_hash,
            name: manager.name
        });
    };

    const handleSaveManager = async () => {
        try {
            if (editingManager) {
                // Update existing manager
                const { error } = await supabase
                    .from('managers')
                    .update({
                        email: managerFormData.email,
                        password_hash: managerFormData.password_hash,
                        name: managerFormData.name,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', editingManager.id);

                if (error) throw error;
                toast.success('Manager updated successfully!');
            } else {
                // Add new manager
                const { error } = await supabase
                    .from('managers')
                    .insert([{
                        email: managerFormData.email,
                        password_hash: managerFormData.password_hash,
                        name: managerFormData.name,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }]);

                if (error) throw error;
                toast.success('Manager added successfully!');
            }

            refetchManagers();
            setShowManagerDialog(false);
            setEditingManager(null);
        } catch (error) {
            console.error('Error saving manager:', error);
            toast.error('Failed to save manager');
        }
    };

    const handleDeleteManager = async (managerId) => {
        if (!(await confirmAction({ title: 'Delete manager?', message: 'Are you sure you want to delete this manager?', confirmLabel: 'Delete', destructive: true }))) return;

        try {
            const { error } = await supabase
                .from('managers')
                .delete()
                .eq('id', managerId);

            if (error) throw error;
            toast.success('Manager deleted successfully!');
            refetchManagers();
        } catch (error) {
            console.error('Error deleting manager:', error);
            toast.error('Failed to delete manager');
        }
    };

    // Supervisor management functions
    const handleAddSupervisor = () => {
        setEditingSupervisor(null);
        setSupervisorFormData({
            supervisor_id: '',
            password_hash: '',
            name: '',
            site_id: '',
            email: '',
            phone: ''
        });
    };

    const handleEditSupervisor = (supervisor) => {
        setEditingSupervisor(supervisor);
        setSupervisorFormData({
            supervisor_id: supervisor.supervisor_id,
            password_hash: supervisor.password_hash,
            name: supervisor.name,
            site_id: supervisor.site_id,
            email: supervisor.email || '',
            phone: supervisor.phone || ''
        });
    };

    const handleSaveSupervisor = async () => {
        try {
            if (editingSupervisor) {
                // Update existing supervisor
                const { error } = await supabase
                    .from('supervisors')
                    .update({
                        supervisor_id: supervisorFormData.supervisor_id,
                        password_hash: supervisorFormData.password_hash,
                        name: supervisorFormData.name,
                        site_id: supervisorFormData.site_id,
                        email: supervisorFormData.email,
                        phone: supervisorFormData.phone,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', editingSupervisor.id);

                if (error) throw error;
                toast.success('Supervisor updated successfully!');
            } else {
                // Add new supervisor
                const { error } = await supabase
                    .from('supervisors')
                    .insert([{
                        supervisor_id: supervisorFormData.supervisor_id,
                        password_hash: supervisorFormData.password_hash,
                        name: supervisorFormData.name,
                        site_id: supervisorFormData.site_id,
                        email: supervisorFormData.email,
                        phone: supervisorFormData.phone,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }]);

                if (error) throw error;
                toast.success('Supervisor added successfully!');
            }

            refetchSupervisors();
            setShowSupervisorDialog(false);
            setEditingSupervisor(null);
        } catch (error) {
            console.error('Error saving supervisor:', error);
            toast.error('Failed to save supervisor');
        }
    };

    const handleDeleteSupervisor = async (supervisorId) => {
        if (!(await confirmAction({ title: 'Delete supervisor?', message: 'Are you sure you want to delete this supervisor?', confirmLabel: 'Delete', destructive: true }))) return;

        try {
            const { error } = await supabase
                .from('supervisors')
                .delete()
                .eq('id', supervisorId);

            if (error) throw error;
            toast.success('Supervisor deleted successfully!');
            refetchSupervisors();
        } catch (error) {
            console.error('Error deleting supervisor:', error);
            toast.error('Failed to delete supervisor');
        }
    };

    // Worker mutations
    const addWorkerMutation = useMutation({
        mutationFn: async (workerData) => {
            log.info('ADD WORKER MUTATION: Starting with data:', workerData, 'Worker type:', selectedWorkerType);

            const plainPassword = normalizeWorkerPasswordForSave(workerData.password);

            const baseWorkerData = {
                employee_id: workerData.employee_id,
                nric_fin: workerData.nric_fin,
                employee_name: workerData.employee_name,
                designation: workerData.designation,
                date_joined: workerData.date_joined,
                bank_account_number: workerData.bank_account_number,
                ot_rate_per_hour: parseFloat(workerData.ot_rate_per_hour),
                sun_ph_rate_per_day: parseFloat(workerData.sun_ph_rate_per_day),
                basic_salary_per_day: parseFloat(workerData.basic_salary_per_day),
                monthly_allowance: parseFloat(workerData.monthly_allowance) || 150,
                annual_leave_balance: parseInt(workerData.annual_leave_balance) || 10,
                medical_leave_balance: parseInt(workerData.medical_leave_balance) || 14,
                hospitalization_leave_balance: parseInt(workerData.hospitalization_leave_balance) || 60,
                annual_leave_limit: parseInt(workerData.annual_leave_limit) || 10,
                medical_leave_limit: parseInt(workerData.medical_leave_limit) || 14,
                hospitalization_leave_limit: parseInt(workerData.hospitalization_leave_limit) || 60,
                face_id_enabled: workerData.face_id_enabled !== false, // Default to true
                rejoin_dates: []
            };
            if (plainPassword) {
                baseWorkerData.password_hash = plainPassword;
            }

            if (selectedWorkerType === 'local') {
                // Validate local worker fields
                if (!workerData.birthday) {
                    throw new Error('Birthday is required for Local workers');
                }

                const birthdayValidation = validateBirthday(workerData.birthday);
                if (!birthdayValidation.isValid) {
                    throw new Error(birthdayValidation.error);
                }

                // Calculate CPF and SINDA values
                const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(workerData.birthday);
                const estimatedMonthlyWages =
                    (parseFloat(workerData.basic_salary_per_day) || 0) +
                    (parseFloat(workerData.monthly_allowance) || 0) +
                    (parseFloat(workerData.incentive_allowance) || 0);
                const sindaAmount = resolveSindaDeduction(estimatedMonthlyWages, {
                    sinda_eligible: !!workerData.sinda_eligible
                });

                // Insert into local_worker_details table
                const localWorkerData = {
                    ...baseWorkerData,
                    birthday: workerData.birthday,
                    cpf_employee_contribution: cpfEmployeeRate,
                    cpf_employer_contribution: cpfEmployerRate,
                    sinda_contribution: sindaAmount,
                    sinda_eligible: !!workerData.sinda_eligible
                };

                log.info('Inserting Local worker data:', localWorkerData);

                const { error } = await supabase
                    .from('local_worker_details')
                    .insert([localWorkerData]);

                if (error) {
                    console.error('LOCAL WORKER INSERT ERROR:', error);
                    throw error;
                }

                log.info('LOCAL WORKER SUCCESS: Worker created in local_worker_details');

            } else {
                // Foreign worker - insert into worker_details table
                log.info('Inserting Foreign worker data:', baseWorkerData);

                const { error } = await supabase
                    .from('worker_details')
                    .insert([baseWorkerData]);

                if (error) {
                    console.error('FOREIGN WORKER INSERT ERROR:', error);
                    throw error;
                }

                log.info('FOREIGN WORKER SUCCESS: Worker created in worker_details');
            }
        },
        onSuccess: () => {
            log.info('ADD WORKER onSuccess: Closing dialog and refreshing');
            toast.success(`${selectedWorkerType === 'local' ? 'Local' : 'Foreign'} worker added successfully`);
            setShowAddWorkerDialog(false);
            resetWorkerForm();
            setSelectedWorkerType(''); // Reset worker type
            setCalculatedCPFEmployee(0);
            setCalculatedCPFEmployer(0);
            setCalculatedSINDA(0);
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
        },
        onError: (error) => {
            console.error('ADD WORKER onError:', error);
            toast.error(`Failed to add worker: ${error.message}`);
        },
    });

    const editWorkerMutation = useMutation({
        mutationFn: async ({ employee_id, workerData, workerType }) => {
            const resolvedWorkerType = workerType || editWorkerType || selectedWorkerType;
            log.info('EDIT WORKER MUTATION: Starting with data:', workerData, 'Worker type:', resolvedWorkerType);

            const newEmployeeId = workerData.employee_id?.trim();
            const employeeIdChanged = newEmployeeId && newEmployeeId !== employee_id;

            const normalizedRejoins = normalizeRejoinDatesInput(workerData.rejoin_dates);
            const cessationTrim =
                workerData.date_of_cessation && String(workerData.date_of_cessation).trim()
                    ? String(workerData.date_of_cessation).trim()
                    : null;
            const inCompanyFlag = workerData.in_company !== false;

            const plainPassword = normalizeWorkerPasswordForSave(
                workerData.password ?? workerData.password_hash
            );

            const baseUpdateData = {
                nric_fin: workerData.nric_fin,
                employee_name: workerData.employee_name,
                designation: workerData.designation,
                date_joined: workerData.date_joined,
                bank_account_number: workerData.bank_account_number,
                ot_rate_per_hour: parseFloat(workerData.ot_rate_per_hour),
                sun_ph_rate_per_day: parseFloat(workerData.sun_ph_rate_per_day),
                basic_salary_per_day: parseFloat(workerData.basic_salary_per_day),
                monthly_allowance: parseFloat(workerData.monthly_allowance) || 0,
                annual_leave_limit: parseInt(workerData.annual_leave_limit),
                medical_leave_limit: parseInt(workerData.medical_leave_limit),
                hospitalization_leave_limit: parseInt(workerData.hospitalization_leave_limit) || 60,
                annual_leave_balance: parseInt(workerData.annual_leave_balance),
                medical_leave_balance: parseInt(workerData.medical_leave_balance),
                hospitalization_leave_balance: parseInt(workerData.hospitalization_leave_balance) || 60,
                face_id_enabled: workerData.face_id_enabled !== false, // Default to true
                in_company: inCompanyFlag,
                date_of_cessation: cessationTrim,
                rejoin_dates: normalizedRejoins
            };

            // Include employee_id in update if it's being changed
            if (employeeIdChanged) {
                baseUpdateData.employee_id = newEmployeeId;
            }

            const saveWorkerPassword = async (targetEmployeeId) => {
                if (!plainPassword) return;
                const typeLabel = resolvedWorkerType === 'local' ? 'Local' : 'Foreign';
                const pwOk = await adminSetWorkerPassword({
                    employeeId: targetEmployeeId,
                    workerType: resolvedWorkerType === 'local' ? 'local' : 'foreign',
                    newPassword: plainPassword,
                });
                if (!pwOk) {
                    // admin_set_worker_password returns false when no row matches (wrong id / wrong Local|Foreign table)
                    throw new Error(
                        `No ${typeLabel} worker with Employee ID ${targetEmployeeId}. Password was not changed — check the ID and Local/Foreign type.`
                    );
                }
            };

            if (resolvedWorkerType === 'local') {
                // Update local worker - recalculate CPF and SINDA
                const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(workerData.birthday);
                const estimatedMonthlyWages =
                    (parseFloat(workerData.basic_salary_per_day) || 0) +
                    (parseFloat(workerData.monthly_allowance) || 0) +
                    (parseFloat(workerData.incentive_allowance) || 0);
                const sindaAmount = resolveSindaDeduction(estimatedMonthlyWages, {
                    sinda_eligible: !!workerData.sinda_eligible
                });

                const localUpdateData = {
                    ...baseUpdateData,
                    birthday: workerData.birthday,
                    cpf_employee_contribution: cpfEmployeeRate,
                    cpf_employer_contribution: cpfEmployerRate,
                    sinda_contribution: sindaAmount,
                    sinda_eligible: !!workerData.sinda_eligible,
                    in_company: workerData.in_company !== false
                };

                log.info('Updating Local worker data:', localUpdateData);

                // If employee_id is being changed, we need to handle it carefully
                if (employeeIdChanged) {
                    // First check if new employee_id already exists
                    const { data: existingWorker } = await supabase
                        .from('local_worker_details')
                        .select('employee_id')
                        .eq('employee_id', newEmployeeId)
                        .maybeSingle();

                    if (existingWorker) {
                        throw new Error(`Employee ID ${newEmployeeId} already exists`);
                    }

                    // Update worker details with new employee_id
                    const { error: workerError } = await supabase
                        .from('local_worker_details')
                        .update(localUpdateData)
                        .eq('employee_id', employee_id);

                    if (workerError) {
                        console.error('LOCAL WORKER UPDATE ERROR:', workerError);
                        throw workerError;
                    }

                    // Update all shifts with the new worker_id
                    const { error: shiftsError } = await supabase
                        .from('shifts')
                        .update({ worker_id: newEmployeeId })
                        .eq('worker_id', employee_id);

                    if (shiftsError) {
                        console.error('SHIFTS UPDATE ERROR:', shiftsError);
                        throw shiftsError;
                    }

                    // Update all leave_requests with the new employee_id
                    const { error: leavesError } = await supabase
                        .from('leave_requests')
                        .update({ employee_id: newEmployeeId })
                        .eq('employee_id', employee_id);

                    if (leavesError) {
                        console.error('LEAVE REQUESTS UPDATE ERROR:', leavesError);
                        // Don't throw - leaves update is not critical
                        log.warn('Warning: Could not update leave requests:', leavesError);
                    }

                    log.info(`Updated all shifts and leave requests from ${employee_id} to ${newEmployeeId}`);
                } else {
                    // Normal update without changing employee_id
                    const { error } = await supabase
                        .from('local_worker_details')
                        .update(localUpdateData)
                        .eq('employee_id', employee_id);

                    if (error) {
                        console.error('LOCAL WORKER UPDATE ERROR:', error);
                        throw error;
                    }
                }

                log.info('LOCAL WORKER UPDATE SUCCESS');

            } else {
                // Update foreign worker
                log.info('Updating Foreign worker data:', baseUpdateData);

                // If employee_id is being changed, we need to handle it carefully
                if (employeeIdChanged) {
                    // First check if new employee_id already exists
                    const { data: existingWorker } = await supabase
                        .from('worker_details')
                        .select('employee_id')
                        .eq('employee_id', newEmployeeId)
                        .maybeSingle();

                    if (existingWorker) {
                        throw new Error(`Employee ID ${newEmployeeId} already exists`);
                    }

                    // Update worker details with new employee_id
                    const { error: workerError } = await supabase
                        .from('worker_details')
                        .update(baseUpdateData)
                        .eq('employee_id', employee_id);

                    if (workerError) {
                        console.error('FOREIGN WORKER UPDATE ERROR:', workerError);
                        throw workerError;
                    }

                    // Update all shifts with the new worker_id
                    const { error: shiftsError } = await supabase
                        .from('shifts')
                        .update({ worker_id: newEmployeeId })
                        .eq('worker_id', employee_id);

                    if (shiftsError) {
                        console.error('SHIFTS UPDATE ERROR:', shiftsError);
                        throw shiftsError;
                    }

                    // Update all leave_requests with the new employee_id
                    const { error: leavesError } = await supabase
                        .from('leave_requests')
                        .update({ employee_id: newEmployeeId })
                        .eq('employee_id', employee_id);

                    if (leavesError) {
                        console.error('LEAVE REQUESTS UPDATE ERROR:', leavesError);
                        // Don't throw - leaves update is not critical
                        log.warn('Warning: Could not update leave requests:', leavesError);
                    }

                    log.info(`Updated all shifts and leave requests from ${employee_id} to ${newEmployeeId}`);
                } else {
                    // Normal update without changing employee_id
                    const { error } = await supabase
                        .from('worker_details')
                        .update(baseUpdateData)
                        .eq('employee_id', employee_id);

                    if (error) {
                        console.error('FOREIGN WORKER UPDATE ERROR:', error);
                        throw error;
                    }
                }

                log.info('FOREIGN WORKER UPDATE SUCCESS');
            }

            const targetEmployeeId = employeeIdChanged ? newEmployeeId : employee_id;
            await saveWorkerPassword(targetEmployeeId);
        },
        onSuccess: () => {
            toast.success(`${(editWorkerType || selectedWorkerType) === 'local' ? 'Local' : 'Foreign'} worker updated successfully`);
            setShowEditWorkerDialog(false);
            resetWorkerForm();
            setSelectedWorkerType('');
            setEditWorkerType('');
            setCalculatedCPFEmployee(0);
            setCalculatedCPFEmployer(0);
            setCalculatedSINDA(0);
            
            // Refresh all worker data to show updated information
            queryClient.invalidateQueries({ queryKey: ['local-workers'] });
            queryClient.invalidateQueries({ queryKey: ['foreign-workers'] });
            queryClient.invalidateQueries({ queryKey: ['shifts'] }); // Refresh shifts to show updated worker_id
        },
        onError: (error) => {
            console.error('EDIT WORKER onError:', error);
            toast.error(`Failed to update worker: ${error.message}`);
        },
    });

    const deleteWorkerMutation = useMutation({
        mutationFn: async ({ employee_id, workerType }) => {
            const tableName = workerType === 'local' ? 'local_worker_details' : 'worker_details';
            
            log.info(`Deleting ${workerType} worker ${employee_id} from ${tableName}`);
            
            const { error } = await supabase
                .from(tableName)
                .delete()
                .eq('employee_id', employee_id);
            
            if (error) {
                console.error(`Error deleting ${workerType} worker:`, error);
                throw error;
            }
            
            log.info(`Successfully deleted ${workerType} worker ${employee_id}`);
        },
        onSuccess: () => {
            toast.success('Worker deleted successfully');
            setShowDeleteWorkerDialog(false);
            setDeleteWorkerId('');
            setDeleteWorkerType('');
            setDeletePassword('');
            setDeletePasswordError('');
            
            // Refresh worker lists
            queryClient.invalidateQueries({ queryKey: ['local-workers'] });
            queryClient.invalidateQueries({ queryKey: ['foreign-workers'] });
        },
        onError: (error) => {
            console.error('DELETE WORKER onError:', error);
            toast.error(`Failed to delete worker: ${error.message}`);
        },
    });

    const handleDeleteHistory = async () => {
        if (!(await verifyAdminSession())) {
            toast.error('Admin session expired. Please log in again.');
            return;
        }
        if (!isAdminDeletePinConfigured()) {
            toast.error('Admin delete PIN is not set. Add VITE_ADMIN_DELETE_PIN to .env (see .env.example).');
            return;
        }
        if (verifyAdminDeletePin(deletePin)) {
            setDeletePinError('');
            deleteAllMutation.mutate();
        } else {
            setDeletePinError('Incorrect PIN');
        }
    };

    const handleIndividualDelete = async () => {
        if (!(await verifyAdminSession())) {
            toast.error('Admin session expired. Please log in again.');
            return;
        }
        if (!isAdminDeletePinConfigured()) {
            toast.error('Admin delete PIN is not set. Add VITE_ADMIN_DELETE_PIN to .env (see .env.example).');
            return;
        }
        if (verifyAdminDeletePin(individualDeletePin)) {
            setIndividualDeletePinError('');
            deleteShiftMutation.mutate(pendingDeleteShiftId);
            setShowIndividualDeletePinDialog(false);
            setIndividualDeletePin('');
            setPendingDeleteShiftId(null);
        } else {
            setIndividualDeletePinError('Incorrect PIN');
        }
    };

    // Worker Information handlers
    const resetWorkerForm = () => {
        setWorkerFormData({
            employee_id: '',
            nric_fin: '',
            employee_name: '',
            designation: '',
            date_joined: '',
            bank_account_number: '',
            ot_rate_per_hour: '',
            sun_ph_rate_per_day: '',
            basic_salary_per_day: '',
            monthly_allowance: '150',
            password: '',
            annual_leave_limit: '10',
            medical_leave_limit: '14',
            hospitalization_leave_limit: '60',
            annual_leave_balance: '10',
            medical_leave_balance: '14',
            hospitalization_leave_balance: '60',
            birthday: '',
            name: '',
            password_hash: '',
            stored_password_encrypted: false,
            face_id_enabled: true, // Default to enabled
            in_company: true,
            date_of_cessation: '',
            rejoin_dates: [],
            sinda_eligible: false
        });
    };

    const handleAddWorkerClick = () => {
        resetWorkerForm();
        setShowWorkerTypeDialog(true);
    };

    // New state for edit worker flow
    const [showEditWorkerTypeDialog, setShowEditWorkerTypeDialog] = useState(false);

    const handleEditWorkerClick = () => {
        setShowEditWorkerTypeDialog(true);
    };

    // Function to handle worker type selection for editing
    const handleEditWorkerTypeSelect = (workerType) => {
        setSelectedWorkerType(workerType);
        setShowEditWorkerTypeDialog(false);
        const employeeId = prompt(`Enter ${workerType === 'local' ? 'Local' : 'Foreign'} Worker Employee ID to edit:`);
        if (!employeeId) return;
        loadWorkerForEdit(employeeId.trim(), workerType);
    };

    // Function to load worker data after type is selected
    const loadWorkerForEdit = async (employeeId, workerType) => {
        try {
            const tableName = workerType === 'local' ? 'local_worker_details' : 'worker_details';
            const { data: workerData, error } = await supabase
                .from(tableName)
                .select('*')
                .eq('employee_id', employeeId)
                .single();

            if (error || !workerData) {
                toast.error(`Worker not found in ${workerType} worker table`);
                return;
            }

            // Prepare form data based on worker type
            const formData = {
                employee_id: workerData.employee_id,
                nric_fin: workerData.nric_fin || '',
                employee_name: workerData.employee_name || workerData.name || '',
                designation: workerData.designation || '',
                date_joined: workerData.date_joined || '',
                bank_account_number: workerData.bank_account_number || '',
                ot_rate_per_hour: workerData.ot_rate_per_hour ?? '',
                sun_ph_rate_per_day: workerData.sun_ph_rate_per_day ?? '',
                basic_salary_per_day: workerData.basic_salary_per_day ?? '',
                monthly_allowance: workerData.monthly_allowance != null ? String(workerData.monthly_allowance) : '150',
                password: getEditableWorkerPassword(workerData.password_hash || workerData.password),
                stored_password_encrypted: isStoredPasswordHash(workerData.password_hash || workerData.password || ''),
                annual_leave_limit: workerData.annual_leave_limit ?? '10',
                medical_leave_limit: workerData.medical_leave_limit ?? '14',
                hospitalization_leave_limit: workerData.hospitalization_leave_limit ?? '60',
                annual_leave_balance: workerData.annual_leave_balance ?? '10',
                medical_leave_balance: workerData.medical_leave_balance ?? '14',
                hospitalization_leave_balance: workerData.hospitalization_leave_balance ?? '60',
                birthday: workerData.birthday || '',
                name: workerData.name || workerData.employee_name || '',
                password_hash: getEditableWorkerPassword(workerData.password_hash || workerData.password),
                face_id_enabled: workerData.face_id_enabled !== false, // Default to true if not set
                in_company: workerData.in_company !== false, // Default to true if not set
                is_passed_out: workerData.is_passed_out || false,
                date_of_cessation: workerData.date_of_cessation || '',
                rejoin_dates: parseRejoinDatesFromWorkerRow(workerData),
                sinda_eligible: !!workerData.sinda_eligible
            };

            setWorkerFormData(formData);
            setSelectedWorkerType(workerType);
            setEditWorkerType(workerType);

            // Set face ID enrollment worker info
            setFaceIDEnrollmentWorker({
                employee_id: workerData.employee_id,
                employee_name: workerData.employee_name || workerData.name || '',
                workerType: workerType,
                face_id_set: workerData.face_id_set || false,
                face_id_enabled: workerData.face_id_enabled !== false
            });

            // If it's a local worker, calculate CPF and SINDA
            if (workerType === 'local') {
                const age = calculateAge(workerData.birthday);
                const cpfEmployeeRate = getCPFEmployeeRate(age);
                const cpfEmployerRate = getCPFEmployerRate(age);

                setCalculatedCPFEmployee(cpfEmployeeRate);
                setCalculatedCPFEmployer(cpfEmployerRate);
                setCalculatedSINDA(0);
            } else {
                // Reset CPF and SINDA for foreign workers
                setCalculatedCPFEmployee(0);
                setCalculatedCPFEmployer(0);
                setCalculatedSINDA(0);
            }

            setEditWorkerId(employeeId);
            setShowEditWorkerDialog(true);
        } catch (error) {
            console.error('Error fetching worker data:', error);
            toast.error('Error fetching worker data');
        }
    };

    const handleWorkerSearchClick = () => {
        setWorkerSearchId('');
        setWorkerSearchResult(null);
        setShowWorkerSearchDialog(true);
    };

    const runWorkerSearch = async () => {
        const id = workerSearchId.trim();
        if (!id) {
            toast.error('Please enter a worker ID');
            return;
        }

        setWorkerSearchLoading(true);
        setWorkerSearchResult(null);
        try {
            const [localRes, foreignRes, timesheetsRes, payslipsRes] = await Promise.all([
                supabase.from('local_worker_details').select('*').eq('employee_id', id).maybeSingle(),
                supabase.from('worker_details').select('*').eq('employee_id', id).maybeSingle(),
                supabase
                    .from('passed_out_timesheets')
                    .select('*')
                    .eq('worker_id', id)
                    .order('year', { ascending: false })
                    .order('month', { ascending: false })
                    .order('created_at', { ascending: false }),
                supabase
                    .from('passed_out_payslips')
                    .select('*')
                    .eq('worker_id', id)
                    .order('created_at', { ascending: false }),
            ]);

            if (localRes.error) throw localRes.error;
            if (foreignRes.error) throw foreignRes.error;
            if (timesheetsRes.error) throw timesheetsRes.error;
            if (payslipsRes.error) throw payslipsRes.error;

            let worker = null;
            let type = null;
            if (localRes.data) {
                worker = localRes.data;
                type = 'local';
            } else if (foreignRes.data) {
                worker = foreignRes.data;
                type = 'foreign';
            }

            if (!worker) {
                toast.error(`No worker found with ID "${id}" in local or foreign tables`);
                return;
            }

            setWorkerSearchResult({
                worker,
                type,
                timesheets: timesheetsRes.data || [],
                payslips: payslipsRes.data || [],
            });
            toast.success(
                `Found ${type} worker: ${worker.employee_name || worker.name || id} (${(timesheetsRes.data || []).length} timesheet(s), ${(payslipsRes.data || []).length} payslip(s))`
            );
        } catch (error) {
            console.error('Worker search error:', error);
            toast.error('Failed to search for worker');
        } finally {
            setWorkerSearchLoading(false);
        }
    };

    const handlePrintWorkerProfileFromSearch = async () => {
        if (!workerSearchResult) return;
        try {
            const logoUrl = localStorage.getItem(storageKey('timesheet', 'logoUrl')) || '/Akk-logo.jpg';
            const result = await printWorkerProfile({
                worker: workerSearchResult.worker,
                workerType: workerSearchResult.type,
                logoUrl,
            });
            toast.success(
                result?.mode === 'share'
                    ? 'Employee record ready — choose an app to save, print, or share'
                    : 'Employee record opened — use Print or Save as PDF'
            );
        } catch (error) {
            console.error('Print worker profile error:', error);
            toast.error(error.message || 'Failed to open print');
        }
    };

    const handleOpenYearlySummaryDialog = () => {
        setYearlySummaryYear(String(new Date().getFullYear()));
        setShowYearlySummaryDialog(true);
    };

    const handleGenerateYearlySummary = async () => {
        if (!workerSearchResult) return;
        const year = parseInt(yearlySummaryYear, 10);
        if (Number.isNaN(year) || year < 2000 || year > 2100) {
            toast.error('Please enter a valid year (2000–2100)');
            return;
        }
        try {
            const preview = aggregateYearlyPaySummary(workerSearchResult.payslips, year);
            if (preview.payslipCount === 0) {
                toast.error(`No passed-out payslips found for ${year}`);
                return;
            }
            const logoUrl = localStorage.getItem(storageKey('timesheet', 'logoUrl')) || '/Akk-logo.jpg';
            const result = await printYearlyPaySummary({
                worker: workerSearchResult.worker,
                workerType: workerSearchResult.type,
                payslips: workerSearchResult.payslips,
                year,
                logoUrl,
            });
            setShowYearlySummaryDialog(false);
            toast.success(
                result?.mode === 'share'
                    ? `Yearly pay summary ${year} ready — choose an app to save, print, or share (${preview.payslipCount} payslip(s))`
                    : `Yearly pay summary ${year} opened for print (${preview.payslipCount} payslip(s))`
            );
        } catch (error) {
            console.error('Yearly summary error:', error);
            toast.error(error.message || 'Failed to generate summary');
        }
    };

    const getPassedOutTimesheetStatusLabel = (ts) => {
        const statusLabels = {
            pending_worker: 'Not approved yet',
            returned_to_worker: ts.manager_name
                ? `Returned to worker for re-approval by ${ts.manager_name}`
                : 'Returned to worker for re-approval',
            awaiting_manager: 'Awaiting manager',
            awaiting_admin: 'Awaiting admin',
            approved: `Approved by ${ts.manager_name || 'manager/admin'}`,
            declined_by_worker: ts.worker_decline_reason
                ? `Declined by worker: ${ts.worker_decline_reason}`
                : 'Declined by worker',
            declined_by_manager: [
                ts.worker_decline_reason ? `Declined by worker: ${ts.worker_decline_reason}` : null,
                `Declined by manager${ts.manager_name ? ` (${ts.manager_name})` : ''}${ts.manager_decline_reason ? `: ${ts.manager_decline_reason}` : ''}`,
            ]
                .filter(Boolean)
                .join('. '),
        };
        return statusLabels[ts.status] || ts.status || 'Unknown';
    };

    const handleDeleteWorkerClick = async () => {
        const employeeId = prompt('Enter Employee ID to delete:');
        if (!employeeId) return;

        try {
            // Check both tables to find the worker and determine type
            let workerData = null;
            let workerType = '';

            // First check local_worker_details
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('employee_id, employee_name')
                .eq('employee_id', employeeId.trim())
                .single();

            if (!localError && localWorker) {
                workerData = localWorker;
                workerType = 'local';
            } else {
                // Check worker_details for foreign workers
                const { data: foreignWorker, error: foreignError } = await supabase
                    .from('worker_details')
                    .select('employee_id, employee_name')
                    .eq('employee_id', employeeId.trim())
                    .single();

                if (!foreignError && foreignWorker) {
                    workerData = foreignWorker;
                    workerType = 'foreign';
                }
            }

            if (!workerData) {
                toast.error('Worker not found in either local or foreign worker tables');
                return;
            }

            // Confirm deletion with worker details
            const confirmMessage = `Are you sure you want to delete ${workerType === 'local' ? 'Local' : 'Foreign'} worker "${workerData.employee_name}" (ID: ${workerData.employee_id})? This action cannot be undone.`;
            if (!(await confirmAction({ title: 'Delete worker?', message: confirmMessage, confirmLabel: 'Delete', destructive: true }))) {
                return;
            }

            setDeleteWorkerId(employeeId.trim());
            setDeleteWorkerType(workerType); // Store worker type for deletion
            setDeletePassword('');
            setDeletePasswordError('');
            setShowDeleteWorkerDialog(true);
        } catch (error) {
            console.error('Error checking worker:', error);
            toast.error('Error checking worker details');
        }
    };

    const handleAddWorker = () => {
        log.info('Add Worker button clicked');
        log.info('Form data:', workerFormData);

        const isValueEmpty = (val) => val === undefined || val === null || val === '' || (typeof val === 'string' && val.trim() === '');
        const addRequiredFields = ['employee_id', 'employee_name', 'nric_fin', 'designation', 'date_joined', 'bank_account_number', 'ot_rate_per_hour', 'sun_ph_rate_per_day', 'basic_salary_per_day', 'password'];
        const missingAddFields = addRequiredFields.filter(field => isValueEmpty(workerFormData[field]));
        if (missingAddFields.length > 0) {
            log.debug('Validation failed - missing required fields');
            toast.error('Please fill in all required fields');
            return;
        }

        log.debug('Validation passed - calling mutation');
        addWorkerMutation.mutate(workerFormData);
    };

    const handleEditWorker = () => {
        // Common required fields for both worker types
        const requiredFields = [
            'employee_id', 'employee_name', 'nric_fin', 'designation', 
            'date_joined', 'bank_account_number', 'ot_rate_per_hour', 
            'sun_ph_rate_per_day', 'basic_salary_per_day'
        ];

        // Additional required fields for local workers
        if (selectedWorkerType === 'local') {
            requiredFields.push('birthday');
        }

        // Check all required fields (allow 0 as valid - don't treat as empty)
        const missingFields = requiredFields.filter(field => {
            const val = workerFormData[field];
            return val === undefined || val === null || val === '' || (typeof val === 'string' && val.trim() === '');
        });
        
        if (missingFields.length > 0) {
            toast.error(`Please fill in all required fields: ${missingFields.join(', ')}`);
            return;
        }

        // When marking worker as no longer in company, require Date of Cessation
        const notInCompany = workerFormData.in_company === false || workerFormData.in_company === 0;
        if (notInCompany) {
            const cessationVal = workerFormData.date_of_cessation;
            if (!cessationVal || (typeof cessationVal === 'string' && cessationVal.trim() === '')) {
                toast.error('Please enter Date of Cessation when marking worker as no longer in company');
                return;
            }
        }

        const normalizedRejoins = normalizeRejoinDatesInput(workerFormData.rejoin_dates || []);
        const timeline = validateWorkerEmploymentTimeline({
            inCompany: workerFormData.in_company,
            dateJoined: workerFormData.date_joined,
            dateOfCessation: workerFormData.date_of_cessation,
            rejoinDatesNormalized: normalizedRejoins,
        });
        if (!timeline.ok) {
            toast.error(timeline.message);
            return;
        }

        // Prepare the data to be saved
        const workerData = { ...workerFormData, rejoin_dates: normalizedRejoins };
        
        // Ensure numeric fields are properly formatted
        const numericFields = [
            'ot_rate_per_hour', 'sun_ph_rate_per_day', 'basic_salary_per_day',
            'monthly_allowance', 'annual_leave_limit', 'medical_leave_limit',
            'annual_leave_balance', 'medical_leave_balance'
        ];
        
        numericFields.forEach(field => {
            if (workerData[field] !== undefined && workerData[field] !== '') {
                workerData[field] = parseFloat(workerData[field]);
            }
        });

        editWorkerMutation.mutate({ 
            employee_id: editWorkerId, 
            workerData: workerData,
            workerType: editWorkerType || selectedWorkerType,
        });
    };

    const handleDeleteWorker = async () => {
        if (!(await verifyAdminSession())) {
            toast.error('Admin session expired. Please log in again.');
            return;
        }
        if (!isAdminDeletePinConfigured()) {
            toast.error('Admin delete PIN is not set. Add VITE_ADMIN_DELETE_PIN to .env (see .env.example).');
            return;
        }
        if (!verifyAdminDeletePin(deletePassword)) {
            setDeletePasswordError('Incorrect password');
            return;
        }
        
        if (!deleteWorkerType) {
            toast.error('Worker type not determined. Please try again.');
            return;
        }
        
        deleteWorkerMutation.mutate({ 
            employee_id: deleteWorkerId, 
            workerType: deleteWorkerType 
        });
    };

    const exportWorkersToExcel = async (type) => {
        const XLSX = await import('xlsx');
        const localRowsOrdered = [...localWorkersDirectory.active, ...localWorkersDirectory.leftCompany];
        const foreignRowsOrdered = [...foreignWorkersDirectory.active, ...foreignWorkersDirectory.leftCompany];

        const localData = localRowsOrdered.map((w) => ({
            'Worker Type': 'Local',
            'ID': w.employee_id,
            'NRIC/FIN': w.nric_fin,
            'Name': w.employee_name,
            'Designation': w.designation,
            'Date Joined': w.date_joined,
            'Date of Cessation': w.date_of_cessation || '',
            'Rejoin Date(s)': parseRejoinDatesFromWorkerRow(w).join('; '),
            'In Company': w.in_company !== false && w.in_company !== 0 ? 'Yes' : 'No',
            'Bank Account': w.bank_account_number,
            'Basic Per Day': formatAmount(w.basic_salary_per_day),
            'Monthly Allowance': formatAmount(w.monthly_allowance),
            'OT Rate': formatAmount(w.ot_rate_per_hour),
            'Sun/PH Rate': formatAmount(w.sun_ph_rate_per_day),
            'Annual Leave Limit': w.annual_leave_limit,
            'Medical Leave Limit': w.medical_leave_limit,
            'Annual Leave Balance': w.annual_leave_balance,
            'Medical Leave Balance': w.medical_leave_balance,
            'CPF Employee %': w.cpf_employee_contribution,
            'CPF Employer %': w.cpf_employer_contribution,
            'SINDA Contribution': formatAmount(w.sinda_contribution)
        }));

        const foreignData = foreignRowsOrdered.map((w) => ({
            'Worker Type': 'Foreign',
            'ID': w.employee_id,
            'NRIC/FIN': w.nric_fin,
            'Name': w.employee_name,
            'Designation': w.designation,
            'Date Joined': w.date_joined,
            'Date of Cessation': w.date_of_cessation || '',
            'Rejoin Date(s)': parseRejoinDatesFromWorkerRow(w).join('; '),
            'In Company': w.in_company !== false && w.in_company !== 0 ? 'Yes' : 'No',
            'Bank Account': w.bank_account_number,
            'Basic Per Day': formatAmount(w.basic_salary_per_day),
            'Monthly Allowance': formatAmount(w.monthly_allowance),
            'OT Rate': formatAmount(w.ot_rate_per_hour),
            'Sun/PH Rate': formatAmount(w.sun_ph_rate_per_day),
            'Annual Leave Limit': w.annual_leave_limit,
            'Medical Leave Limit': w.medical_leave_limit,
            'Annual Leave Balance': w.annual_leave_balance,
            'Medical Leave Balance': w.medical_leave_balance
        }));

        const workbook = XLSX.utils.book_new();

        if (type === 'local') {
            if (localData.length === 0) {
                toast.error('No local worker data to export');
                return;
            }
            const localSheet = XLSX.utils.json_to_sheet(localData);
            XLSX.utils.book_append_sheet(workbook, localSheet, 'Local Workers');
        } else if (type === 'foreign') {
            if (foreignData.length === 0) {
                toast.error('No foreign worker data to export');
                return;
            }
            const foreignSheet = XLSX.utils.json_to_sheet(foreignData);
            XLSX.utils.book_append_sheet(workbook, foreignSheet, 'Foreign Workers');
        } else {
            if (localData.length === 0 && foreignData.length === 0) {
                toast.error('No worker data to export');
                return;
            }

            if (localData.length > 0) {
                const localSheet = XLSX.utils.json_to_sheet(localData);
                XLSX.utils.book_append_sheet(workbook, localSheet, 'Local Workers');
            }

            if (foreignData.length > 0) {
                const foreignSheet = XLSX.utils.json_to_sheet(foreignData);
                XLSX.utils.book_append_sheet(workbook, foreignSheet, 'Foreign Workers');
            }
        }

        const filename = `AKK_Workers_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
        XLSX.writeFile(workbook, filename);
    };

    const printWorkerDetails = (type) => {
        const styles = `
            body {
                font-family: Calibri, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                padding: 16px;
            }
            h1 {
                font-size: 18px;
                margin-bottom: 16px;
            }
            h2 {
                font-size: 14px;
                margin-top: 24px;
                margin-bottom: 8px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                margin-bottom: 16px;
            }
            th, td {
                border: 1px solid #e5e7eb;
                padding: 4px 6px;
            }
            th {
                background-color: #f3f4f6;
                text-align: left;
            }
            td {
                vertical-align: top;
            }
        `;

        const renderTable = (title, rows) => {
            if (!rows || rows.length === 0) return '';

            const header = [
                'ID',
                'NRIC/FIN',
                'Name',
                'Designation',
                'Date Joined',
                'Bank',
                'Basic/Day',
                'Monthly Allow.',
                'OT Rate',
                'Sun/PH Rate',
                'AL Limit',
                'MC Limit',
                'AL Balance',
                'MC Balance',
                'CPF Emp %',
                'CPF Empr %',
                'SINDA',
                'Cessation',
                'Rejoin date(s)'
            ];

            const headerHtml = header.map((h) => `<th>${h}</th>`).join('');

            const bodyHtml = rows
                .map(
                    (w) => `
                <tr>
                    <td>${w.employee_id || ''}</td>
                    <td>${w.nric_fin || ''}</td>
                    <td>${w.employee_name || ''}</td>
                    <td>${w.designation || ''}</td>
                    <td>${w.date_joined || ''}</td>
                    <td>${w.bank_account_number || ''}</td>
                    <td style="text-align:right;">${formatAmount(w.basic_salary_per_day)}</td>
                    <td style="text-align:right;">${formatAmount(w.monthly_allowance)}</td>
                    <td style="text-align:right;">${formatAmount(w.ot_rate_per_hour)}</td>
                    <td style="text-align:right;">${formatAmount(w.sun_ph_rate_per_day)}</td>
                    <td style="text-align:right;">${w.annual_leave_limit ?? ''}</td>
                    <td style="text-align:right;">${w.medical_leave_limit ?? ''}</td>
                    <td style="text-align:right;">${w.annual_leave_balance ?? ''}</td>
                    <td style="text-align:right;">${w.medical_leave_balance ?? ''}</td>
                    <td style="text-align:right;">${w.cpf_employee_contribution ?? ''}</td>
                    <td style="text-align:right;">${w.cpf_employer_contribution ?? ''}</td>
                    <td style="text-align:right;">${formatAmount(w.sinda_contribution)}</td>
                    <td>${w.date_of_cessation ?? ''}</td>
                    <td>${parseRejoinDatesFromWorkerRow(w).join('; ') || ''}</td>
                </tr>
            `
                )
                .join('');

            return `
                <h2>${title}</h2>
                <table>
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${bodyHtml}</tbody>
                </table>
            `;
        };

        const localPrintRows = [...localWorkersDirectory.active, ...localWorkersDirectory.leftCompany];
        const foreignPrintRows = [...foreignWorkersDirectory.active, ...foreignWorkersDirectory.leftCompany];

        const localHtml =
            type === 'foreign' ? '' : renderTable('Local Workers', localPrintRows);
        const foreignHtml =
            type === 'local' ? '' : renderTable('Foreign Workers', foreignPrintRows);

        if (!localHtml && !foreignHtml) {
            toast.error('No worker data to print');
            return;
        }
        const html = `
            <html>
                <head>
                    <title>Worker Details</title>
                    <style>${styles}</style>
                </head>
                <body>
                    <h1>AKK ENGINEERING PTE. LTD. — Worker Details</h1>
                    ${localHtml}
                    ${foreignHtml}
                </body>
            </html>
        `;
        printOrShareHtmlDocument(html, {
            title: 'Print worker details',
            fileName: `Worker_Details_${format(new Date(), 'yyyy-MM-dd')}.pdf`,
            printDelayMs: 350,
        }).catch((err) => {
            console.error(err);
            toast.error('Failed to open print');
        });
    };

    // Optimized with useMemo to avoid recalculation on every render
    const openEditShiftDialog = async (shift, saveAndApprove = false) => {
        const breaks = await getBreaksData(shift.id);
        const formBreaksData = (breaks && breaks.length > 0)
            ? breaks.map((b) => ({
                lunch_start: toDateTimeLocalUtc(b.break_start),
                lunch_end: toDateTimeLocalUtc(b.break_end),
            }))
            : [{ lunch_start: '', lunch_end: '' }];

        setEditingShift(shift);
        setEditSaveAndApprove(saveAndApprove);
        setShiftEditData({
            entry_time: toDateTimeLocalUtc(shift.entry_time),
            leave_time: shift.leave_time ? toDateTimeLocalUtc(shift.leave_time) : '',
            breaks: formBreaksData,
            leave_type: shift.leave_type || '__none__',
            originalBreaks: breaks || [],
        });
        setShowEditShiftDialog(true);
    };

    const handleEditShiftSave = async (formData, approveAfterSave = false) => {
        if (!editingShift || !formData) return;

        const entryTimeIso = fromDateTimeLocalUtc(formData.entry_time);
        const leaveTimeIso = fromDateTimeLocalUtc(formData.leave_time);

        if (!entryTimeIso) {
            toast.error('Entry time is required');
            return;
        }

        if (leaveTimeIso && new Date(leaveTimeIso).getTime() <= new Date(entryTimeIso).getTime()) {
            toast.error('Exit time must be after entry time');
            return;
        }

        const workDateFromEntry = getWorkDateFromDateTime(entryTimeIso);
        const workDate = workDateFromEntry || editingShift.work_date;

        const breaksEqual = (formBreaks, dbBreaks) => {
            if (formBreaks.length !== dbBreaks.length) {
                return false;
            }

            return formBreaks.every((formBreak, index) => {
                const dbBreak = dbBreaks[index];
                const formStart = new Date(fromDateTimeLocalUtc(formBreak.lunch_start));
                const formEnd = new Date(fromDateTimeLocalUtc(formBreak.lunch_end));
                const dbStart = new Date(dbBreak.break_start);
                const dbEnd = new Date(dbBreak.break_end);

                const formStartValid = formStart instanceof Date && !isNaN(formStart.getTime());
                const formEndValid = formEnd instanceof Date && !isNaN(formEnd.getTime());
                const dbStartValid = !isNaN(dbStart.getTime());
                const dbEndValid = !isNaN(dbEnd.getTime());

                if (!formStartValid || !formEndValid || !dbStartValid || !dbEndValid) {
                    return false;
                }

                return formStart.getTime() === dbStart.getTime() && formEnd.getTime() === dbEnd.getTime();
            });
        };

        const rawBreaks = formData.breaks || [];
        const originalBreaks = formData.originalBreaks || [];
        const breaksChanged = !breaksEqual(rawBreaks, originalBreaks);

        for (let i = 0; i < rawBreaks.length; i++) {
            const b = rawBreaks[i];
            const hasStart = !!b.lunch_start;
            const hasEnd = !!b.lunch_end;
            if (hasStart !== hasEnd) {
                toast.error('Each break must have both start and end time');
                return;
            }
            if (hasStart && hasEnd) {
                const startDate = new Date(fromDateTimeLocalUtc(b.lunch_start));
                const endDate = new Date(fromDateTimeLocalUtc(b.lunch_end));
                if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
                    toast.error('Break end time must be after start time');
                    return;
                }
            }
        }

        const normalizedBreaks = rawBreaks
            .map((b) => ({
                break_start: b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null,
                break_end: b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null
            }))
            .filter((b) => b.break_start && b.break_end);

        const isCompleted = !!leaveTimeIso;
        const calculations = isCompleted
            ? calculateShiftHours(entryTimeIso, leaveTimeIso, normalizedBreaks, workDate)
            : { basicHours: 0, sundayHours: 0, otHours: 0 };

        const updateData = {
            work_date: workDate,
            entry_time: entryTimeIso,
            leave_time: leaveTimeIso,
            leave_type: formData.leave_type === '__none__' ? null : formData.leave_type,
            worked_hours: calculations.basicHours,
            sunday_hours: calculations.sundayHours,
            ot_hours: calculations.otHours,
            break_hours: calculations.breakHours,
            has_left: isCompleted
        };

        const shiftUpdateData = applyApprovalOnShiftSave({
            shiftUpdateData: {
                ...updateData,
                edited_by: getShiftEditorName('admin'),
            },
            editingShift,
            isCompleted,
            approveAfterSave,
            actorName: getShiftApproverName('admin'),
            role: 'admin',
        });

        let { error: shiftError } = await supabase
            .from('shifts')
            .update(shiftUpdateData)
            .eq('id', editingShift.id);

        if (shiftError && shiftError.message?.includes('edited_by')) {
            console.warn('edited_by column not found, retrying without it');
            const { edited_by, ...updateWithoutEditedBy } = shiftUpdateData;
            const retryResult = await supabase
                .from('shifts')
                .update(updateWithoutEditedBy)
                .eq('id', editingShift.id);
            shiftError = retryResult.error;
        }

        if (shiftError) {
            toast.error('Failed to update shift');
            console.error(shiftError);
            return;
        }

        if (breaksChanged) {
            const { error: verifyError } = await supabase
                .from('breaks')
                .select('*')
                .eq('shift_id', editingShift.id);

            if (verifyError) {
                console.error('Error verifying current breaks:', verifyError);
                toast.error('Failed to verify breaks');
                return;
            }

            const { data: allBreaksForTest, error: fetchError } = await supabase
                .from('breaks')
                .select('id, shift_id')
                .eq('shift_id', editingShift.id);

            if (fetchError) {
                console.error('Fetch error:', fetchError);
            }

            if (allBreaksForTest && allBreaksForTest.length > 0) {
                await supabase
                    .from('breaks')
                    .delete({ count: 'exact' })
                    .eq('id', allBreaksForTest[0].id);
            }

            const { error: deleteBreaksError } = await supabase
                .from('breaks')
                .delete({ count: 'exact' })
                .eq('shift_id', editingShift.id);

            if (deleteBreaksError) {
                console.error('Delete error:', deleteBreaksError);
                toast.error('Failed to update breaks');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 100));

            if (normalizedBreaks.length > 0) {
                const { error: insertBreaksError } = await supabase
                    .from('breaks')
                    .insert(
                        normalizedBreaks.map((b) => ({
                            shift_id: editingShift.id,
                            break_start: b.break_start,
                            break_end: b.break_end
                        }))
                    )
                    .select();

                if (insertBreaksError) {
                    console.error('Insert error:', insertBreaksError);
                    toast.error('Failed to update breaks');
                    return;
                }
            }
        }

        toast.success(approveAfterSave ? 'Shift saved and approved' : 'Shift updated successfully');
        setBreaksCache(prev => {
            const newCache = new Map(prev);
            newCache.delete(editingShift.id);
            return newCache;
        });
        setShowEditShiftDialog(false);
        setEditSaveAndApprove(false);

        queryClient.invalidateQueries({ queryKey: ['shifts'] });
        if (editingShift.worker_id) {
            queryClient.invalidateQueries({ queryKey: ['currentShift', editingShift.worker_id] });
        }
        queryClient.invalidateQueries({ queryKey: ['currentShift'] });
    };

    const handleApproveShift = async (shift) => {
        if (!shift?.id || isShiftApproved(shift)) return;
        setApprovingShiftId(shift.id);
        try {
            await approveShiftRecord(supabase, shift.id, getShiftApproverName('admin'));
            toast.success('Shift approved');
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
        } catch (e) {
            toast.error(e?.message || 'Failed to approve shift');
        } finally {
            setApprovingShiftId(null);
        }
    };

    const handleDeclineShift = async (shift) => {
        if (!shift?.id) return;
        setApprovingShiftId(shift.id);
        try {
            await declineShiftRecord(supabase, shift.id);
            toast.info('Shift declined — update details and save & approve when ready');
            await openEditShiftDialog({ ...shift, approval_status: 'declined' });
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
        } catch (e) {
            toast.error(e?.message || 'Failed to decline shift');
        } finally {
            setApprovingShiftId(null);
        }
    };

    const filteredShifts = useMemo(() => {
        const seen = new Set();
        return shifts.filter(s => {
            if (!s?.id || seen.has(s.id)) return false;
            seen.add(s.id);

            const matchesFilter = filter === 'all' ||
                                 (filter === 'completed' && s.has_left) ||
                                 (filter === 'in_progress' && !s.has_left) ||
                                 (filter === 'unapproved' && matchesUnapprovedFilter(s));
            let matchesSearch = false;

            if (searchTerm.startsWith('/')) {
                // Special search syntax: /worker_id to search by worker ID
                const searchWorkerId = searchTerm.slice(1).toLowerCase().trim();
                matchesSearch = s.worker_id?.toLowerCase().includes(searchWorkerId);
            } else {
                // Regular search: worker name or site name
                matchesSearch =
                    s.workers?.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    s.worker_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    s.sites?.site_name?.toLowerCase().includes(searchTerm.toLowerCase());
            }

            const matchesWorkerId = !workerIdFilter || s.worker_id?.toLowerCase().includes(workerIdFilter.toLowerCase());
            const matchesSite = siteFilter === 'all' || s.sites?.site_name === siteFilter;
            const matchesWorkerType =
                workerTypeFilter === 'all' ||
                (workerTypeFilter === 'local' && s.worker_type === 'local') ||
                (workerTypeFilter === 'foreign' && s.worker_type === 'foreign');

            // Date filtering is now handled at database level, but we still need to filter in memory
            // for cases where dateFilter is 'all' or when month/year is not selected
            let matchesDate = true;
            if (dateFilter !== 'all' && s.work_date) {
                const shiftDate = new Date(s.work_date + 'T00:00:00'); // Ensure consistent date parsing
                
                if (dateFilter === 'month') {
                    if (selectedMonth) {
                        // Specific month selected
                        const [year, month] = selectedMonth.split('-');
                        const targetYear = parseInt(year);
                        const targetMonth = parseInt(month) - 1; // JavaScript months are 0-indexed
                        matchesDate = shiftDate.getMonth() === targetMonth &&
                                     shiftDate.getFullYear() === targetYear;
                    } else {
                        // Current month
                        const now = new Date();
                        matchesDate = shiftDate.getMonth() === now.getMonth() &&
                                     shiftDate.getFullYear() === now.getFullYear();
                    }
                } else if (dateFilter === 'year') {
                    const targetYear = parseInt(selectedYear || new Date().getFullYear());
                    matchesDate = shiftDate.getFullYear() === targetYear;
                }
            }

            return matchesFilter && matchesSearch && matchesDate && matchesWorkerId && matchesSite && matchesWorkerType;
        }).sort((a, b) => {
            // Sort by work_date descending (most recent first), then by entry_time descending
            const dateA = new Date(a.work_date);
            const dateB = new Date(b.work_date);
            if (dateA.getTime() !== dateB.getTime()) {
                return dateB.getTime() - dateA.getTime();
            }
            // If same date, sort by entry_time descending
            const timeA = a.entry_time ? new Date(a.entry_time).getTime() : 0;
            const timeB = b.entry_time ? new Date(b.entry_time).getTime() : 0;
            return timeB - timeA;
        });
    }, [shifts, filter, searchTerm, workerIdFilter, siteFilter, workerTypeFilter, dateFilter, selectedMonth, selectedYear]);

    // Get unique sites for filter - optimized with useMemo
    const uniqueSites = useMemo(() => {
        return [...new Set(shifts.map(s => s.sites?.site_name).filter(Boolean))];
    }, [shifts]);

    const unapprovedCount = useMemo(
        () => shifts.filter((s) => matchesUnapprovedFilter(s)).length,
        [shifts]
    );
    const inProgressCount = useMemo(
        () => shifts.filter((s) => !s.has_left).length,
        [shifts]
    );

    const exportToExcel = async () => {
        const XLSX = await import('xlsx');
        const data = filteredShifts.map(s => ({
            'Date': s.work_date,
                'Worker Name': s.workers?.employee_name || 'Unknown',
            'Worker ID': s.worker_id,
            'Worker Type': s.worker_type === 'local' ? 'Local' : s.worker_type === 'foreign' ? 'Foreign' : '',
            'Site': s.sites?.site_name || 'Unknown',
            'Entry Time': s.entry_time ? formatTime(s.entry_time) : '',
            'Breaks': (s.break_hours && s.break_hours > 0)
                ? `${s.break_hours.toFixed(1)} hrs`
                : (s.breaks && s.breaks.length > 0)
                    ? s.breaks
                        .map((b, i) => `Break ${i + 1}: ${b.break_start ? formatTime(b.break_start) : ''}${b.break_end ? ` - ${formatTime(b.break_end)}` : ''}`)
                        .join(' | ')
                    : '',
            'Break Hours': s.break_hours || 0,
            'Exit Time': s.leave_time ? formatTime(s.leave_time) : '',
            'Worked Hours': s.worked_hours || 0,
            'Sunday Hours': s.sunday_hours || 0,
            'OT Hours': s.ot_hours || 0,
            'Status': s.has_left ? 'Completed' : 'In Progress',
            'Is Sunday': isSunday(s.work_date) ? 'Yes' : 'No',
            'Is Holiday': isPublicHoliday(s.work_date) ? 'Yes' : 'No'
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Shifts');

        // Generate filename based on filters
        let filename;
        if (workerIdFilter && dateFilter === 'month') {
            // If specific worker and month filter, use ID Month/Year format
            const currentDate = new Date();
            const month = currentDate.getMonth() + 1;
            const year = currentDate.getFullYear();
            filename = `${workerIdFilter}_${month}/${year}.xlsx`;
        } else {
            // Default format for general exports
            filename = `AKK_Timesheet_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
        }

        XLSX.writeFile(workbook, filename);
    };

    // Helper function to format time with date indication for multi-day shifts
    const formatTimeWithDate = (dateTime, workDate) => {
        if (!dateTime) return '';
        const timeStr = formatTime(dateTime);
        const exitYmd = getSingaporeWallClock(dateTime)?.ymd;
        const workYmd = String(workDate || '').slice(0, 10);
        if (exitYmd && workYmd && exitYmd !== workYmd) {
            const p = getSingaporeWallClock(dateTime);
            return `${timeStr} (${p.day}/${p.month})`;
        }
        return timeStr;
    };

    /**
     * extras.balanceLines / extras.amountPaid: pay balances used on this payslip and the amount
     * actually paid (see src/lib/payBalances.js). They add a Balances block under NET PAY;
     * NET PAY, CPF, SINDA and YTD are unchanged.
     */
    const printTimesheetAndPayslip = async (workerId, monthYear, deductions = [], salaryPaidDate = '', bonus = '', additions = [], returnHTML = false, extras = {}) => {
        try {
            const { year, month, startDate, endDate } = monthYearToDateRange(monthYear);
            // Ensure bonus is parsed correctly (handle string, number, or undefined)
            const bonusAmount = parseFloat(bonus) || 0;
            
            // Initialize all time tracking and financial variables
            let monthlyBasicHours = 0;
            // "Worked Hours" should mean ACTUAL worked hours (exclude PH credit-only and leave credits)
            let monthlyWorkedHours = 0;
            let monthlySundayHours = 0;
            let monthlyOtHours = 0;
            let totalOtHours = 0;
            let totalSunPhHours = 0;
            let totalBasicDays = 0;
            let totalSunPhDays = 0;
            
            // Get all shifts for the worker in the specified date range
            log.info('Fetching shifts for worker:', workerId, 'from:', startDate, 'to:', endDate);
            log.info('Date range:', startDate, 'to', endDate);

            const { data: shiftsData, error } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', workerId)
                .gte('work_date', startDate)
                .lte('work_date', endDate)
                .order('work_date', { ascending: true });

            if (error) {
                console.error('Error fetching shifts:', error);
                throw error;
            }

            const workerShifts = filterShiftsForPayroll(shiftsData || []);

            log.info('Shifts data:', workerShifts);

            // Debug: Check for leave shifts
            const leaveShifts = workerShifts?.filter(s => s.leave_type) || [];
            if (leaveShifts.length > 0) {
            }

            // Debug: Check all leave requests for this worker (including pending)
            const { data: allLeaveRequests, error: leaveError } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('employee_id', workerId)
                .order('created_at', { ascending: false });

            if (leaveError) {
                console.error('Error fetching leave requests:', leaveError);
            } else {
                log.info('All leave requests for worker (including pending):', allLeaveRequests?.length || 0);
                if (allLeaveRequests && allLeaveRequests.length > 0) {
                    allLeaveRequests.forEach(request => {
                    });
                } else {
                    log.info('No leave requests found for this worker at all');
                }
            }

            // Get worker details for payslip - check both tables
            let workerDetails = null;
            let workerType = 'foreign';

            // First try local_worker_details (use maybeSingle to avoid errors for foreign workers)
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('*')
                .eq('employee_id', workerId)
                .maybeSingle();

            // Check if worker is local (ignore 406 and PGRST116 errors - these mean worker doesn't exist in this table)
            if (!localError && localWorker) {
                workerDetails = localWorker;
                workerType = 'local';
            } else {
                // Try worker_details for foreign workers
                const { data: foreignWorker, error: foreignError } = await supabase
                    .from('worker_details')
                    .select('*')
                    .eq('employee_id', workerId)
                    .maybeSingle();

                if (foreignError && foreignError.code !== 'PGRST116') {
                    log.error('Error fetching worker details from both tables:', foreignError);
                    throw foreignError;
                }
                if (!foreignWorker) {
                    throw new Error(`Worker ${workerId} not found in either local_worker_details or worker_details`);
                }
                workerDetails = foreignWorker;
                workerType = 'foreign';
            }
            
            // Extract worker name from the appropriate field based on worker type
            const workerName = workerDetails.employee_name || workerDetails.name || 'Unknown Worker';

            log.info('Worker details:', workerDetails, 'Worker type:', workerType);

            // Get working days for the month
            let workingDaysData;
            const { data: workingDaysDataResult, error: workingDaysError } = await supabase
                .from('working_days_config')
                .select('working_days')
                .eq('year', year)
                .eq('month', month)
                .maybeSingle();

            if (workingDaysError || !workingDaysDataResult) {
                toast.error(`Working days configuration missing for ${year}-${String(month).padStart(2, '0')}`);
                console.error('Error fetching working days:', workingDaysError);
                // Use default of 22 working days if not configured
                workingDaysData = { working_days: 22 };
            } else {
                workingDaysData = workingDaysDataResult;
            }

            // If we have shifts, fetch related data separately
            if (workerShifts && workerShifts.length > 0) {
                const siteIds = [...new Set(workerShifts.map(shift => shift.site_id))];
                const shiftIds = workerShifts.map(shift => shift.id);

                // Fetch workers (we only need the name for the header)
                const { data: workers } = await supabase
                    .from('worker_details')
                    .select('employee_id, employee_name')
                    .eq('employee_id', workerId)
                    .single();

                // Fetch sites
                const { data: sites } = await supabase
                    .from('sites')
                    .select('id, site_name')
                    .in('id', siteIds);

                // Fetch breaks in batches to avoid URL length issues
                const allBreaks = [];
                const batchSize = 100; // Process 100 shift IDs at a time
                
                for (let i = 0; i < shiftIds.length; i += batchSize) {
                    const batch = shiftIds.slice(i, i + batchSize);
                    const { data: batchBreaks } = await supabase
                        .from('breaks')
                        .select('*')
                        .in('shift_id', batch.length > 0 ? batch : [''])
                        .order('break_start', { ascending: true });
                    
                    if (batchBreaks) {
                        allBreaks.push(...batchBreaks);
                    }
                }

                const breaksByShiftId = {};
                if (allBreaks) {
                    allBreaks.forEach(breakItem => {
                        if (!breaksByShiftId[breakItem.shift_id]) breaksByShiftId[breakItem.shift_id] = [];
                        breaksByShiftId[breakItem.shift_id].push(breakItem);
                    });
                }

                // Merge data into shifts
                workerShifts.forEach(shift => {
                    shift.workers = workers;
                    shift.sites = sites?.find(s => s.id === shift.site_id) || null;
                    shift.breaks = breaksByShiftId[shift.id] || [];
                });
            }

            // NOTE: We intentionally do NOT total hours here from raw DB shift fields.
            // The printed timesheet below recalculates daily totals (including PH credit rows and leave rules),
            // and we derive monthly totals from that same logic to keep Admin timesheet + payslip consistent.

        // Collect table rows for HTML generation
        let tableRowsHTML = '';
        const payslipPeriodLabel = formatPayslipPeriodRange(startDate, endDate);
        const payslipPayDateLabel = formatPayslipPayDate(salaryPaidDate);
        
        // Build the HTML string (for both printing and potential returnHTML)
        const fullHTMLStart = `
            <html>
                <head>
                    <title>Timesheet & Payslip - ${workerName} (${month}/${year})</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            padding: 20px;
                            background: white;
                            color: #333;
                            line-height: 1.4;
                            font-size: 14px;
                        }
                        /* Timesheet styles scoped so they do not leak onto the payslip page */
                        .timesheet-sheet .header {
                            text-align: center;
                            margin-bottom: 20px;
                            border-bottom: 3px solid #333;
                            padding-bottom: 15px;
                        }
                        .timesheet-sheet .company-name {
                            font-family: 'Calibri', 'Segoe UI', sans-serif;
                            font-weight: 700;
                            font-size: 24px;
                            margin: 0;
                            color: #b22222;
                        }
                        .timesheet-sheet .company-address {
                            font-family: 'Aptos Narrow', 'Segoe UI', sans-serif;
                            font-size: 12px;
                            margin: 8px 0 0 0;
                            color: #666;
                        }
                        .timesheet-sheet .worker-info {
                            margin: 15px 0;
                            padding: 15px;
                            background: #f8f9fa;
                            border: 2px solid #dee2e6;
                            border-radius: 8px;
                            font-size: 12px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }
                        .timesheet-sheet .signature-section {
                            margin-top: 30px;
                            display: flex;
                            justify-content: space-between;
                        }
                        .timesheet-sheet .signature-line {
                            border-bottom: 2px solid #333;
                            width: 180px;
                            height: 40px;
                            margin-top: 25px;
                        }
                        /* Payslip page styles (compact, one page) */
                        .payslip-sheet {
                            page-break-inside: avoid;
                            break-inside: avoid-page;
                        }
                        .payslip-sheet .header {
                            text-align: center;
                            margin: 0 0 6px 0;
                            padding: 0 0 4px 0;
                            border-bottom: none;
                        }
                        .payslip-sheet .company-name {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            font-size: 14px;
                            font-weight: 700;
                            margin: 0;
                            color: #111 !important;
                        }
                        .payslip-sheet .company-address {
                            margin: 2px 0 4px 0;
                            font-size: 10px;
                            color: #666;
                        }
                        .payslip-sheet .report-title {
                            font-size: 12px;
                            margin: 0 0 8px 0;
                            border-bottom: 1px solid #000;
                            padding-bottom: 4px;
                        }
                        .payslip-sheet .worker-info {
                            margin: 8px 0 10px !important;
                            padding: 10px 12px !important;
                            background: #fff9c4 !important;
                            border: none !important;
                            border-radius: 8px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                            font-size: 12px;
                        }
                        .payslip-sheet .worker-info > div {
                            margin-bottom: 0 !important;
                        }
                        .payslip-sheet .salary-box {
                            border: 1px solid #e0e0e0;
                            border-radius: 6px;
                            padding: 8px 10px;
                            background-color: #fff;
                            page-break-inside: avoid;
                            min-height: 64px;
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                            margin-bottom: 0;
                        }
                        .payslip-sheet .addition-box {
                            background-color: #f1f8e9;
                            border: 1px solid #c8e6c9;
                            border-left: 3px solid #2e7d32;
                        }
                        .payslip-sheet .deduction-box {
                            background-color: #ffebee;
                            border: 1px solid #ffcdd2;
                            border-left: 3px solid #c62828;
                        }
                        .payslip-sheet .employer-box {
                            background-color: #f5f5f5;
                            border: 1px solid #e0e0e0;
                            border-left: 3px solid #616161;
                        }
                        .payslip-sheet .amount-large {
                            font-size: 14px;
                            font-weight: 600;
                            margin: 0 0 4px 0;
                            color: #1b5e20;
                        }
                        .payslip-sheet .amount-label {
                            font-size: 11px;
                            color: #5f6368;
                            line-height: 1.3;
                            font-weight: 500;
                        }
                        .payslip-sheet .signature-section {
                            margin-top: 18px !important;
                            display: flex;
                            justify-content: space-between;
                            padding: 0 12px;
                            page-break-inside: avoid;
                        }
                        .payslip-sheet .signature-line {
                            border-bottom: 1px solid #333 !important;
                            width: 160px !important;
                            height: 18px !important;
                            margin: 0 auto 4px auto !important;
                        }
                        .payslip-sheet .signature-section p {
                            text-align: center;
                            margin: 0;
                            font-size: 12px;
                            color: #5d4037;
                        }
                        .timesheet-sheet .worker-info-grid {
                            display: grid;
                            grid-template-columns: 1fr 1fr;
                            gap: 15px;
                        }
                        .timesheet-sheet .worker-info div {
                            margin-bottom: 6px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin: 15px 0;
                            background: white;
                            border: 2px solid #dee2e6;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            font-size: 11px;
                        }
                        th, td {
                            border: 1px solid #dee2e6;
                            padding: 8px 10px;
                            text-align: center;
                        }
                        th {
                            background: #f8f9fa;
                            font-weight: 700;
                            font-size: 11px;
                            border-bottom: 2px solid #dee2e6;
                        }
                        .sunday-row {
                            background: #ffcccc !important;
                            color: #cc0000 !important;
                            font-weight: bold;
                        }
                        .holiday-row {
                            background: #ffcccc !important;
                            color: #cc0000 !important;
                            font-weight: bold;
                        }
                        .incentive-row {
                            background: #fff9c4 !important;
                        }
                        .totals {
                            margin-top: 20px;
                            padding: 15px;
                            background: #f8f9fa;
                            border: 2px solid #dee2e6;
                            border-radius: 8px;
                            font-size: 12px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }
                        .salary-breakdown {
                            margin: 20px 0;
                            border: 2px solid #dee2e6;
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }
                        .salary-header {
                            background: #f8f9fa;
                            padding: 12px;
                            font-weight: 700;
                            border-bottom: 2px solid #dee2e6;
                            font-size: 14px;
                        }
                        .salary-row {
                            display: flex;
                            padding: 10px 12px;
                            border-bottom: 1px solid #dee2e6;
                            font-size: 12px;
                        }
                        .salary-row:last-child {
                            border-bottom: none;
                            background: #f8f9fa;
                            font-weight: 700;
                            font-size: 14px;
                        }
                        .salary-label {
                            flex: 1;
                            font-weight: 600;
                        }
                        .salary-amount {
                            text-align: right;
                            min-width: 100px;
                            font-weight: 700;
                        }
                        .no-data {
                            color: #666;
                            font-style: italic;
                        }
                        .page-break {
                            page-break-before: always;
                        }
                        @media print {
                            @page {
                                size: A4 portrait;
                                margin: 10mm 10mm 10mm 10mm;
                            }
                            body {
                                background: white !important;
                                padding: 0 !important;
                                margin: 0 !important;
                                font-size: 10px !important;
                                line-height: 1.2;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                            .timesheet-sheet .header {
                                margin: 0 0 8px 0 !important;
                                padding: 0 !important;
                                page-break-after: avoid;
                            }
                            .timesheet-sheet .company-name {
                                font-size: 14px !important;
                                margin: 0;
                            }
                            .timesheet-sheet .company-address {
                                font-size: 10px !important;
                                margin: 2px 0 8px 0;
                            }
                            table {
                                font-size: 9px !important;
                                width: 100% !important;
                                margin: 5px 0 10px 0 !important;
                                page-break-inside: auto;
                            }
                            th, td {
                                padding: 4px 6px !important;
                                font-size: 9px !important;
                                line-height: 1.1;
                            }
                            .timesheet-sheet .worker-info {
                                margin: 5px 0 8px 0 !important;
                                padding: 8px !important;
                                font-size: 10px !important;
                                page-break-after: avoid;
                            }
                            .payslip-sheet .header {
                                border-bottom: none !important;
                                margin-bottom: 4px !important;
                                padding-bottom: 0 !important;
                            }
                            .payslip-sheet .company-name {
                                font-size: 14px !important;
                                color: #111 !important;
                            }
                            .payslip-sheet .worker-info {
                                margin: 6px 0 8px 0 !important;
                                padding: 8px 10px !important;
                                background: #fff9c4 !important;
                            }
                            .worker-info-grid {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 8px;
                                margin: 5px 0 8px 0 !important;
                                padding: 0 !important;
                                font-size: 10px !important;
                                page-break-after: avoid;
                            }
                            .totals {
                                margin: 8px 0 !important;
                                padding: 8px !important;
                                font-size: 10px !important;
                                page-break-inside: avoid;
                            }
                            .salary-breakdown {
                                margin: 8px 0 !important;
                                font-size: 10px !important;
                                page-break-inside: avoid;
                            }
                            .salary-header {
                                padding: 6px 8px !important;
                                font-size: 11px !important;
                            }
                            .salary-row {
                                padding: 4px 8px !important;
                                font-size: 10px !important;
                                page-break-inside: avoid;
                            }
                            .signature-section {
                                margin-top: 15px !important;
                                page-break-inside: avoid;
                            }
                            .signature-line {
                                width: 100px !important;
                                height: 20px !important;
                                margin-top: 10px !important;
                                border-bottom: 1px solid #000;
                            }
                            .page-break {
                                page-break-before: always;
                                margin: 0;
                                padding: 0;
                            }
                            .avoid-break {
                                page-break-inside: avoid;
                            }
                        }
                    </style>
                </head>
                <body>
                    <!-- PAGE 1: TIMESHEET -->
                    <div class="timesheet-sheet">
                    <div class="header">
                        <h1 class="company-name">AKK ENGINEERING PTE. LTD.</h1>
                        <p class="company-address">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
                        <h2 style="margin-top: 10px; color: #333; font-size: 14px;">Time Sheet Report</h2>
                    </div>

                    <div class="worker-info">
                        <strong>Worker Name:</strong> ${workerName}<br>
                        <strong>Worker ID:</strong> ${workerId}<br>
                        <strong>Month/Year:</strong> ${String(month).padStart(2, '0')}/${year}
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Entry</th>
                                <th>Exit</th>
                                <th>Break</th>
                                <th>OT</th>
                                <th>Incentive</th>
                                <th>Basic</th>
                                <th>Sun/PH</th>
                                <th>Total</th>
                                <th>Basic D</th>
                                <th>PH D</th>
                                <th>Leave Type</th>
                                <th>Site</th>
                            </tr>
                        </thead>
                        <tbody>

        `;

        // Group shifts by date and calculate daily totals
        const shiftsByDate = {};
        workerShifts.forEach(shift => {
            const dateKey = shift.work_date;
            if (!shiftsByDate[dateKey]) {
                shiftsByDate[dateKey] = [];
            }
            shiftsByDate[dateKey].push(shift);
        });

        // Reset monthly totals and accumulate them from the SAME daily logic used to build the table.
        monthlyBasicHours = 0;
        monthlySundayHours = 0;
        monthlyOtHours = 0;
        monthlyWorkedHours = 0; // actual worked only (exclude PH credit-only + leave)
        let monthlyPayableOtHours = 0;   // OT column total (min 2h per day)
        let monthlyIncentiveHours = 0;   // Incentive column total (OT beyond 2h per day)

        // Generate 31 rows for the standard print layout. Invalid calendar days
        // (e.g. 30/31 Feb) render as fully empty cells — no fake dates, no zeros.
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let day = 1; day <= 31; day++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isValidDayInMonth = day <= daysInMonth;

            if (!isValidDayInMonth) {
                tableRowsHTML += `
                <tr class="empty-day-row">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                </tr>`;
                continue;
            }

            const dayShifts = shiftsByDate[dateStr] || [];
            const isSundayDay = isSunday(dateStr);
            const isHolidayDay = isPublicHoliday(dateStr);

            if (!getWorkerPayStatus(workerDetails, dateStr).eligible) {
                tableRowsHTML += `
                <tr class="ney-row" style="background:#f8fafc;color:#64748b;">
                    <td>${day}/${String(month).padStart(2, '0')}/${year}</td>
                    <td></td>
                    <td></td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>0</td>
                    <td>${NEY_LABEL}</td>
                    <td></td>
                </tr>`;
                continue;
            }

        // Sum all shifts for this day - recalculate using new logic
        let totalBasicHours = 0;
        let totalSundayHours = 0;
        let totalOtHours = 0;
        let totalWorkedHours = 0;
        let shiftDetails = [];
        let leaveType = null;
        let hasLeaveShift = false;

        dayShifts.forEach(shift => {
            if (shift.has_left && !shift.leave_type) {
                // This is a work shift - calculate hours normally
                const recalc = calculateShiftHours(
                    shift.entry_time,
                    shift.leave_time,
                    shift.breaks || [],
                    shift.work_date
                );
                totalBasicHours += recalc.basicHours;
                totalSundayHours += recalc.sundayHours;
                totalOtHours += recalc.otHours;

                shiftDetails.push({
                    entry: shift.entry_time ? formatTime(shift.entry_time) : '',
                    leave: shift.leave_time ? formatTimeWithDate(shift.leave_time, shift.work_date) : '',
                    lunch: (shift.breaks && shift.breaks.length > 0)
                        ? shift.breaks
                            .map((b, i) => `B${i + 1} ${b.break_start ? formatTime(b.break_start) : ''}${b.break_end ? `-${formatTime(b.break_end)}` : ''}`)
                            .join(' | ')
                        : '',
                    site: shift.sites?.site_name || '',
                    basicHours: recalc.basicHours,
                    sundayHours: recalc.sundayHours,
                    otHours: recalc.otHours,
                    breakHours: recalc.breakHours,
                    isLeave: false
                });
            } else if (shift.leave_type) {
                // This is a leave shift - set leave type and hours
                hasLeaveShift = true;

                const isPaidLeave = isPaidLeaveTypeName(shift.leave_type);
                const isUnpaidLeave = isUnpaidLeaveTypeName(shift.leave_type);
                const isHalfDay = isHalfDayLeaveType(shift.leave_type);
                const sunOrPh = isSunday(dateStr) || isPublicHoliday(dateStr);

                if (isHalfDay) {
                    // Half-day leave - counts as 4 basic hours for paid, 0 for unpaid
                    if (isPaidLeave) {
                        leaveType = shift.leave_type.replace('_HALF_MORNING', ' (Half Day)').replace('_HALF_AFTERNOON', ' (Half Day)');
                        totalBasicHours = sunOrPh ? 0 : 4; // 0 hours for Sunday/holiday, 4 for weekday
                        totalWorkedHours = 0; // No worked hours for leave days
                        totalOtHours = 0;
                        totalSundayHours = 0;
                    } else if (isUnpaidLeave) {
                        leaveType = shift.leave_type.replace('_HALF_MORNING', ' (Half Day)').replace('_HALF_AFTERNOON', ' (Half Day)');
                        totalBasicHours = 0; // No entitlement for unpaid leave
                        totalWorkedHours = 0; // No worked hours for leave days
                        totalOtHours = 0;
                        totalSundayHours = 0;
                    }
                } else {
                    // Full-day leave
                    if (isPaidLeave) {
                        leaveType = shift.leave_type;
                        totalBasicHours = sunOrPh ? 0 : 8; // 0 hours for Sunday/holiday, 8 for weekday
                        totalWorkedHours = 0; // No worked hours for leave days
                        totalOtHours = 0;
                        totalSundayHours = 0;
                    } else if (isUnpaidLeave) {
                        leaveType = shift.leave_type;
                        totalBasicHours = 0; // No entitlement for unpaid leave
                        totalWorkedHours = 0; // No worked hours for leave days
                        totalOtHours = 0;
                        totalSundayHours = 0;
                    }
                }

                // Add leave shift to details for display
                shiftDetails.push({
                    entry: 'Leave',
                    leave: 'Leave',
                    lunch: '',
                    site: '',
                    basicHours: totalBasicHours,
                    sundayHours: totalSundayHours,
                    otHours: totalOtHours,
                    isLeave: true
                });
            }
        });

        // If there are both work and leave shifts on the same day, prioritize leave display
        if (hasLeaveShift && leaveType) {
            // Keep only leave shift details for display
            shiftDetails = shiftDetails.filter(s => s.isLeave);
            // For leave days, total worked hours should be 0 (no actual work done)
            totalWorkedHours = 0;
        } else {
            // Remove leave flag for work shifts
            shiftDetails = shiftDetails.map(s => ({ ...s, isLeave: undefined }));
            totalWorkedHours = totalBasicHours + totalSundayHours + totalOtHours;
        }

        // Weekday public holiday with no shifts: credit 8 basic hours.
        // Sunday PH is a rest day — MOM pay is the Monday in lieu, not an extra basic day.
        if (shouldCreditUnworkedPublicHoliday(dateStr) && dayShifts.length === 0) {
            totalBasicHours = 8;
            totalSundayHours = 0;
            totalOtHours = 0;
            // Do NOT count this in "Worked Hours" monthly total (this is a credit, not actual work)
            totalWorkedHours = 8;
            
            shiftDetails.push({
                entry: '',
                leave: '',
                lunch: '',
                site: '',
                basicHours: 8,
                sundayHours: 0,
                otHours: 0,
                breakHours: 0,
                isLeave: false
            });
        }

            const basicDays = totalBasicHours / 8;
            const sundayDays = totalSundayHours / 8;

            // Accumulate monthly totals from the daily totals we just computed.
            monthlyBasicHours += totalBasicHours;
            monthlySundayHours += totalSundayHours;
            monthlyOtHours += totalOtHours;
            // Worked Hours: exclude PH credit-only and any leave day totals
            const isPhCreditOnly = shouldCreditUnworkedPublicHoliday(dateStr) && dayShifts.length === 0;
            if (!hasLeaveShift && !isPhCreditOnly) {
                monthlyWorkedHours += (totalBasicHours + totalSundayHours + totalOtHours);
            }

            // Show multiple shifts in the time columns
            const entryTimes = shiftDetails.map(s => s.entry).filter(t => t).join(' | ');
            const leaveTimes = shiftDetails.map(s => s.leave).filter(t => t).join(' | ');
            const lunchTimes = shiftDetails.map(s => s.lunch).filter(t => t).join(' | ');
            const siteNames = [...new Set(shiftDetails.map(s => s.site))].filter(s => s).join(' | ');
            
            // Calculate total break hours for the day
            const totalBreakHours = shiftDetails.reduce((sum, s) => sum + (s.breakHours || 0), 0);

            // Split OT: first 2h → OT column, excess → Incentive column
            const otForColumn = Math.min(totalOtHours, 2);
            const incentiveHoursForDay = Math.max(totalOtHours - 2, 0);
            monthlyPayableOtHours += otForColumn;
            monthlyIncentiveHours += incentiveHoursForDay;

            const rowClass = incentiveHoursForDay > 0 ? 'incentive-row' : (isSundayDay || isHolidayDay ? 'sunday-row' : '');
            const rowHTML = `
                <tr class="${rowClass}">
                    <td>${day}/${String(month).padStart(2, '0')}/${year}</td>
                    <td>${entryTimes}</td>
                    <td>${leaveTimes}</td>
                    <td>${to4SF(totalBreakHours)}</td>
                    <td>${to4SF(otForColumn)}</td>
                    <td>${to4SF(incentiveHoursForDay)}</td>
                    <td>${to4SF(totalBasicHours)}</td>
                    <td>${to4SF(totalSundayHours)}</td>
                    <td>${to4SF(totalWorkedHours)}</td>
                    <td>${to4SF(basicDays)}</td>
                    <td>${to4SF(sundayDays)}</td>
                    <td>${leaveType || ''}</td>
                    <td>${siteNames}</td>
                </tr>
            `;
            
            tableRowsHTML += rowHTML;
        }

        // Finalize monthly totals for footer + payslip (totals from split OT/Incentive columns)
        totalSunPhHours = monthlySundayHours;
        totalBasicDays = monthlyBasicHours / 8;
        totalSunPhDays = monthlySundayHours / 8;

        // Calculate payslip values (stored value is MONTHLY salary, not daily)
        const monthlyBasicSalary = workerDetails.basic_salary_per_day; // This is actually monthly salary
        const dailyBasicSalary = monthlyBasicSalary / workingDaysData.working_days; // Convert to daily rate
        const basicPay = dailyBasicSalary * totalBasicDays;

        const otPay = monthlyPayableOtHours * workerDetails.ot_rate_per_hour;
        const incentiveAllowance = monthlyIncentiveHours * workerDetails.ot_rate_per_hour;

        const sunPhPay = totalSunPhDays * workerDetails.sun_ph_rate_per_day;
        
        const baseMonthlyAllowance = (parseFloat(workerDetails.monthly_allowance ?? 0) || 0);
        const eligibleWorkingDays = getEligibleWorkingDaysInMonth(
            workerDetails,
            year,
            month,
            workingDaysData.working_days
        );
        const allowanceDivisor = eligibleWorkingDays > 0 ? eligibleWorkingDays : workingDaysData.working_days;
        const monthlyAllowance = Math.min(
            baseMonthlyAllowance,
            Math.max(0, baseMonthlyAllowance * (totalBasicDays / allowanceDivisor))
        );

        const customAdditionsTotal = sumPayslipLineItems(additions, 'name', 'value');

        // Calculate CPF, SINDA, SDL for Local workers
        let cpfEmployeeDeduction = 0;
        let cpfEmployerContribution = 0;
        let sindaDeduction = 0;
        let sdlContribution = 0;

        if (workerType === 'local') {
            const { totalCpfBase: cpfWageBase } = computeCpfWageBase({
                basicPay,
                otPay,
                sunPhPay,
                allowances: monthlyAllowance + incentiveAllowance,
                bonus: bonusAmount,
            });
            const payslipMonthDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(
                workerDetails.birthday,
                endOfMonthSgt(payslipMonthDate)
            );

            // Keep stored % rates in sync for display
            await supabase
                .from('local_worker_details')
                .update({
                    cpf_employee_contribution: cpfEmployeeRate,
                    cpf_employer_contribution: cpfEmployerRate
                })
                .eq('employee_id', workerDetails.employee_id);

            // Calculate CPF Employee deduction (from employee's salary)
            cpfEmployeeDeduction = calculateCPFDeductions(
                cpfWageBase,
                cpfEmployeeRate, 
                0
            ).employeeDeduction;

            // Calculate CPF Employer contribution (not deducted)
            cpfEmployerContribution = calculateCPFDeductions(
                cpfWageBase,
                0, 
                cpfEmployerRate
            ).employerContribution;

            // Custom additions already computed above — they count as monthly wages for SINDA brackets
            // Calculate SINDA deduction from employee's total monthly wages (only if eligible)
            const sindaWageBase = sindaMonthlyWageBase({
                basicPay,
                otPay,
                sunPhPay,
                allowances: monthlyAllowance + incentiveAllowance,
                bonus: bonusAmount,
                customAdditions: customAdditionsTotal,
            });
            sindaDeduction = resolveSindaDeduction(sindaWageBase, workerDetails);

            // Calculate SDL contribution (0.25% of monthly wages, capped at $4,500)
            // Min $2, Max $11.25, added to employer cost
            sdlContribution = calculateSDL(cpfWageBase);
        }

        // Calculate total deductions (CPF Employee + SINDA + other deductions)
        const totalDeductions = deductions.reduce((sum, deduction) => {
            return sum + (parseFloat(deduction.amount) || 0);
        }, 0) + cpfEmployeeDeduction + sindaDeduction;

        // Calculate total additions (Basic + OT + Sunday/PH + Allowances + Bonus + Custom Additions)
        // SDL is an employer cost and is NOT added to total additions
        const totalAdditions = basicPay + otPay + sunPhPay + monthlyAllowance + incentiveAllowance + bonusAmount + customAdditionsTotal;

        // Net Pay = Total Additions - Total Deductions
        const netTotalPay = totalAdditions - totalDeductions;

        log.info('Local worker calculations:', {
            cpfEmployeeDeduction,
            cpfEmployerContribution,
            sindaDeduction,
            sdlContribution,
            totalAdditions,
            totalDeductions,
            netTotalPay
        });

        // Year-to-Date: prefer NET PAY from issued (passed-out) slips, else reconstruct history
        // that omitted custom additions. Never sum the current month from history — add displayed net.
        let accumulatedSalary = netTotalPay;
        let cpfEmployeeAccumulated = cpfEmployeeDeduction;
        let employerCPFAccumulated = cpfEmployerContribution;

        if (workerType === 'local') {
            try {
                const ytd = await computeLocalYtd(workerId, year, month, {
                    net: netTotalPay,
                    cpfEmp: cpfEmployeeDeduction,
                    cpfEr: cpfEmployerContribution,
                });
                accumulatedSalary = ytd.accumulatedSalary;
                cpfEmployeeAccumulated = ytd.cpfEmployeeAccumulated;
                employerCPFAccumulated = ytd.employerCPFAccumulated;

            } catch (error) {
                console.error('Error calculating accumulated totals:', error);
                accumulatedSalary = netTotalPay;
                cpfEmployeeAccumulated = cpfEmployeeDeduction;
                employerCPFAccumulated = cpfEmployerContribution;
            }
        }

        // Store payslip data in payslip_history for accumulation tracking
        if (printSalaryPaidDate) {
            const payslipHistoryData = {
                worker_id: workerId,
                worker_type: workerType,
                payslip_month: `${year}-${String(month).padStart(2, '0')}-01`,
                payslip_year: year,
                basic_pay: basicPay,
                ot_pay: otPay,
                sun_ph_pay: sunPhPay,
                monthly_allowance: monthlyAllowance,
                incentive_allowance: incentiveAllowance,
                bonus: bonusAmount,
                custom_additions: additions.filter(a => a.name && a.value),
                total_additions: totalAdditions,
                cpf_employee_deduction: cpfEmployeeDeduction,
                sinda_deduction: sindaDeduction,
                cpf_employer_contribution: cpfEmployerContribution,
                sdl_contribution: sdlContribution,
                total_deductions: cpfEmployeeDeduction + sindaDeduction, // Only deducted amounts
                net_pay: netTotalPay
            };

            try {
                await supabase.from('payslip_history').insert([payslipHistoryData]);
            } catch (error) {
                console.error('Failed to store payslip history:', error);
            }
        }

        const balanceBlock = buildBalanceSection({
            netPay: netTotalPay,
            lines: extras.balanceLines || [],
            amountPaid: extras.amountPaid ?? null,
        });

        const payrollSnapshot = {
            amount_payable: balanceBlock.payable,
            basic_pay: basicPay,
            ot_pay: otPay,
            sun_ph_pay: sunPhPay,
            monthly_allowance: monthlyAllowance,
            incentive_allowance: incentiveAllowance,
            bonus: bonusAmount,
            custom_additions: customAdditionsTotal,
            total_additions: totalAdditions,
            total_deductions: totalDeductions,
            net_pay: netTotalPay,
            cpf_employee_deduction: cpfEmployeeDeduction,
            sinda_deduction: sindaDeduction,
            cpf_employer_contribution: cpfEmployerContribution,
            sdl_contribution: sdlContribution,
        };

        // Collect remaining HTML parts for returnHTML mode  
        let remainingHTML = '';
        
        // Build the remaining HTML (everything after table rows)
        remainingHTML = `
                        </tbody>
                    </table>

                    <div class="totals" style="display: grid; grid-template-columns: repeat(${monthlyIncentiveHours > 0 ? 4 : 3}, 1fr); gap: 5px; margin-top: 10px;">
                        <div><strong>Basic Hours:</strong> ${to4SF(monthlyBasicHours)}</div>
                        <div><strong>OT Hours:</strong> ${to4SF(monthlyPayableOtHours)}</div>
                        <div><strong>Worked Hours:</strong> ${to4SF(monthlyWorkedHours)}</div>
                        <div><strong>Sun/PH Hours:</strong> ${to4SF(totalSunPhHours)}</div>
                        <div><strong>Basic Days:</strong> ${to4SF(totalBasicDays)}</div>
                        <div><strong>Sun/PH Days:</strong> ${to4SF(totalSunPhDays)}</div>
                        ${monthlyIncentiveHours > 0 ? `<div><strong>Incentive Hours:</strong> ${to4SF(monthlyIncentiveHours)}</div>` : ''}
                    </div>

                        ${workerType === 'local' ? `
                        <!-- Removed duplicate accumulated totals section as it's now in the payslip -->
                        ` : ''}
                    </div>

                    <!-- PAGE BREAK -->
                    <div style="page-break-before: always;"></div>

                    <!-- PAGE 2: PAYSLIP -->
                    <div class="payslip-sheet">
                    <div class="header">
                        <h1 class="company-name">AKK ENGINEERING PTE. LTD.</h1>
                        <p class="company-address">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
                        <h2 class="report-title">Salary Slip</h2>
                    </div>

                    <div class="worker-info" style="margin: 8px 0 10px; background: #fff9c4; border-radius: 8px; padding: 10px 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px;">
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">NRIC/FIN:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${workerDetails.nric_fin || 'N/A'}</span>
                            </div>
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">Employee ID:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${workerDetails.employee_id || 'N/A'}</span>
                            </div>
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">Name:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${workerDetails.employee_name || 'N/A'}</span>
                            </div>
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">Period:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${payslipPeriodLabel}</span>
                            </div>
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">Bank:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${workerDetails.bank_account_number || 'Cash'}</span>
                            </div>
                            <div style="display: flex; align-items: center; min-height: 24px;">
                                <span style="color: #5f6368; min-width: 82px; font-size: 12px;">Pay Date:</span>
                                <span style="font-weight: 500; font-size: 12.5px;">${payslipPayDateLabel}</span>
                            </div>
                        </div>
                    </div>

                        <!-- Salary Details in 2x2 Grid -->
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; page-break-inside: avoid;">
                            <!-- Column 1: Basic Pay, OT Pay -->
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${basicPay.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">Basic Pay (${to4SF(totalBasicDays)}d)</div>
                            </div>
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${otPay.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">OT Pay (${to4SF(monthlyPayableOtHours)}h)</div>
                            </div>
                            
                            <!-- Column 2: Sun/PH, Monthly Allowance -->
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${sunPhPay.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">Sun/PH (${to4SF(totalSunPhDays)}d)</div>
                            </div>
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${monthlyAllowance.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">Monthly Allowance</div>
                            </div>
                            
                            <!-- Column 3: Incentive -->
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${incentiveAllowance.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">Incentive</div>
                            </div>
                            
                            ${additions && additions.filter(a => a.name && a.value && parseFloat(a.value) > 0).length > 0 ?
                                additions.filter(a => a.name && a.value && parseFloat(a.value) > 0).map(addition => `
                                <div class="salary-box addition-box" style="padding: 6px 8px; background-color: #f1f8e9; border-left: 3px solid #4caf50;">
                                    <div class="amount-large" style="font-size: 14px;">$${parseFloat(addition.value).toFixed(2)}</div>
                                    <div class="amount-label" style="font-size: 11px;">${addition.name}</div>
                                </div>
                                `).join('') : ''
                            }
                            
                            <!-- Column 4: Bonus, Custom Deductions, CPF & SDL for locals -->
                            <div class="salary-box addition-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${bonusAmount.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">Bonus</div>
                            </div>
                            ${deductions && deductions.filter(d => d.type && d.amount && parseFloat(d.amount) > 0).length > 0 ? 
                                deductions.filter(d => d.type && d.amount && parseFloat(d.amount) > 0).map(deduction => `
                                <div class="salary-box deduction-box" style="padding: 6px 8px;">
                                    <div class="amount-large" style="font-size: 14px;">-$${Math.abs(parseFloat(deduction.amount)).toFixed(2)}</div>
                                    <div class="amount-label" style="font-size: 11px;">${deduction.type}</div>
                                </div>
                                `).join('') : `
                                <div class="salary-box deduction-box" style="padding: 6px 8px;">
                                    <div class="amount-large" style="font-size: 14px;">$0.00</div>
                                    <div class="amount-label" style="font-size: 11px;">No Deductions</div>
                                </div>
                                `
                            }
                            ${workerType === 'local' ? `
                            <div class="salary-box deduction-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">-$${Math.abs(cpfEmployeeDeduction).toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">CPF Employee</div>
                            </div>
                            <div class="salary-box deduction-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">-$${Math.abs(sindaDeduction).toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">SINDA</div>
                            </div>
                            <div class="salary-box employer-box" style="padding: 6px 8px;">
                                <div class="amount-large" style="font-size: 14px;">$${cpfEmployerContribution.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">CPF Employer (Not deducted, based on employee salary)</div>
                            </div>
                            <div class="salary-box employer-box" style="padding: 6px 8px; background-color: #f5f5f5; border-color: #bdbdbd; color: #555;">
                                <div class="amount-large" style="font-size: 14px;">$${sdlContribution.toFixed(2)}</div>
                                <div class="amount-label" style="font-size: 11px;">SDL (Employer cost, not added to total)</div>
                            </div>
                            ` : ''}
                        </div>

                        <!-- Totals Row -->
                        <div style="display: flex; gap: 8px; margin: 10px 0;">
                            <div class="salary-box" style="flex: 1; display: flex; justify-content: space-between; align-items: center; background-color: #e8f5e9; border: 1px solid #81c784; padding: 8px 12px;">
                                <span class="amount-label" style="font-weight: 600; font-size: 12px;">TOTAL ADDITIONS</span>
                                <span class="amount-large" style="color: #2e7d32; font-size: 14px; font-weight: 600;">$${totalAdditions.toFixed(2)}</span>
                            </div>
                            <div class="salary-box" style="flex: 1; display: flex; justify-content: space-between; align-items: center; background-color: #ffebee; border: 1px solid #ef9a9a; padding: 8px 12px;">
                                <span class="amount-label" style="font-weight: 600; font-size: 12px;">TOTAL DEDUCTIONS</span>
                                <span class="amount-large" style="color: #c62828; font-size: 14px; font-weight: 600;">-$${Math.abs(totalDeductions).toFixed(2)}</span>
                            </div>
                        </div>

                        <!-- Net Pay -->
                        <div class="salary-box" style="background-color: #e3f2fd; text-align: center; padding: 12px; border: 2px solid #1976d2; margin: 0 0 12px 0;">
                            <div class="amount-label" style="font-size: 14px; color: #0d47a1; font-weight: 600; letter-spacing: 0.5px;">NET PAY</div>
                            <div class="amount-large" style="font-size: 22px; font-weight: 700; color: #0d47a1; margin: 5px 0 0 0; letter-spacing: 0.5px;">$${netTotalPay.toFixed(2)}</div>
                        </div>
${balanceBlock.html}

                        ${workerType === 'local' ? `
                        <!-- Year-to-Date Accumulated Section -->
                        <div style="margin: 12px 0 10px 0; page-break-inside: avoid; padding: 12px; background: #f5f5f5; border-radius: 8px; border: 1px solid #e0e0e0;">
                            <h3 style="font-size: 14px; font-weight: 600; color: #424242; border-bottom: 1px solid #bdbdbd; padding-bottom: 8px; margin: 0 0 12px 0; font-family: 'Poppins', sans-serif;">Year-to-Date Accumulated (${year})</h3>
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                                <div class="salary-box" style="background: #f5f5f5; border: 1px solid #e0e0e0;">
                                    <div class="amount-large" style="color: #212121;">$${accumulatedSalary ? accumulatedSalary.toFixed(2) : '0.00'}</div>
                                    <div class="amount-label">Total Accumulated Net Pay</div>
                                </div>
                                <div class="salary-box" style="background: #f5f5f5; border: 1px solid #e0e0e0;">
                                    <div class="amount-large" style="color: #c62828;">$${cpfEmployeeAccumulated ? cpfEmployeeAccumulated.toFixed(2) : '0.00'}</div>
                                    <div class="amount-label">CPF Employee</div>
                                </div>
                                <div class="salary-box" style="background: #f5f5f5; border: 1px solid #e0e0e0;">
                                    <div class="amount-large" style="color: #2e7d32;">$${employerCPFAccumulated ? employerCPFAccumulated.toFixed(2) : '0.00'}</div>
                                    <div class="amount-label">CPF Employer</div>
                                </div>
                            </div>
                            <p style="font-size: 10px; color: #757575; margin: 12px 0 0 0; font-style: italic; text-align: center; padding-top: 8px; border-top: 1px dashed #bdbdbd;">
                                * Accumulated values reset every January. Values shown are sum from January to ${month < 10 ? '0' + month : month}/${year} (including current month).
                            </p>
                        </div>
                        ` : ''}

                        <div class="signature-section">
                            <div>
                                <div class="signature-line"></div>
                                <p><strong>Employee Signature</strong></p>
                            </div>
                            <div>
                                <div class="signature-line"></div>
                                <p><strong>Employer Signature</strong></p>
                            </div>
                        </div>
                    </div>
                </body>
            </html>
        `;
        
        if (returnHTML) {
            // Combine all HTML parts: start (<tbody>) + table rows + remaining (</tbody> + rest)
            const completeHTML = fullHTMLStart + tableRowsHTML + remainingHTML;
            
            // Split HTML at page break to separate timesheet and payslip
            const pageBreakMarker = '<!-- PAGE BREAK -->';
            const pageBreakIndex = completeHTML.indexOf(pageBreakMarker);
            
            let timesheetHTML = completeHTML;
            let payslipHTML = completeHTML;
            
            if (pageBreakIndex !== -1) {
                // Extract timesheet part (everything before page break, including table closing tags)
                timesheetHTML = completeHTML.substring(0, pageBreakIndex).trim();
                // Ensure timesheet has proper closing tags
                if (!timesheetHTML.includes('</body>')) {
                    // Find the last </table> or </div> to insert closing tags after
                    const lastTableIndex = timesheetHTML.lastIndexOf('</table>');
                    const lastDivIndex = timesheetHTML.lastIndexOf('</div>');
                    const insertIndex = Math.max(lastTableIndex, lastDivIndex);
                    if (insertIndex !== -1) {
                        const beforeClose = timesheetHTML.substring(0, insertIndex + (lastTableIndex > lastDivIndex ? 8 : 6));
                        const afterClose = timesheetHTML.substring(insertIndex + (lastTableIndex > lastDivIndex ? 8 : 6));
                        timesheetHTML = beforeClose + '\n</body>\n</html>' + afterClose;
                    } else {
                        timesheetHTML += '\n</body>\n</html>';
                    }
                }
                
                payslipHTML = normalizePayslipHtmlForPrint(completeHTML, { standalone: true });
            }
            
            return { payslipHTML, timesheetHTML, payroll: payrollSnapshot, completeHTML };
        }
        
        // For normal printing, write everything in one go to maintain original format
        // Combine all HTML parts into one complete document
        const completeHTML = fullHTMLStart + tableRowsHTML + remainingHTML;
        await printOrShareHtmlDocument(completeHTML, {
            title: 'Print timesheet and payslip',
            fileName: `Timesheet_Payslip_${workerId}_${monthYear}.pdf`,
            printDelayMs: 350,
        });
        } catch (error) {
            console.error('Error generating print:', error);
            if (returnHTML) {
                throw error; // Re-throw if returning HTML
            }
            alert('Error generating print: ' + error.message);
        }
    };

    // REMOVED: Generate Local Payslips function - using manual shift creation instead
    const _generateLocalPayslips_removed = async (data) => {
        const { worker_id, period_type, selected_month, selected_year } = data;

        // Verify worker is local
        const { data: localWorker, error: workerError } = await supabase
            .from('local_worker_details')
            .select('*')
            .eq('employee_id', worker_id)
            .single();

        if (workerError || !localWorker) {
            throw new Error(`Local worker with ID ${worker_id} not found`);
        }

        // Get a default site (or first available site)
        const { data: sitesData } = await supabase
            .from('sites')
            .select('id')
            .limit(1);
        
        const defaultSiteId = sitesData && sitesData.length > 0 ? sitesData[0].id : null;
        
        if (!defaultSiteId) {
            throw new Error('No site found. Please create at least one site before generating payslips.');
        }

        // Determine months to process
        const monthsToProcess = [];
        if (period_type === 'month') {
            const [year, month] = selected_month.split('-');
            monthsToProcess.push({ year: parseInt(year), month: parseInt(month) });
        } else {
            // Year: process all 12 months
            const year = parseInt(selected_year);
            for (let month = 1; month <= 12; month++) {
                monthsToProcess.push({ year, month });
            }
        }

        // Process each month
        for (const { year, month } of monthsToProcess) {
            // Get working days for the month
            const { data: workingDaysData, error: workingDaysError } = await supabase
                .from('working_days_config')
                .select('working_days')
                .eq('year', year)
                .eq('month', month)
                .maybeSingle();

            if (workingDaysError || !workingDaysData) {
                toast.error(`Working days configuration missing for ${year}-${String(month).padStart(2, '0')}`);
                console.warn(`Working days not configured for ${year}-${month}, using default 22`);
            }
            const workingDays = workingDaysData?.working_days || 22;

            // Get approved leaves for this month
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = ymdEndOfMonth(year, month);
            
            const { data: approvedLeaves } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('employee_id', worker_id)
                .eq('status', 'approved')
                .lte('from_date', endDate)
                .gte('to_date', startDate);

            // Generate list of working days (excluding Sundays and public holidays)
            const workingDaysList = [];
            const totalDaysInMonth = new Date(year, month, 0).getDate();
            
            for (let day = 1; day <= totalDaysInMonth; day++) {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                // Skip Sundays and public holidays (YYYY-MM-DD via timeUtils — not local getDay)
                if (isSunday(dateStr) || isPublicHoliday(dateStr)) {
                    continue;
                }

                // Check if this day is covered by approved leave
                let isOnLeave = false;
                let leaveType = null;
                if (approvedLeaves && approvedLeaves.length > 0) {
                    for (const leave of approvedLeaves) {
                        const from = toSingaporeDateStr(leave.from_date);
                        const to = toSingaporeDateStr(leave.to_date);
                        if (from && to && dateStr >= from && dateStr <= to) {
                            isOnLeave = true;
                            leaveType = leave.leave_type;
                            break;
                        }
                    }
                }

                workingDaysList.push({
                    date: dateStr,
                    isOnLeave,
                    leaveType
                });

                // Stop when we have enough working days
                if (workingDaysList.length >= workingDays) {
                    break;
                }
            }

            // Calculate payslip (no shifts created - just calculate based on working days)
            const totalBasicDays = workingDaysList.length;
            const monthlyBasicSalary = parseFloat(localWorker.basic_salary_per_day || 0);
            const dailyBasicSalary = monthlyBasicSalary / workingDays;
            const basicPay = dailyBasicSalary * totalBasicDays;
            const baseMonthlyAllowance = parseFloat(localWorker.monthly_allowance || 0) || 0;
            const monthlyAllowance = Math.min(
                baseMonthlyAllowance,
                Math.max(0, baseMonthlyAllowance * (totalBasicDays / workingDays))
            );
            const bonus = 0;
            const otPay = 0;
            const sunPhPay = 0;

            // Calculate CPF, SINDA, SDL
            const payslipMonthDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(
                localWorker.birthday,
                endOfMonthSgt(payslipMonthDate)
            );
            const { totalCpfBase: cpfWageBase } = computeCpfWageBase({
                basicPay,
                otPay,
                sunPhPay,
                allowances: monthlyAllowance,
                bonus,
            });
            const cpfEmployeeDeduction = cpfWageBase * (cpfEmployeeRate / 100);
            const cpfEmployerContribution = cpfWageBase * (cpfEmployerRate / 100);
            const sindaWageBase = basicPay + otPay + sunPhPay + monthlyAllowance + bonus;
            const sindaDeduction = resolveSindaDeduction(sindaWageBase, localWorker);
            const sdlContribution = calculateSDL(cpfWageBase);

            const totalAdditions = basicPay + monthlyAllowance;
            const totalDeductions = cpfEmployeeDeduction + sindaDeduction;
            const netPay = totalAdditions - totalDeductions;

            // Get accumulated values from previous payslips
            // Get all payslips from current year before this month (accumulation resets each year)
            const { data: previousPayslips } = await supabase
                .from('local_worker_payslip_history')
                .select('net_pay, cpf_employee, cpf_employer, sinda_contribution, period_year, period_month')
                .eq('employee_id', worker_id)
                .eq('period_year', year) // Only get payslips from current year
                .order('period_month', { ascending: true });

            // Filter in JavaScript to get payslips from current year before current month (accumulation resets each year)
            const filteredPreviousPayslips = (previousPayslips || []).filter(p => {
                return p.period_year === year && p.period_month < month;
            });

            let accumulatedNetPay = 0;
            let accumulatedCPFEmployee = 0;
            let accumulatedCPFEmployer = 0;
            let accumulatedSINDA = 0;

            // Sum up all previous months' values
            if (filteredPreviousPayslips) {
                filteredPreviousPayslips.forEach(p => {
                    accumulatedNetPay += parseFloat(p.net_pay || 0);
                    accumulatedCPFEmployee += parseFloat(p.cpf_employee || 0);
                    accumulatedCPFEmployer += parseFloat(p.cpf_employer || 0);
                    accumulatedSINDA += parseFloat(p.sinda_contribution || 0);
                });
            }
            
            // Add current month's values to accumulated totals (Year-to-Date includes current month)
            accumulatedNetPay += netPay;
            accumulatedCPFEmployee += cpfEmployeeDeduction;
            accumulatedCPFEmployer += cpfEmployerContribution;
            accumulatedSINDA += sindaDeduction;

            // Check if payslip already exists
            const { data: existingPayslip } = await supabase
                .from('local_worker_payslip_history')
                .select('id')
                .eq('employee_id', worker_id)
                .eq('period_year', year)
                .eq('period_month', month)
                .maybeSingle();

            if (existingPayslip) {
                // Update existing payslip
                const { error: updateError } = await supabase
                    .from('local_worker_payslip_history')
                    .update({
                        basic_salary: basicPay,
                        ot_pay: otPay,
                        sunday_pay: sunPhPay,
                        monthly_allowance: monthlyAllowance,
                        total_additions: totalAdditions,
                        cpf_employee: cpfEmployeeDeduction,
                        cpf_employer: cpfEmployerContribution,
                        sinda_contribution: sindaDeduction,
                        sdl_amount: sdlContribution,
                        total_deductions: totalDeductions,
                        net_pay: netPay,
                        worked_days: totalBasicDays,
                        total_worked_hours: totalBasicDays * 8,
                        total_ot_hours: 0,
                        total_sunday_hours: 0
                    })
                    .eq('id', existingPayslip.id);

                if (updateError) {
                    throw new Error(`Failed to update payslip: ${updateError.message}`);
                }
            } else {
                // Create new payslip
                const { error: payslipError } = await supabase
                    .from('local_worker_payslip_history')
                    .insert({
                        employee_id: worker_id,
                        employee_name: localWorker.employee_name,
                        designation: localWorker.designation,
                        period_year: year,
                        period_month: month,
                        basic_salary: basicPay,
                        ot_pay: otPay,
                        sunday_pay: sunPhPay,
                        monthly_allowance: monthlyAllowance,
                        total_additions: totalAdditions,
                        cpf_employee: cpfEmployeeDeduction,
                        cpf_employer: cpfEmployerContribution,
                        sinda_contribution: sindaDeduction,
                        sdl_amount: sdlContribution,
                        total_deductions: totalDeductions,
                        net_pay: netPay,
                        worked_days: totalBasicDays,
                        total_worked_hours: totalBasicDays * 8,
                        total_ot_hours: 0,
                        total_sunday_hours: 0
                    });

                if (payslipError) {
                    throw new Error(`Failed to create payslip: ${payslipError.message}`);
                }
            }

            // Update accumulated values in worker details
            const newAccumulatedNetPay = accumulatedNetPay + netPay;
            const newAccumulatedCPFEmployee = accumulatedCPFEmployee + cpfEmployeeDeduction;
            const newAccumulatedCPFEmployer = accumulatedCPFEmployer + cpfEmployerContribution;
            const newAccumulatedSINDA = accumulatedSINDA + sindaDeduction;

            await supabase
                .from('local_worker_details')
                .update({
                    accumulated_net_pay: newAccumulatedNetPay,
                    last_accumulation_date: getTodaySingapore()
                })
                .eq('employee_id', worker_id);

            // Print the payslip immediately after creation
            try {
                // Get the saved payslip data
                const { data: savedPayslip } = await supabase
                    .from('local_worker_payslip_history')
                    .select('*')
                    .eq('employee_id', worker_id)
                    .eq('period_year', year)
                    .eq('period_month', month)
                    .maybeSingle();

                if (savedPayslip) {
                    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
                    await printTimesheetAndPayslip(
                        worker_id,
                        monthYear,
                        [],
                        savedPayslip.salary_paid_date || '',
                        savedPayslip.bonus || 0,
                        savedPayslip.additions_json || [],
                        false
                    );
                }
            } catch (printError) {
                console.error(`Error printing payslip for ${year}-${month}:`, printError);
                // Don't fail the entire operation if printing fails
            }
        }

        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['shifts'] });
        queryClient.invalidateQueries({ queryKey: ['local-workers'] });
    };

    const printPayslip = async (workerId, month, year, salaryPaidDate, deductions = [], bonus = '', additions = []) => {
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        // Deprecated legacy print path: redirect to canonical payroll renderer.
        return printTimesheetAndPayslip(workerId, monthYear, deductions, salaryPaidDate, bonus, additions, false);
        const { startDate, endDate } = monthYearToDateRange(monthYear);

        let workerDetails = null;
        const { data: localWorker } = await supabase
            .from('local_worker_details')
            .select('*')
            .eq('employee_id', workerId)
            .maybeSingle();
        if (localWorker) {
            workerDetails = localWorker;
        } else {
            const { data: foreignWorker, error: workerError } = await supabase
                .from('worker_details')
                .select('*')
                .eq('employee_id', workerId)
                .single();
            if (workerError) throw workerError;
            workerDetails = foreignWorker;
        }

        // Get working days for the month
        const { data: workingDaysData, error: workingDaysError } = await supabase
            .from('working_days_config')
            .select('working_days')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();

        if (workingDaysError || !workingDaysData) {
            toast.error(`Working days configuration missing for ${year}-${String(month).padStart(2, '0')}`);
            throw (workingDaysError || new Error('Working days configuration not found'));
        }

        const workingDays = workingDaysData.working_days;

        const { data: workerShifts, error: shiftsError } = await supabase
            .from('shifts')
            .select('*')
            .eq('worker_id', workerId)
            .gte('work_date', startDate)
            .lte('work_date', endDate)
            .order('work_date', { ascending: true });

        if (shiftsError) throw shiftsError;

        const payrollShifts = filterShiftsForPayroll(workerShifts || []).filter((s) =>
            isWorkerPayEligibleOnDate(workerDetails, s.work_date)
        );

        const shiftsByDate = {};
        payrollShifts.forEach((s) => {
            if (!shiftsByDate[s.work_date]) shiftsByDate[s.work_date] = [];
            shiftsByDate[s.work_date].push(s);
        });

        const daysInMonth = new Date(year, month, 0).getDate();
        let totalBasicHours = 0;
        let totalOtHours = 0;
        let totalSunPhHours = 0;
        const otHoursByDate = {};

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (!isWorkerPayEligibleOnDate(workerDetails, dateStr)) continue;

            const dayShifts = shiftsByDate[dateStr] || [];
            let dayBasic = 0;
            let daySunPh = 0;
            let dayOt = 0;

            dayShifts.forEach((shift) => {
                if (shift.has_left && !shift.leave_type) {
                    dayBasic += shift.worked_hours || 0;
                    daySunPh += shift.sunday_hours || 0;
                    dayOt += shift.ot_hours || 0;
                }
            });

            if (shouldCreditUnworkedPublicHoliday(dateStr) && dayShifts.length === 0) {
                dayBasic = 8;
            }

            totalBasicHours += dayBasic;
            totalSunPhHours += daySunPh;
            if (dayOt > 0) otHoursByDate[dateStr] = (otHoursByDate[dateStr] || 0) + dayOt;
        }

        const basicDays = totalBasicHours / 8;
        const sunPhDays = totalSunPhHours / 8;

        let monthlyPayableOtHours = 0;
        let monthlyIncentiveHours = 0;
        Object.values(otHoursByDate).forEach(otHoursForDay => {
            monthlyPayableOtHours += Math.min(otHoursForDay, 2);
            monthlyIncentiveHours += Math.max(otHoursForDay - 2, 0);
        });

        const payableOtHours = monthlyPayableOtHours;
        const incentiveAllowance = monthlyIncentiveHours * workerDetails.ot_rate_per_hour;

        // Calculate salary components
        const basicDailyPay = workerDetails.basic_salary_per_day;
        const basicPay = basicDailyPay * basicDays;
        const otPay = payableOtHours * workerDetails.ot_rate_per_hour;
        const sunPhPay = sunPhDays * workerDetails.sun_ph_rate_per_day;
        const baseMonthlyAllowanceForDisplay = (parseFloat(workerDetails.monthly_allowance ?? 0) || 0);
        const eligibleWorkingDays = getEligibleWorkingDaysInMonth(workerDetails, year, month, workingDays);
        const allowanceDivisor = eligibleWorkingDays > 0 ? eligibleWorkingDays : workingDays;
        const allowance1 = Math.min(
            baseMonthlyAllowanceForDisplay,
            Math.max(0, baseMonthlyAllowanceForDisplay * (basicDays / allowanceDivisor))
        );
        const allowance2 = incentiveAllowance;
        
        // Calculate custom additions from the passed additions parameter
        const customAdditions = additions && additions.filter(a => a.name && a.value && parseFloat(a.value) > 0) || [];
        const totalCustomAdditions = customAdditions.reduce((sum, a) => sum + parseFloat(a.value || 0), 0);
        
        // Calculate bonus from passed parameter (if any)
        const bonusAmount = parseFloat(bonus) || 0;
        
        const totalAdditions = basicPay + otPay + sunPhPay + allowance1 + allowance2 + bonusAmount + totalCustomAdditions;

        // Calculate deductions total - use passed deductions or fallback to payslipDeductions
        const deductionsToUse = deductions.length > 0 ? deductions : payslipDeductions;
        const customDeductions = deductionsToUse.reduce((sum, deduction) => {
            return sum + (parseFloat(deduction.amount) || 0);
        }, 0);

        // Calculate CPF, SINDA, and SDL for local workers
        let cpfEmployee = 0;
        let cpfEmployer = 0;
        let sinda = 0;
        let sdl = 0;
        let workerType = 'foreign'; // Default to foreign

        // Check if worker is local by looking up in local_worker_details
        try {
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('birthday, sinda_eligible')
                .eq('employee_id', workerId)
                .maybeSingle();
            
            // Only process if worker exists and no error (ignore 406 and PGRST116 errors)
            if (!localError && localWorker?.birthday) {
                workerType = 'local';
                
                // Calculate CPF for local workers
                const payslipMonthDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(
                    localWorker.birthday,
                    endOfMonthSgt(payslipMonthDate)
                );
                const { totalCpfBase: cpfWageBase } = computeCpfWageBase({
                    basicPay,
                    otPay,
                    sunPhPay,
                    allowances: allowance1 + allowance2,
                });
                cpfEmployee = calculateCPFDeductions(cpfWageBase, cpfEmployeeRate, 0).employeeDeduction;
                cpfEmployer = calculateCPFDeductions(cpfWageBase, 0, cpfEmployerRate).employerContribution;
                
                // Calculate SINDA using fixed brackets based on total monthly wages
                const sindaWageBase = basicPay + otPay + sunPhPay + allowance1 + allowance2;
                sinda = resolveSindaDeduction(sindaWageBase, localWorker);
                
                // Calculate SDL (0.25% of monthly wages, capped at $4,500, min $2 if wages < $800, max $11.25)
                const monthlyWages = basicPay + otPay + sunPhPay + allowance1 + allowance2;
                sdl = calculateSDL(monthlyWages);
            }
        } catch (error) {
            // Worker is foreign, no CPF/SINDA/SDL - silently continue
            // Error already handled by maybeSingle() and error check above
        }

        const totalDeductions = customDeductions + cpfEmployee + sinda;
        const netTotalPay = totalAdditions - totalDeductions;

        // Calculate start and end dates for the period
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0); // Last day of the month
        
        // Generate HTML for the payslip with all required variables in scope
        const payslipHTML = (`
            <style>
                .net-pay-amount {
                    font-size: 24px;
                    font-weight: 900;
                    color: #b22222;
                }
                .signature-section {
                    margin-top: 40px;
                    display: flex;
                    justify-content: space-between;
                    text-align: center;
                }
                .signature-line {
                    border-bottom: 2px solid #333;
                    width: 180px;
                    height: 40px;
                    margin-top: 25px;
                }
                .signature-label {
                    font-weight: 700;
                    font-size: 12px;
                    margin-top: 8px;
                }
                        @media print {
                            body {
                                background: white !important;
                                padding: 15px !important;
                                margin: 0 !important;
                                font-size: 11px !important;
                            }
                            .header {
                                margin-bottom: 15px !important;
                                padding-bottom: 12px !important;
                            }
                            .company-name {
                                font-size: 18px !important;
                            }
                            .company-address {
                                font-size: 10px !important;
                            }
                            .top-section {
                                margin: 15px 0 !important;
                            }
                            .employee-details {
                                padding: 12px !important;
                            }
                            .section-title {
                                font-size: 12px !important;
                                margin-bottom: 10px !important;
                            }
                            .detail-row {
                                margin-bottom: 6px !important;
                                font-size: 10px !important;
                            }
                            .bottom-section {
                                margin: 25px 0 !important;
                            }
                            .earnings-section, .deductions-section {
                                padding: 12px !important;
                            }
                            .earnings-row, .deductions-row {
                                padding: 5px 0 !important;
                                font-size: 10px !important;
                            }
                            .total-section {
                                margin: 25px 0 !important;
                                padding: 15px !important;
                            }
                            .total-label {
                                font-size: 14px !important;
                            }
                            .total-amount {
                                font-size: 20px !important;
                            }
                            .signature-section {
                                margin-top: 35px !important;
                            }
                            .signature-line {
                                width: 160px !important;
                                height: 35px !important;
                                margin-top: 20px !important;
                            }
                            .signature-label {
                                font-size: 11px !important;
                            }
                            @page {
                                size: A4;
                                margin: 0.5in;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1 class="company-name">AKK ENGINEERING PTE. LTD.</h1>
                        <p class="company-address">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
                        <h2 style="margin-top: 10px; color: #333; font-size: 16px;">Salary Slip</h2>
                    </div>

                    <div class="top-section">
                        <div class="employee-details">
                            <div class="section-title">Employee Details</div>
                            <div class="detail-row">
                                <span class="detail-label">Employee Name:</span>
                                <span class="detail-value">${workerDetails.employee_name}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Employee ID:</span>
                                <span class="detail-value">${workerDetails.employee_id}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">NRIC/FIN:</span>
                                <span class="detail-value">${workerDetails.nric_fin}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Designation:</span>
                                <span class="detail-value">${workerDetails.designation}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Date Joined:</span>
                                <span class="detail-value">${workerDetails.date_joined}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Bank Account:</span>
                                <span class="detail-value">${workerDetails.bank_account_number}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Basic Salary (per day):</span>
                                <span class="detail-value">$${workerDetails.basic_salary_per_day.toFixed(2)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">OT Rate (per hour):</span>
                                <span class="detail-value">$${workerDetails.ot_rate_per_hour.toFixed(2)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Sunday/PH Rate (per day):</span>
                                <span class="detail-value">$${workerDetails.sun_ph_rate_per_day.toFixed(2)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Allowance 1:</span>
                                <span class="detail-value">$${baseMonthlyAllowanceForDisplay.toFixed(2)}</span>
                            </div>
                        </div>

                        <div class="employee-details">
                            <div class="section-title">Salary Period</div>
                            <div class="detail-row">
                                <span class="detail-label">Period:</span>
                                <span class="detail-value">${formatPayslipPeriodRange(periodStart, periodEnd)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Salary Paid Date:</span>
                                <span class="detail-value">${formatPayslipPayDate(salaryPaidDate)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="bottom-section">
                        <div class="earnings-section">
                            <div class="section-title">Additions</div>
                            <div class="earnings-row">
                                <span class="item-label">Basic Days Worked</span>
                                <span class="item-amount">${basicDays.toFixed(2)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">Basic Pay</span>
                                <span class="item-amount">$${basicPay.toFixed(2)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">OT Hours</span>
                                <span class="item-amount">${to4SF(payableOtHours)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">OT Pay</span>
                                <span class="item-amount">$${otPay.toFixed(2)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">Sunday/PH Days</span>
                                <span class="item-amount">${sunPhDays.toFixed(2)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">Sunday/PH Pay</span>
                                <span class="item-amount">$${sunPhPay.toFixed(2)}</span>
                            </div>
                            <div class="earnings-row">
                                <span class="item-label">Monthly Allowance</span>
                                <span class="item-amount">$${allowance1.toFixed(2)}</span>
                            </div>
                            ${allowance2 > 0 ? `
                            <div class="earnings-row">
                                <span class="item-label">Incentive Allowance</span>
                                <span class="item-amount">$${allowance2.toFixed(2)}</span>
                            </div>
                            ` : ''}
                            ${bonusAmount > 0 ? `
                            <div class="earnings-row">
                                <span class="item-label">Bonus</span>
                                <span class="item-amount">$${bonusAmount.toFixed(2)}</span>
                            </div>
                            ` : ''}
                            ${workerType === 'local' && sdl > 0 ? `
                            <div class="earnings-row" style="background: #e8f5e8; border-left: 3px solid #28a745;">
                                <span class="item-label">SDL (Employer)</span>
                                <span class="item-amount" style="color: #28a745;">$${sdl.toFixed(2)}</span>
                            </div>
                            ` : ''}
                            ${deductions && deductions.filter(d => d.type && d.amount && parseFloat(d.amount) > 0).length > 0 ?
                                deductions.filter(d => d.type && d.amount && parseFloat(d.amount) > 0).map(deduction => `
                                    <div class="earnings-row" style="background: #fff3cd; border-left: 3px solid #ffc107;">
                                        <span class="item-label">${deduction.type}</span>
                                        <span class="item-amount" style="color: #856404;">+$${parseFloat(deduction.amount).toFixed(2)}</span>
                                    </div>
                                `).join('') : ''
                            }
                            ${additions && additions.filter(a => a.name && a.value && parseFloat(a.value) > 0).length > 0 ?
                                additions.filter(a => a.name && a.value && parseFloat(a.value) > 0).map(addition => `
                                    <div class="earnings-row">
                                        <span class="item-label">${addition.name}</span>
                                        <span class="item-amount">$${parseFloat(addition.value).toFixed(2)}</span>
                                    </div>
                                `).join('') : ''
                            }
                            <div class="earnings-row">
                                <span class="item-label">Total Additions</span>
                                <span class="item-amount">$${totalAdditions.toFixed(2)}</span>
                            </div>
                        </div>

                        <div class="deductions-section">
                            <div class="section-title">Deductions</div>
                            ${workerType === 'local' ? `
                                ${cpfEmployee > 0 ? `
                                    <div class="deductions-row">
                                        <span class="item-label">CPF Employee (${getCPFEmployeeRate(calculateAge(localWorker?.birthday))}%)</span>
                                        <span class="item-amount">-$${cpfEmployee.toFixed(2)}</span>
                                    </div>
                                ` : ''}
                                ${sinda > 0 ? `
                                    <div class="deductions-row">
                                        <span class="item-label">SINDA</span>
                                        <span class="item-amount">-$${sinda.toFixed(2)}</span>
                                    </div>
                                ` : ''}
                            ` : ''}
                            ${deductionsToUse.filter(d => d.type && d.amount).length > 0 ?
                                deductionsToUse.filter(d => d.type && d.amount).map(deduction => `
                                    <div class="deductions-row">
                                        <span class="item-label">${deduction.type}</span>
                                        <span class="item-amount">-$${parseFloat(deduction.amount).toFixed(2)}</span>
                                    </div>
                                `).join('') :
                                workerType === 'foreign' ? 
                                    '<div class="deductions-row"><span class="item-label">No statutory deductions</span><span class="item-amount">—</span></div>' :
                                    '<div class="deductions-row"><span class="item-label">—</span><span class="item-amount">—</span></div>'
                            }
                            ${totalDeductions > 0 ? `
                                <div class="deductions-row">
                                    <span class="item-label">Total Deductions</span>
                                    <span class="item-amount">-$${totalDeductions.toFixed(2)}</span>
                                </div>
                            ` : `
                                <div class="deductions-row">
                                    <span class="item-label">Total Deductions</span>
                                    <span class="item-amount">$0.00</span>
                                </div>
                            `}
                        </div>

                        ${workerType === 'local' ? `
                        <div class="employer-contributions" style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff;">
                            <div class="section-title" style="color: #007bff; margin-bottom: 10px;">Employer Contributions</div>
                            ${cpfEmployer > 0 ? `
                                <div class="contributions-row" style="display: flex; justify-content: space-between; margin: 5px 0; font-size: 12px;">
                                    <span>CPF Employer (${getCPFEmployerRate(calculateAge(localWorker?.birthday))}%)</span>
                                    <span style="color: #28a745; font-weight: 500;">+$${cpfEmployer.toFixed(2)}</span>
                                </div>
                            ` : ''}
                            ${sdl > 0 ? `
                                <div class="contributions-row" style="display: flex; justify-content: space-between; margin: 5px 0; font-size: 12px;">
                                    <span>SDL (0.25%)</span>
                                    <span style="color: #28a745; font-weight: 500;">+$${sdl.toFixed(2)}</span>
                                </div>
                            ` : ''}
                            <div class="contributions-row" style="display: flex; justify-content: space-between; margin: 8px 0 0 0; font-size: 12px; font-weight: 600; border-top: 1px solid #dee2e6; padding-top: 5px;">
                                <span>Total Employer Cost</span>
                                <span style="color: #28a745;">+$${(cpfEmployer + sdl).toFixed(2)}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    <div class="total-section">
                        <div class="total-label">Total Salary</div>
                        <div class="total-amount">$${netTotalPay.toFixed(2)}</div>
                    </div>

                    <div class="signature-section">
                        <div>
                            <div class="signature-line"></div>
                            <div class="signature-label">Director Signature</div>
                        </div>
                        <div>
                            <div class="signature-line"></div>
                            <div class="signature-label">Employee Signature</div>
                        </div>
                    </div>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    const resetMultiPrint = () => {
        setShowMultiPrintDialog(false);
        setMultiPrintStep(1);
        setMultiPrintMonth('');
        setMultiPrintIds('');
        setMultiPrintSalaryPaidDate('');
        setMultiPrintWorkers([]);
        setMultiPrintProgress({ current: 0, total: 0, isGenerating: false });
    };

    /** Multi print step 1: resolve the entered IDs into workers, each with its own editable payslip configuration. */
    const handleMultiPrintLoadWorkers = async () => {
        try {
            if (!multiPrintMonth) {
                toast.error('Please select a month');
                return;
            }
            const ids = [...new Set(multiPrintIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
            if (ids.length === 0) {
                toast.error('Enter at least one worker ID');
                return;
            }

            const [localResult, foreignResult] = await Promise.all([
                supabase.from('local_worker_details').select('employee_id, employee_name').in('employee_id', ids),
                supabase.from('worker_details').select('employee_id, employee_name').in('employee_id', ids),
            ]);
            if (localResult.error) throw localResult.error;
            if (foreignResult.error) throw foreignResult.error;

            const byId = new Map();
            (foreignResult.data || []).forEach((w) => byId.set(String(w.employee_id), { ...w, worker_type: 'foreign' }));
            (localResult.data || []).forEach((w) => byId.set(String(w.employee_id), { ...w, worker_type: 'local' }));

            const found = ids.filter((id) => byId.has(id));
            const missing = ids.filter((id) => !byId.has(id));
            if (found.length === 0) {
                toast.error(`No matching workers found: ${missing.join(', ')}`);
                return;
            }
            if (missing.length > 0) {
                toast.warning(`Not found and skipped: ${missing.join(', ')}`);
            }

            setMultiPrintWorkers(
                found.map((id) => ({
                    ...byId.get(id),
                    bonus: '',
                    additions: [{ name: '', value: '' }],
                    deductions: [{ type: '', amount: '' }],
                    salary_paid_date: multiPrintSalaryPaidDate || '',
                }))
            );
            setMultiPrintStep(2);
        } catch (error) {
            toast.error('Failed to load workers');
            console.error('Multi print load error:', error);
        }
    };

    const updateMultiPrintWorker = (index, patch) => {
        setMultiPrintWorkers((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
    };

    /** Multi print step 2: build every worker's timesheet + payslip, merge into one document, print once. */
    const handleMultiPrintAll = async () => {
        if (multiPrintWorkers.length === 0) return;
        const total = multiPrintWorkers.length;
        setMultiPrintProgress({ current: 0, total, isGenerating: true });
        try {
            const bodies = [];
            let headInner = '';
            const failed = [];

            for (let i = 0; i < total; i++) {
                const worker = multiPrintWorkers[i];
                setMultiPrintProgress({ current: i + 1, total, isGenerating: true });
                try {
                    const result = await printTimesheetAndPayslip(
                        worker.employee_id,
                        multiPrintMonth,
                        worker.deductions.filter((d) => d.type && d.amount),
                        worker.salary_paid_date || '',
                        String(worker.bonus ?? ''),
                        worker.additions.filter((a) => a.name && a.value),
                        true
                    );
                    if (!result?.completeHTML) throw new Error('No document generated');
                    if (!headInner) headInner = collectPayslipDocumentHeadInner(result.completeHTML);
                    bodies.push(extractPayslipDocumentBodyInner(result.completeHTML));
                } catch (workerError) {
                    console.error(`Multi print: failed for ${worker.employee_id}:`, workerError);
                    failed.push(worker.employee_id);
                }
            }

            if (bodies.length === 0) {
                toast.error('Could not generate any documents');
                return;
            }

            const pages = bodies
                .map((inner, i) => `<div class="multi-print-worker" style="${i < bodies.length - 1 ? 'page-break-after: always; break-after: page;' : ''}">${inner}</div>`)
                .join('\n');
            const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${headInner}</head><body>${pages}</body></html>`;

            const result = await printOrShareHtmlDocument(doc, {
                title: 'Print timesheets and payslips',
                fileName: `Timesheets_Payslips_${multiPrintMonth}_${bodies.length}workers.pdf`,
                printDelayMs: 500,
            });

            if (failed.length > 0) {
                toast.warning(`Printed ${bodies.length} of ${total}. Failed: ${failed.join(', ')}`);
            } else {
                toast.success(
                    result?.mode === 'share'
                        ? `Choose an app to save, print, or share (${bodies.length} workers)`
                        : `Print dialog opened (${bodies.length} workers) — use "Save as PDF" if needed`
                );
            }
            resetMultiPrint();
        } catch (error) {
            console.error('Multi print error:', error);
            toast.error('Failed to open print');
            setMultiPrintProgress({ current: 0, total: 0, isGenerating: false });
        }
    };

    // Function to generate payslip HTML for passing out (returns HTML string instead of printing)
    // This calls printTimesheetAndPayslip with returnHTML=true to get the HTML
    const generatePayslipHTMLForPassOut = async (workerId, monthYear, deductions = [], salaryPaidDate = '', bonus = '', additions = [], extras = {}) => {
        try {
            const bonusStr = bonus != null && bonus !== '' ? String(bonus) : '';
            const result = await printTimesheetAndPayslip(workerId, monthYear, deductions, salaryPaidDate, bonusStr, additions, true, extras);
            return result;
        } catch (error) {
            console.error('Error generating payslip HTML:', error);
            return { 
                payslipHTML: `<html><body><h1>Error generating payslip</h1><p>${error.message}</p></body></html>`, 
                timesheetHTML: `<html><body><h1>Error generating timesheet</h1><p>${error.message}</p></body></html>` 
            };
        }
    };

    const generateTimesheetHTMLForPassOut = async (workerId, monthYear) => {
        try {
            const result = await printTimesheetAndPayslip(workerId, monthYear, [], '', '', [], true);
            return result.timesheetHTML;
        } catch (error) {
            console.error('Error generating timesheet HTML:', error);
            throw error;
        }
    };

    // Handler for "All Workers" pass out - step 1: get month
    const handlePassOutAllWorkersPeriodSubmit = async () => {
        try {
            if (!passOutPayslipMonth) {
                toast.error('Please select a month');
                return;
            }

            // Get all workers
            const [localResult, foreignResult] = await Promise.all([
                supabase.from('local_worker_details').select('*'),
                supabase.from('worker_details').select('*')
            ]);

            const allWorkers = [
                ...(localResult.data || []).map(w => ({ ...w, worker_type: 'local' })),
                ...(foreignResult.data || []).map(w => ({ ...w, worker_type: 'foreign' }))
            ].sort((a, b) => a.employee_id.localeCompare(b.employee_id));

            // Exclude workers no longer in company (they cannot receive passed-out payslips)
            const activeWorkers = allWorkers.filter(w => w.in_company !== false);

            if (activeWorkers.length === 0) {
                toast.error('No active workers found (all may be marked as no longer in company)');
                return;
            }

            if (activeWorkers.length < allWorkers.length) {
                toast.info(`${allWorkers.length - activeWorkers.length} worker(s) excluded (no longer in company)`);
            }

            // Initialize all workers with default payslip configuration
            const workersWithConfig = activeWorkers.map(worker => ({
                ...worker,
                bonus: '0',
                additions: [{ name: '', value: '' }],
                deductions: [{ type: '', amount: '' }],
                salary_paid_date: passOutPayslipSalaryPaidDate || '',
                open_balances: [],
                balance_sel: {},
                amount_paid: ''
            }));

            try {
                const [y, m] = passOutPayslipMonth.split('-').map(Number);
                const balanceMap = await getOpenBalancesForPeriod(activeWorkers.map((w) => w.employee_id), y, m);
                workersWithConfig.forEach((w) => {
                    w.open_balances = balanceMap.get(String(w.employee_id)) || [];
                });
            } catch (balanceError) {
                console.error('Error loading pay balances:', balanceError);
                toast.warning('Could not load pay balances; you can still pass out payslips.');
            }

            setPassOutPayslipAllWorkers(workersWithConfig);
            setPassOutPayslipAllStep(2);
            toast.success(`Found ${activeWorkers.length} active workers`);
        } catch (error) {
            toast.error('Failed to load workers');
            console.error('Error:', error);
        }
    };

    // Helper function to calculate and save local worker payslip to local_worker_payslip_history
    /** precomputed: the pass-out's printTimesheetAndPayslip result, so the payslip is only calculated once. */
    const saveLocalWorkerPayslip = async (workerId, monthYear, salaryPaidDate, bonus, additions, deductions, precomputed = null) => {
        try {
            const { year, month, startDate, endDate } = monthYearToDateRange(monthYear);

            const { data: localWorker, error: workerError } = await supabase
                .from('local_worker_details')
                .select('*')
                .eq('employee_id', workerId)
                .maybeSingle();

            if (workerError || !localWorker) {
                throw new Error(`Local worker ${workerId} not found`);
            }

            const { payslipHTML, payroll } = precomputed || await printTimesheetAndPayslip(
                workerId,
                monthYear,
                deductions || [],
                salaryPaidDate,
                bonus,
                additions || [],
                true
            );
            const extracted = extractPayslipValues(payslipHTML);
            const fromPayrollOrExtract = (payrollKey, extractedKey, fallback = 0) => {
                if (payroll?.[payrollKey] != null && payroll[payrollKey] !== '') {
                    return Number(payroll[payrollKey]) || 0;
                }
                const extractedVal = extracted?.[extractedKey];
                if (extractedVal != null && extractedVal !== '') return Number(extractedVal) || 0;
                return fallback;
            };

            const { data: workerShiftsRaw } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', workerId)
                .gte('work_date', startDate)
                .lte('work_date', endDate)
                .order('work_date', { ascending: true });

            const workerShifts = filterShiftsForPayroll(workerShiftsRaw || []).filter((s) =>
                isWorkerPayEligibleOnDate(localWorker, s.work_date)
            );

            const basicPay = fromPayrollOrExtract('basic_pay', 'basic_pay');
            const otPay = fromPayrollOrExtract('ot_pay', 'ot_pay');
            const sundayPay = fromPayrollOrExtract('sun_ph_pay', 'sun_ph_pay');
            const proratedAllowance = fromPayrollOrExtract('monthly_allowance', 'monthly_allowance');
            const incentiveAllowance = fromPayrollOrExtract('incentive_allowance', 'incentive_allowance');
            const bonusAmount = fromPayrollOrExtract('bonus', 'bonus', parseFloat(bonus) || 0);
            const cpfEmployeeDeduction = fromPayrollOrExtract('cpf_employee_deduction', 'cpf_employee_deduction');
            const sindaContribution = fromPayrollOrExtract('sinda_deduction', 'sinda_deduction');

            const customAdditions = additions?.filter(a => a.name && a.value) || [];
            const totalCustomAdditions = sumPayslipLineItems(customAdditions, 'name', 'value');
            const customDeductions = deductions?.filter(d => d.type && d.amount) || [];
            const totalCustomDeductions = sumPayslipLineItems(customDeductions, 'type', 'amount');

            const totalAdditions = fromPayrollOrExtract(
                'total_additions',
                'total_additions',
                basicPay + otPay + sundayPay + proratedAllowance + incentiveAllowance + bonusAmount + totalCustomAdditions
            );
            const totalDeductions = fromPayrollOrExtract(
                'total_deductions',
                'total_deductions',
                cpfEmployeeDeduction + sindaContribution + totalCustomDeductions
            );
            const netPay = fromPayrollOrExtract('net_pay', 'net_pay', totalAdditions - totalDeductions);

            const { data: workingDaysData } = await supabase
                .from('working_days_config')
                .select('working_days')
                .eq('year', year)
                .eq('month', month)
                .maybeSingle();
            const workingDays = workingDaysData?.working_days || 22;
            const monthlyBasicSalary = parseFloat(localWorker.basic_salary_per_day || 0);
            const dailyBasicSalary = workingDays > 0 ? monthlyBasicSalary / workingDays : 0;
            const basicDays = dailyBasicSalary > 0 ? basicPay / dailyBasicSalary : 0;

            const otHours = workerShifts.reduce((sum, s) => sum + (parseFloat(s.ot_hours) || 0), 0);
            const sundayHours = workerShifts.reduce((sum, s) => sum + (parseFloat(s.sunday_hours) || 0), 0);

            let cpfEmployerContribution = 0;
            let sdlAmount = 0;
            const payslipMonthDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const { employeeRate: cpfEmployeeRate, employerRate: cpfEmployerRate } = getCpfRatesForBirthday(
                localWorker.birthday,
                endOfMonthSgt(payslipMonthDate)
            );
            // Keep stored % rates in sync for display
            await supabase
                .from('local_worker_details')
                .update({
                    cpf_employee_contribution: cpfEmployeeRate,
                    cpf_employer_contribution: cpfEmployerRate
                })
                .eq('employee_id', workerId);
            const { totalCpfBase: cpfWageBase } = computeCpfWageBase({
                basicPay,
                otPay,
                sunPhPay: sundayPay,
                allowances: proratedAllowance + incentiveAllowance,
                bonus: bonusAmount,
            });
            cpfEmployerContribution = Number(payroll?.cpf_employer_contribution) || calculateCPFDeductions(cpfWageBase, 0, cpfEmployerRate).employerContribution;
            sdlAmount = Number(payroll?.sdl_contribution) || calculateSDL(cpfWageBase);

            const ytd = await computeLocalYtd(workerId, year, month, {
                net: netPay,
                cpfEmp: cpfEmployeeDeduction,
                cpfEr: cpfEmployerContribution,
            });
            const accumulatedNetPay = ytd.accumulatedSalary;
            
            // Check if payslip already exists
            const { data: existingPayslip } = await supabase
                .from('local_worker_payslip_history')
                .select('id')
                .eq('employee_id', workerId)
                .eq('period_year', year)
                .eq('period_month', month)
                .maybeSingle();
            
            const payslipData = {
                employee_id: workerId,
                employee_name: localWorker.employee_name,
                designation: localWorker.designation,
                period_month: month,
                period_year: year,
                basic_salary: basicPay,
                ot_pay: otPay,
                sunday_pay: sundayPay,
                monthly_allowance: proratedAllowance,
                incentive_allowance: incentiveAllowance,
                total_additions: totalAdditions,
                cpf_employee: cpfEmployeeDeduction,
                cpf_employer: cpfEmployerContribution,
                sinda_contribution: sindaContribution,
                sdl_amount: sdlAmount,
                total_deductions: totalDeductions,
                net_pay: netPay,
                worked_days: basicDays,
                total_worked_hours: workerShifts?.reduce((sum, s) => sum + (parseFloat(s.worked_hours) || 0), 0) || 0,
                total_ot_hours: otHours,
                total_sunday_hours: sundayHours,
                is_passed_out: true,
                passed_out_at: new Date().toISOString(),
                additions_json: additions?.filter(a => a.name && a.value) || [],
                deductions_json: deductions?.filter(d => d.type && d.amount) || [],
                bonus: bonusAmount,
                salary_paid_date: salaryPaidDate
            };
            
            if (existingPayslip) {
                // Update existing payslip
                const { error: updateError } = await supabase
                    .from('local_worker_payslip_history')
                    .update(payslipData)
                    .eq('id', existingPayslip.id);
                
                if (updateError) throw updateError;
            } else {
                // Insert new payslip
                const { error: insertError } = await supabase
                    .from('local_worker_payslip_history')
                    .insert([payslipData]);
                
                if (insertError) throw insertError;
            }
            
            // Update accumulated values in local_worker_details
            // NOTE: cpf_employee_contribution and cpf_employer_contribution are PERCENTAGE RATES, not accumulated amounts
            // Accumulated amounts are stored in local_worker_payslip_history and calculated when needed
            await supabase
                .from('local_worker_details')
                .update({
                    accumulated_net_pay: accumulatedNetPay,
                    // DO NOT update cpf_employee_contribution and cpf_employer_contribution - these are rates, not accumulated amounts
                    // DO NOT update sinda_contribution - this is a fixed amount based on wage brackets, not accumulated
                    last_accumulation_date: getTodaySingapore()
                })
                .eq('employee_id', workerId);
            
            return { success: true };
        } catch (error) {
            console.error('Error saving local worker payslip:', error);
            throw error;
        }
    };

    // Function to pass out payslips for all workers
    const handlePassOutPayslipAllWorkers = async () => {
        try {
            if (passOutPayslipAllWorkers.length === 0) {
                toast.error('No workers to process');
                return;
            }

            // Payslips are built on the month's approved timesheet — warn about any that aren't ready.
            const [ymYear, ymMonth] = passOutPayslipMonth.split('-').map(Number);
            const timesheetMap = await getTimesheetsForMonth(passOutPayslipAllWorkers.map((w) => w.employee_id), ymYear, ymMonth);
            const notReady = passOutPayslipAllWorkers.filter((w) => {
                const ts = timesheetMap.get(String(w.employee_id));
                return !ts || ts.is_stale || ts.status !== 'approved';
            });
            if (notReady.length > 0) {
                const ok = await confirmAction({
                    title: 'Some timesheets aren\'t ready',
                    message: `${notReady.length} worker(s) don't have an approved, up-to-date timesheet for this month (${notReady.slice(0, 8).map((w) => w.employee_id).join(', ')}${notReady.length > 8 ? '…' : ''}). Pass out their payslips anyway?`,
                    confirmLabel: 'Pass out anyway',
                });
                if (!ok) return;
            }

            const totalWorkers = passOutPayslipAllWorkers.length;
            setPassOutPayslipProgress({ current: 0, total: totalWorkers, isGenerating: true });
            toast.info(`Passing out payslips for ${totalWorkers} workers...`, { duration: 3000 });

            let successCount = 0;
            let failCount = 0;
            let currentIndex = 0;

            for (const worker of passOutPayslipAllWorkers) {
                currentIndex++;
                setPassOutPayslipProgress({ current: currentIndex, total: totalWorkers, isGenerating: true });
                try {
                    if (!worker.salary_paid_date) {
                        console.warn(`Skipping worker ${worker.employee_id} - no salary paid date`);
                        failCount++;
                        continue;
                    }

                    const balanceSel = selectionToLines(worker.open_balances || [], worker.balance_sel || {});
                    const amountPaid = worker.amount_paid === '' || worker.amount_paid == null ? null : worker.amount_paid;

                    // Generate payslip HTML (calculated once; reused for the local history copy)
                    const generated = await generatePayslipHTMLForPassOut(
                        worker.employee_id,
                        passOutPayslipMonth,
                        worker.deductions.filter(d => d.type && d.amount),
                        worker.salary_paid_date,
                        worker.bonus || '0',
                        worker.additions.filter(a => a.name && a.value),
                        { balanceLines: balanceSel.lines, amountPaid }
                    );
                    const { payslipHTML } = generated;
                    const linkedTimesheet = timesheetMap.get(String(worker.employee_id)) || null;

                    const { startDate, endDate } = monthYearToDateRange(passOutPayslipMonth);

                    // If worker is local, save to local_worker_payslip_history
                    if (worker.worker_type === 'local') {
                        try {
                            await saveLocalWorkerPayslip(
                                worker.employee_id,
                                passOutPayslipMonth,
                                worker.salary_paid_date,
                                worker.bonus || '0',
                                worker.additions.filter(a => a.name && a.value),
                                worker.deductions.filter(d => d.type && d.amount),
                                generated
                            );
                        } catch (localError) {
                            console.error(`Error saving local payslip for ${worker.employee_id}:`, localError);
                            // Continue to save to passed_out_payslips anyway
                        }
                    }

                    // One payslip per worker per period: insert, or update the existing one in place.
                    try {
                        const savedPayslip = await savePassedOutPayslip({
                            worker_id: worker.employee_id,
                            worker_type: worker.worker_type,
                            payslip_type: 'period',
                            start_date: startDate,
                            end_date: endDate,
                            payslip_date: null,
                            salary_paid_date: worker.salary_paid_date,
                            bonus: parseFloat(worker.bonus) || 0,
                            additions: worker.additions.filter(a => a.name && a.value),
                            deductions: worker.deductions.filter(d => d.type && d.amount),
                            payslip_html: payslipHTML,
                            timesheet_html: linkedTimesheet?.timesheet_html || '<html><body></body></html>',
                            timesheet_id: linkedTimesheet?.id || null
                        });
                        await recordPayslipBalances(savedPayslip, generated, balanceSel.uses, amountPaid);
                        successCount++;
                    } catch (error) {
                        console.error(`Error passing out payslip for ${worker.employee_id}:`, error);
                        failCount++;
                    }
                } catch (workerError) {
                    console.error(`Error processing worker ${worker.employee_id}:`, workerError);
                    failCount++;
                }
            }

            // Reset progress
            setPassOutPayslipProgress({ current: 0, total: 0, isGenerating: false });

            if (failCount > 0) {
                toast.warning(`Passed out ${successCount} payslips, ${failCount} failed`);
            } else {
                toast.success(`Successfully passed out ${successCount} payslips!`);
            }

            // Reset and close
            setShowPassOutPayslipDialog(false);
            setPassOutPayslipMode('');
            setPassOutPayslipAllStep(1);
            setPassOutPayslipAllWorkers([]);
            setPassOutPayslipStartDate('');
            setPassOutPayslipEndDate('');
            setPassOutPayslipSalaryPaidDate('');
        } catch (error) {
            console.error('Error passing out payslips:', error);
            setPassOutPayslipProgress({ current: 0, total: 0, isGenerating: false });
            toast.error('Failed to pass out payslips: ' + error.message);
        }
    };

    // Load the worker's open pay balances for the individual pass-out dialog.
    useEffect(() => {
        const id = passOutPayslipWorkerId?.trim();
        setPassOutPayslipBalanceSel({});
        if (!showPassOutPayslipDialog || passOutPayslipMode !== 'individual' || !id || !passOutPayslipMonth) {
            setPassOutPayslipBalances([]);
            return undefined;
        }
        let cancelled = false;
        const t = window.setTimeout(async () => {
            try {
                const [y, m] = passOutPayslipMonth.split('-').map(Number);
                const map = await getOpenBalancesForPeriod([id], y, m);
                if (!cancelled) setPassOutPayslipBalances(map.get(id) || []);
            } catch (error) {
                console.error('Error loading pay balances:', error);
            }
        }, 400);
        return () => {
            cancelled = true;
            window.clearTimeout(t);
        };
    }, [showPassOutPayslipDialog, passOutPayslipMode, passOutPayslipWorkerId, passOutPayslipMonth]);

    /** Record balance uses + amount paid for a saved payslip; never fails the pass-out itself. */
    const recordPayslipBalances = async (savedPayslip, generated, uses, amountPaid) => {
        if (!savedPayslip?.id || !generated?.payroll) return true;
        try {
            await applyPayslipBalances({ payslipId: savedPayslip.id, netPay: generated.payroll.net_pay, uses, amountPaid });
            return true;
        } catch (error) {
            console.error(`Pay balances not recorded for payslip ${savedPayslip.id}:`, error);
            toast.error(balanceErrorMessage(error) || `Payslip for ${savedPayslip.worker_id} saved, but its pay balances were not recorded. Check Pay balances.`);
            return false;
        }
    };

    // Function to pass out payslip (individual)
    const passOutPayslipIndividual = async () => {
        try {
            if (!passOutPayslipWorkerId || !passOutPayslipMonth || !passOutPayslipSalaryPaidDate) {
                toast.error('Please fill in all required fields');
                return;
            }

            // Check if worker is still in company (cannot pass out to former employees)
            const { data: localCheck } = await supabase
                .from('local_worker_details')
                .select('in_company')
                .eq('employee_id', passOutPayslipWorkerId)
                .maybeSingle();
            const { data: foreignCheck } = await supabase
                .from('worker_details')
                .select('in_company')
                .eq('employee_id', passOutPayslipWorkerId)
                .maybeSingle();
            const workerInCompany = localCheck || foreignCheck;
            if (workerInCompany && workerInCompany.in_company === false) {
                toast.error('Cannot pass out payslip to worker no longer in company');
                return;
            }

            // Payslips are built on the month's approved timesheet — warn if it isn't ready.
            const [ymYear, ymMonth] = passOutPayslipMonth.split('-').map(Number);
            const { timesheet: linkedTimesheet, problem } = await checkTimesheetForPayslip(passOutPayslipWorkerId, ymYear, ymMonth);
            if (problem) {
                const ok = await confirmAction({
                    title: 'Timesheet not ready',
                    message: `For worker ${passOutPayslipWorkerId}, ${describeTimesheetProblem(problem)}. Pass out the payslip anyway?`,
                    confirmLabel: 'Pass out anyway',
                });
                if (!ok) return;
            }

            toast.info('Generating payslip...', { duration: 2000 });

            const balanceSel = selectionToLines(passOutPayslipBalances, passOutPayslipBalanceSel);
            const amountPaid = passOutPayslipAmountPaid === '' ? null : passOutPayslipAmountPaid;

            // Generate payslip HTML using the same logic as print (calculated once)
            const generated = await generatePayslipHTMLForPassOut(
                passOutPayslipWorkerId,
                passOutPayslipMonth,
                passOutPayslipDeductions,
                passOutPayslipSalaryPaidDate,
                String(passOutPayslipBonus ?? ''),
                passOutPayslipAdditions,
                { balanceLines: balanceSel.lines, amountPaid }
            );
            const { payslipHTML } = generated;

            const { startDate, endDate } = monthYearToDateRange(passOutPayslipMonth);

            // Determine worker type (use maybeSingle to avoid 406 errors for foreign workers)
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('employee_id')
                .eq('employee_id', passOutPayslipWorkerId)
                .maybeSingle();
            
            // Worker is local if found and no error (ignore 406 and PGRST116 errors)
            const workerType = (!localError && localWorker) ? 'local' : 'foreign';

            // If worker is local, save to local_worker_payslip_history
            if (workerType === 'local') {
                try {
                    await saveLocalWorkerPayslip(
                        passOutPayslipWorkerId,
                        passOutPayslipMonth,
                        passOutPayslipSalaryPaidDate,
                        passOutPayslipBonus || '0',
                        passOutPayslipAdditions.filter(a => a.name && a.value),
                        passOutPayslipDeductions.filter(d => d.type && d.amount),
                        generated
                    );
                } catch (localError) {
                    console.error(`Error saving local payslip for ${passOutPayslipWorkerId}:`, localError);
                    // Continue to save to passed_out_payslips anyway
                }
            }

            // One payslip per worker per period: insert, or update the existing one in place.
            const savedPayslip = await savePassedOutPayslip({
                worker_id: passOutPayslipWorkerId,
                worker_type: workerType,
                payslip_type: 'period',
                start_date: startDate,
                end_date: endDate,
                payslip_date: null,
                salary_paid_date: passOutPayslipSalaryPaidDate,
                bonus: parseFloat(passOutPayslipBonus) || 0,
                additions: passOutPayslipAdditions.filter(a => a.name && a.value),
                deductions: passOutPayslipDeductions.filter(d => d.type && d.amount),
                payslip_html: payslipHTML,
                timesheet_html: linkedTimesheet?.timesheet_html || '<html><body></body></html>',
                timesheet_id: linkedTimesheet?.id || null
            });
            await recordPayslipBalances(savedPayslip, generated, balanceSel.uses, amountPaid);

            toast.success('Payslip passed out successfully!');
            setPassOutPayslipBalanceSel({});
            setPassOutPayslipAmountPaid('');
            setShowPassOutPayslipDialog(false);
            setPassOutPayslipMode('');
            // Reset form
            setPassOutPayslipWorkerId('');
            setPassOutPayslipMonth('');
            setPassOutPayslipSalaryPaidDate('');
            setPassOutPayslipBonus('');
            setPassOutPayslipAdditions([{ name: '', value: '' }]);
            setPassOutPayslipDeductions([{ type: '', amount: '' }]);
        } catch (error) {
            console.error('Error passing out payslip:', error);
            toast.error('Failed to pass out payslip: ' + (error.message || 'Unknown error'));
        }
    };

    // Pass out timesheet for approval (sends to worker portal)
    const passOutTimesheet = async () => {
        try {
            if (!passOutTimesheetMonth) {
                toast.error('Please select a month');
                return;
            }
            const [yearStr, monthStr] = passOutTimesheetMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10);
            const { startDate, endDate } = monthYearToDateRange(passOutTimesheetMonth);

            let workerIds = [];
            if (passOutTimesheetMode === 'individual') {
                if (!passOutTimesheetWorkerId?.trim()) {
                    toast.error('Please enter Worker ID');
                    return;
                }
                workerIds = [passOutTimesheetWorkerId.trim()];
            } else if (passOutTimesheetMode === 'group') {
                const ids = passOutTimesheetWorkerIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
                if (ids.length === 0) {
                    toast.error('Please enter at least one Worker ID');
                    return;
                }
                workerIds = ids;
            } else {
                // All workers
                const [localRes, foreignRes] = await Promise.all([
                    supabase.from('local_worker_details').select('employee_id').eq('in_company', true),
                    supabase.from('worker_details').select('employee_id').eq('in_company', true)
                ]);
                workerIds = [
                    ...(localRes.data || []).map(w => w.employee_id),
                    ...(foreignRes.data || []).map(w => w.employee_id)
                ];
                workerIds = [...new Set(workerIds)];
            }

            // One timesheet per worker per month. Workers who already have one: update it in place
            // (earlier version kept in History) or skip them.
            const existingMap = await getTimesheetsForMonth(workerIds, year, month);
            let updateExisting = false;
            if (existingMap.size > 0) {
                updateExisting = await confirmAction({
                    title: 'Timesheet already passed out',
                    message: `${existingMap.size} of these worker(s) already have a timesheet for ${monthStr}/${yearStr}. Update those timesheets with the latest shifts and send them back for approval? Earlier versions are kept in History. Choose Cancel to leave them as they are and only pass out the rest.`,
                    confirmLabel: 'Update them',
                });
            }

            setPassOutTimesheetProgress({ current: 0, total: workerIds.length, isGenerating: true });
            let successCount = 0;
            let failCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;

            for (let i = 0; i < workerIds.length; i++) {
                const wid = workerIds[i];
                setPassOutTimesheetProgress({ current: i + 1, total: workerIds.length, isGenerating: true });
                try {
                    const { data: localW } = await supabase.from('local_worker_details').select('employee_id').eq('employee_id', wid).maybeSingle();
                    const workerType = localW ? 'local' : 'foreign';

                    const existing = existingMap.get(String(wid));
                    if (existing && !updateExisting) {
                        skippedCount++;
                        continue;
                    }

                    const timesheetHTML = await generateTimesheetHTMLForPassOut(wid, passOutTimesheetMonth);

                    if (existing) {
                        await updateTimesheetInPlace(existing, timesheetHTML);
                        updatedCount++;
                        successCount++;
                        continue;
                    }

                    const { error } = await supabase.from('passed_out_timesheets').insert([{
                        worker_id: wid,
                        worker_type: workerType,
                        month,
                        year,
                        start_date: startDate,
                        end_date: endDate,
                        timesheet_html: timesheetHTML,
                        status: 'pending_worker',
                        created_by: localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'admin'
                    }]);

                    if (error) throw error;
                    successCount++;
                } catch (err) {
                    console.error(`Error passing out timesheet for ${wid}:`, err);
                    failCount++;
                }
            }

            setPassOutTimesheetProgress({ current: 0, total: 0, isGenerating: false });
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
            const extras = [
                updatedCount ? `${updatedCount} updated in place` : '',
                skippedCount ? `${skippedCount} already passed out (left as is)` : '',
            ].filter(Boolean).join(', ');
            if (failCount > 0) {
                toast.warning(`Passed out ${successCount} timesheets, ${failCount} failed${extras ? ` · ${extras}` : ''}`);
            } else {
                toast.success(`Passed out ${successCount} timesheets for approval${extras ? ` · ${extras}` : ''}`);
            }
            setShowPassOutTimesheetDialog(false);
            setPassOutTimesheetMode('');
            setPassOutTimesheetMonth('');
            setPassOutTimesheetWorkerId('');
            setPassOutTimesheetWorkerIds('');
        } catch (error) {
            console.error('Error passing out timesheets:', error);
            setPassOutTimesheetProgress({ current: 0, total: 0, isGenerating: false });
            toast.error('Failed to pass out timesheets: ' + (error.message || 'Unknown error'));
        }
    };

    const toggleCardExpansion = (shiftId) => {
        const newExpanded = new Set(expandedCards);
        if (newExpanded.has(shiftId)) {
            newExpanded.delete(shiftId);
        } else {
            newExpanded.add(shiftId);
        }
        setExpandedCards(newExpanded);
    };

    const getStatusBadge = (shift) => {
        if (!shift.has_left) {
            return <Badge className="bg-blue-600"><AlertCircle className="w-3 h-3 mr-1" />{t('ui.inProgress')}</Badge>;
        }

        const workDate = new Date(shift.work_date);
        const isSundayShift = isSunday(workDate);
        const isHolidayShift = isPublicHoliday(workDate);

        if (isSundayShift || isHolidayShift) {
            return <Badge className="bg-red-600"><CheckCircle className="w-3 h-3 mr-1" />{t('ui.completedSunHol')}</Badge>;
        }

        return <Badge className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />{t('ui.completed')}</Badge>;
    };

    const nativeApp = isNativeApp();
    const startTutorial = () => {
        setActiveDashboardTab('time-tracker');
        setIsTutorialRunning(true);
    };

    
                const adminDash = {
                SHIFT_PAGE,
                adminApproveTimesheet,
                adminResendToWorker,
                allLeaveRequests,
                allSites,
                approvingShiftId,
                bulkLeaveStatusMutation,
                dateFilter,
                deletePassedOutTimesheet,
                deletePayslip,
                deleteShiftMutation,
                expandedCards,
                exportToExcel,
                exportWorkersToExcel,
                fetchPayslipReport,
                filter,
                filteredShifts,
                foreignWorkers,
                foreignWorkersDirectory,
                formatAmount,
                formatRejoinDatesCell,
                handleAddWorkerClick,
                handleApproveShift,
                handleDeclineShift,
                handleDeleteWorkerClick,
                handleDownloadPassedOutTimesheet,
                handleEditWorkerClick,
                handleExportLeaveReport,
                handlePrintAllPassedOutPayslipReport,
                handlePrintAllPassedOutTimesheets,
                handlePrintPassedOutPayslipReport,
                handlePrintPayslipReportSummary,
                handlePrintSingleLeaveForm,
                handlePrintTimesheetReportSummary,
                handleViewPassedOutPayslipReport,
                handleViewPassedOutTimesheet,
                handleWorkerSearchClick,
                inProgressCount,
                isFetching,
                isFetchingAdminTimesheets,
                isLoading,
                isLoadingForeignWorkers,
                isLoadingLeaveRequests,
                isLoadingLocalWorkers,
                isLoadingSites,
                isPrintingLeaveForms,
                isShiftsError,
                leaveDashboardStats,
                leavePolicySettings,
                leaveRequests,
                localWorkers,
                localWorkersDirectory,
                nativeApp,
                openAddSiteDialog,
                openEditShiftDialog,
                openEditSiteDialog,
                openLeaveAttachment,
                openSiteQrPreview,
                openTimesheetHistory,
                passedOutTimesheetsData,
                payslipReportData,
                payslipReportMonth,
                printWorkerDetails,
                promptLeaveRejectReason,
                queryClient,
                recreateAndResendTimesheet,
                refetch,
                resendSameTimesheet,
                searchTerm,
                selectedLeaveIds,
                selectedMonth,
                selectedYear,
                setAdminDeclineTimesheetDialog,
                setCreateShiftData,
                setDateFilter,
                setEditingLeave,
                setEditingPayslip,
                setFilter,
                setLeaveEditData,
                setLeaveEditHardWarnings,
                setLeaveEditSoftWarnings,
                setLeavePolicyForm,
                setPassOutPayslipMode,
                setPassOutTimesheetMode,
                setPayslipEditForm,
                setPayslipReportMonth,
                setPendingDeleteShiftId,
                setPendingDeleteSite,
                setPrintSelectedWorkerType,
                setPrintWorkerTypeDialog,
                setSearchTerm,
                setSelectedLeaveIds,
                setSelectedMonth,
                setSelectedYear,
                setShiftLimit,
                setShowCreateLeaveDialog,
                setShowCreateShiftDialog,
                setShowDeleteDialog,
                setShowEditLeaveDialog,
                setShowIndividualDeletePinDialog,
                setShowLeaveHistory,
                setShowLeavePolicyDialog,
                setShowManagerDialog,
                setShowPassOutPayslipDialog,
                setShowPassOutTimesheetDialog,
                setShowSupervisorDialog,
                setSiteFilter,
                setTimesheetReportMonth,
                setWorkerIdFilter,
                setWorkerTypeFilter,
                shiftLimit,
                shifts,
                shiftsError,
                siteFilter,
                t,
                timeTrackerFormOpen,
                timesheetReportMonth,
                toggleCardExpansion,
                unapprovedCount,
                uniqueSites,
                updateLeaveStatus,
                workerIdFilter,
                workerIsNotInCompany,
                workerTypeFilter,
                leaveLimit,
                setLeaveLimit,
            };

    // Defense in depth: Worker Info / payslips must never render for manager/supervisor
    // even if a route guard is bypassed. (Route already restricts to admin.)
    if (identity && identity.role !== 'admin') {
        return <Navigate to={homePathFor(identity.role)} replace />;
    }

    return (
        <div className={cn('admin-dash-ui relative isolate min-h-dvh-safe', nativeApp ? 'admin-app-ui bg-[var(--g-bg)]' : 'bg-[var(--g-bg,#f3f4f6)]')}>
            {nativeApp ? null : <PortalBackdrop slate />}
            <AppTour
                run={isTutorialRunning}
                steps={adminTutorialSteps}
                onClose={() => setIsTutorialRunning(false)}
                onStepChange={handleAdminTourStepChange}
            />
            {/* Hub owns the bottom TabBar — always use TopBar + section strip + More drawer
                (AdminAppChrome's dock is CSS-hidden inside .g-shell and left sections unreachable). */}
            <TopBar
                eyebrow={t('role.admin')}
                title={ADMIN_TAB_TITLES[activeDashboardTab] || t('admin.dashboard')}
                trailing={
                    <div className="flex items-center gap-1.5" data-tour="admin-header">
                        <AdminMorePagesDrawer onTutorial={startTutorial} />
                        <Button
                            onClick={startTutorial}
                            variant="outline"
                            size="sm"
                            className="hidden h-9 rounded-full border-[var(--g-hairline)] sm:inline-flex"
                        >
                            <HelpCircle className="mr-1.5 h-4 w-4" />
                            {t('common.tutorial')}
                        </Button>
                    </div>
                }
            >
                <AdminMobileSectionStrip
                    activeTab={activeDashboardTab}
                    onTabChange={setActiveDashboardTab}
                    leaveCount={leaveRequests?.length || 0}
                />
            </TopBar>

            {/* Main Dashboard Tabs — hub TabBar owns phone chrome; section tabs below */}
            <div className={cn(
                'app-page-content relative z-10 mx-auto max-w-7xl px-safe py-5',
                nativeApp
                    ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))]'
                    : 'pb-[calc(var(--g-tabbar-space,5.5rem)+1rem)]'
            )}>
                <DashboardAnalyticsWidget
                    shifts={shifts}
                    variant={nativeApp ? 'app' : 'glass'}
                    accent="brand"
                />
                <AdminDashProvider value={adminDash}>
                <Tabs value={activeDashboardTab} onValueChange={setActiveDashboardTab} className="mt-4 w-full">
                    <TabsList
                        data-section-nav
                        className={cn(
                        'h-auto w-full grid-cols-4 gap-1 rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] p-1 shadow-[0_1px_2px_rgb(15_29_51/0.04)] lg:grid-cols-7',
                        // Phone/tablet: AdminMobileSectionStrip. lg+ (hub sidebar): this grid.
                        'hidden lg:grid'
                    )} data-tour="admin-tabs">
                        <TabsTrigger value="time-tracker" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-time-tracker">
                            <Clock className="mr-1.5 h-4 w-4" />
                            {t('admin.timeTracker')}
                        </TabsTrigger>
                        <TabsTrigger value="leaves" className="relative rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-leaves">
                            <Calendar className="mr-1.5 h-4 w-4" />
                            {t('admin.leaves')}
                            {leaveRequests && leaveRequests.length > 0 && (
                                <Badge
                                    variant="destructive"
                                    className="ml-1 h-5 min-w-5 px-1.5 text-xs"
                                >
                                    {leaveRequests.length}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="payslip-report" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-payslip">
                            <Receipt className="mr-1.5 h-4 w-4" />
                            {t('admin.payslip')}
                        </TabsTrigger>
                        <TabsTrigger value="timesheet-report" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-timesheet">
                            <FileText className="mr-1.5 h-4 w-4" />
                            {t('admin.timesheet')}
                        </TabsTrigger>
                        <TabsTrigger value="worker-info" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-worker-info">
                            <Users className="mr-1.5 h-4 w-4" />
                            {t('admin.workers')}
                        </TabsTrigger>
                        {!UNIFIED ? (
                            <TabsTrigger value="sites" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm" data-tour="admin-tab-sites">
                                <MapPin className="mr-1.5 h-4 w-4" />
                                {t('admin.sites')}
                            </TabsTrigger>
                        ) : null}
                        <TabsTrigger value="vehicles" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm">
                            <Car className="mr-1.5 h-4 w-4" />
                            {t('admin.vehicles')}
                        </TabsTrigger>
                    </TabsList>

                    {/* Time Tracker Tab */}
                    <TabsContent value="time-tracker" className="mt-6">
                        {activeDashboardTab === 'time-tracker' && (
                            <Suspense fallback={<PageLoader />}>
                                <TimeTrackerTab />
                            </Suspense>
                        )}
                    </TabsContent>

                    {/* Leaves Tab */}
                    <TabsContent value="leaves" className="mt-6">
                        {activeDashboardTab === 'leaves' && (
                            <Suspense fallback={<PageLoader />}>
                                <LeavesTab />
                            </Suspense>
                        )}
                    </TabsContent>

                    {/* Payslip Report Tab */}
                    <TabsContent value="payslip-report" className="mt-6">
                        {activeDashboardTab === 'payslip-report' && (
                            <Suspense fallback={<PageLoader />}>
                                <PayslipReportTab />
                            </Suspense>
                        )}
                    </TabsContent>

                    {/* Timesheet Report Tab - Passed Out Timesheets (Approval Workflow) */}
                    <TabsContent value="timesheet-report" className="mt-6">
                        {activeDashboardTab === 'timesheet-report' && (
                            <Suspense fallback={<PageLoader />}>
                                <TimesheetReportTab />
                            </Suspense>
                        )}
                    </TabsContent>

                    {/* Edit Payslip Dialog */}
                    <Dialog open={!!editingPayslip} onOpenChange={(open) => !open && setEditingPayslip(null)}>
                        <DialogContent className={cn(glassDialog, 'max-w-2xl max-h-[85vh] overflow-y-auto')}>
                            <DialogHeader>
                                <DialogTitle>Edit Payslip</DialogTitle>
                                <DialogDescription>
                                    Edit payslip details for Worker ID: {editingPayslip?.worker_id}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Basic Pay</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.basic_pay}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, basic_pay: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">OT Pay</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.ot_pay}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, ot_pay: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Sun/PH Pay</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.sun_ph_pay}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, sun_ph_pay: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Monthly Allowance</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.monthly_allowance}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, monthly_allowance: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Incentive Allowance</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.incentive_allowance}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, incentive_allowance: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Bonus</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={payslipEditForm.bonus}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, bonus: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Amount actually paid</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="Blank = paid in full"
                                            value={payslipEditForm.amount_paid ?? ''}
                                            onChange={(e) => setPayslipEditForm({ ...payslipEditForm, amount_paid: e.target.value })}
                                        />
                                        <p className="text-[11px] text-slate-500">
                                            The difference from the amount payable is carried forward as a pay balance.
                                        </p>
                                    </div>
                                    {editingPayslip?.worker_type === 'local' && (
                                        <>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">CPF Employee Deduction</label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={payslipEditForm.cpf_employee_deduction}
                                                    onChange={(e) => setPayslipEditForm({ ...payslipEditForm, cpf_employee_deduction: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">SINDA Deduction</label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={payslipEditForm.sinda_deduction}
                                                    onChange={(e) => setPayslipEditForm({ ...payslipEditForm, sinda_deduction: e.target.value })}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setEditingPayslip(null)}>
                                    Cancel
                                </Button>
                                <Button 
                                    onClick={() => {
                                        updatePayslip.mutate({
                                            payslipId: editingPayslip.id,
                                            updates: payslipEditForm
                                        });
                                    }}
                                    disabled={updatePayslip.isPending} className="w-full sm:w-auto bg-slate-600 hover:bg-slate-700">
                                    {updatePayslip.isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        'Update Payslip'
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Admin Decline Timesheet Dialog */}
                    <Dialog open={!!adminDeclineTimesheetDialog} onOpenChange={(open) => !open && (setAdminDeclineTimesheetDialog(null), setAdminDeclineReason(''))}>
                        <DialogContent className={glassDialog}>
                            <DialogHeader>
                                <DialogTitle>Decline Timesheet</DialogTitle>
                                <DialogDescription>Provide a reason for declining. Worker will need to resubmit.</DialogDescription>
                            </DialogHeader>
                            <Textarea placeholder="Reason for declining..." value={adminDeclineReason} onChange={(e) => setAdminDeclineReason(e.target.value)} rows={3} />
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto" variant="outline" onClick={() => { setAdminDeclineTimesheetDialog(null); setAdminDeclineReason(''); }}>Cancel</Button>
                                <Button className="w-full sm:w-auto" variant="destructive" onClick={() => adminDeclineTimesheet.mutate({ id: adminDeclineTimesheetDialog?.id, reason: adminDeclineReason })} disabled={adminDeclineTimesheet.isPending}>
                                    {adminDeclineTimesheet.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Decline'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    
                    {/* Worker Information Tab */}
                    <TabsContent value="worker-info" className="mt-6">
                        {activeDashboardTab === 'worker-info' && (
                            <Suspense fallback={<PageLoader />}>
                                <WorkerInfoTab />
                            </Suspense>
                        )}
                    </TabsContent>

                    {!UNIFIED ? (
                        <TabsContent value="sites" className="mt-6">
                            {activeDashboardTab === 'sites' && (
                                <Suspense fallback={<PageLoader />}>
                                    <SitesTab />
                                </Suspense>
                            )}
                        </TabsContent>
                    ) : null}

                    <TabsContent value="vehicles" className="mt-6">
                        {activeDashboardTab === 'vehicles' && (
                            <Suspense fallback={<PageLoader />}>
                                <VehiclesTab />
                            </Suspense>
                        )}
                    </TabsContent>
                </Tabs>
                </AdminDashProvider>
            </div>

    <Dialog
        open={!!siteQrPreview}
        onOpenChange={(open) => {
            if (!open) setSiteQrPreview(null);
        }}
    >
        <DialogContent className={cn(glassDialog, 'max-w-md gap-4')}>
            <DialogHeader>
                <DialogTitle className="pr-8">{siteQrPreview?.site_name}</DialogTitle>
                <DialogDescription>
                    Use this code for worker check-in at this site. Save the image or copy the token.
                </DialogDescription>
            </DialogHeader>
            {siteQrPreview?.dataUrl ? (
                <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-4">
                    <img
                        src={siteQrPreview.dataUrl}
                        alt={`QR code for ${siteQrPreview.site_name}`}
                        className="h-56 w-56 max-w-full object-contain sm:h-64 sm:w-64"
                    />
                </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                    type="button"
                    className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                    onClick={() => {
                        if (!siteQrPreview) return;
                        downloadSiteQr({
                            qr_token: siteQrPreview.qr_token,
                            site_name: siteQrPreview.site_name
                        });
                    }}
                >
                    Download PNG
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                        if (!siteQrPreview?.qr_token) return;
                        try {
                            await navigator.clipboard.writeText(siteQrPreview.qr_token);
                            toast.success('QR token copied');
                        } catch {
                            toast.error('Failed to copy');
                        }
                    }}
                >
                    Copy token
                </Button>
            </div>
        </DialogContent>
    </Dialog>

    <Dialog open={showAddSiteDialog} onOpenChange={setShowAddSiteDialog}>
        <DialogContent className={cn(glassDialog, 'max-w-2xl')}>
            <DialogHeader>
                <DialogTitle>Add Site</DialogTitle>
                <DialogDescription>
                    Create a new site and generate a QR token for scanning.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Site Name</label>
                        <Input
                            value={siteFormData.site_name}
                            onChange={(e) => setSiteFormData({ ...siteFormData, site_name: e.target.value })}
                            placeholder="e.g. Kaki Bukit Office"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Site ID</label>
                        <Input value={siteFormData.id} readOnly className="font-mono text-xs" />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Latitude</label>
                        <Input
                            value={siteFormData.latitude}
                            onChange={(e) => setSiteFormData({ ...siteFormData, latitude: e.target.value })}
                            placeholder="1.300000"
                        />
                        <p className="text-xs text-slate-500">Optional. Empty = no coordinates (QR only).</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Longitude</label>
                        <Input
                            value={siteFormData.longitude}
                            onChange={(e) => setSiteFormData({ ...siteFormData, longitude: e.target.value })}
                            placeholder="103.800000"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSiteFormData({ ...siteFormData, latitude: '', longitude: '' })}
                        >
                            Clear GPS
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">QR Token</label>
                        <Input value={siteFormData.qr_token} readOnly className="font-mono text-xs" />
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(siteFormData.qr_token || '');
                                        toast.success('QR token copied');
                                    } catch {
                                        toast.error('Failed to copy');
                                    }
                                }}
                            >
                                Copy Token
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    const newToken = generateQrToken(siteFormData.site_name);
                                    setSiteFormData({ ...siteFormData, qr_token: newToken });
                                }}
                            >
                                Regenerate
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">QR Code</label>
                        <div className="border border-slate-200 rounded-md p-3 flex items-center justify-center bg-white">
                            {siteQrDataUrl ? (
                                <img src={siteQrDataUrl} alt="QR Code" className="w-40 h-40" />
                            ) : (
                                <span className="text-sm text-slate-500">QR preview not available</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowAddSiteDialog(false)}>
                    Cancel
                </Button>
                <Button
                    className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900 w-full sm:w-auto"
                    disabled={addSiteMutation.isPending}
                    onClick={() => {
                        const site_name = siteFormData.site_name.trim();
                        if (!site_name) {
                            toast.error('Site name is required');
                            return;
                        }

                        const coords = normalizeOptionalSiteGps(siteFormData.latitude, siteFormData.longitude);
                        if (coords.error) {
                            toast.error(coords.error);
                            return;
                        }

                        addSiteMutation.mutate({
                            id: siteFormData.id || generateId(),
                            site_name,
                            latitude: coords.latitude,
                            longitude: coords.longitude,
                            qr_token: siteFormData.qr_token || generateQrToken(site_name)
                        });
                    }}
                >
                    {addSiteMutation.isPending ? 'Adding...' : 'Add Site'}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <Dialog open={showEditSiteDialog} onOpenChange={setShowEditSiteDialog}>
        <DialogContent className={cn(glassDialog, 'max-w-2xl')}>
            <DialogHeader>
                <DialogTitle>Edit Site</DialogTitle>
                <DialogDescription>
                    Update site details and QR token.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Site Name</label>
                        <Input
                            value={siteFormData.site_name}
                            onChange={(e) => setSiteFormData({ ...siteFormData, site_name: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Site ID</label>
                        <Input value={siteFormData.id} readOnly className="font-mono text-xs" />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Latitude</label>
                        <Input
                            value={siteFormData.latitude}
                            onChange={(e) => setSiteFormData({ ...siteFormData, latitude: e.target.value })}
                        />
                        <p className="text-xs text-slate-500">Optional. Empty = no coordinates (QR only).</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Longitude</label>
                        <Input
                            value={siteFormData.longitude}
                            onChange={(e) => setSiteFormData({ ...siteFormData, longitude: e.target.value })}
                            placeholder="Leave empty for QR only"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSiteFormData({ ...siteFormData, latitude: '', longitude: '' })}
                        >
                            Clear GPS
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">QR Token</label>
                        <Input value={siteFormData.qr_token} readOnly className="font-mono text-xs" />
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(siteFormData.qr_token || '');
                                        toast.success('QR token copied');
                                    } catch {
                                        toast.error('Failed to copy');
                                    }
                                }}
                            >
                                Copy Token
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    const newToken = generateQrToken(siteFormData.site_name);
                                    setSiteFormData({ ...siteFormData, qr_token: newToken });
                                }}
                            >
                                Regenerate
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => downloadSiteQr({ qr_token: siteFormData.qr_token, site_name: siteFormData.site_name })}
                            >
                                Download QR
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">QR Code</label>
                        <div className="border border-slate-200 rounded-md p-3 flex items-center justify-center bg-white">
                            {siteQrDataUrl ? (
                                <img src={siteQrDataUrl} alt="QR Code" className="w-40 h-40" />
                            ) : (
                                <span className="text-sm text-slate-500">QR preview not available</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => {
                        setShowEditSiteDialog(false);
                        setEditingSite(null);
                    }}
                >
                    Close
                </Button>
                <Button
                    className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
                    disabled={updateSiteMutation.isPending}
                    onClick={() => {
                        if (!siteFormData.id) {
                            toast.error('Missing site id');
                            return;
                        }
                        const site_name = siteFormData.site_name.trim();
                        if (!site_name) {
                            toast.error('Site name is required');
                            return;
                        }

                        const coords = normalizeOptionalSiteGps(siteFormData.latitude, siteFormData.longitude);
                        if (coords.error) {
                            toast.error(coords.error);
                            return;
                        }

                        const qr_token = siteFormData.qr_token || generateQrToken(site_name);

                        updateSiteMutation.mutate({
                            id: siteFormData.id,
                            updates: { site_name, latitude: coords.latitude, longitude: coords.longitude, qr_token }
                        });
                    }}
                >
                    {updateSiteMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <Dialog open={!!pendingDeleteSite} onOpenChange={(open) => !open && setPendingDeleteSite(null)}>
        <DialogContent className={glassDialog}>
            <DialogHeader>
                <DialogTitle>Delete Site</DialogTitle>
                <DialogDescription>
                    This will delete the site: {pendingDeleteSite?.site_name}
                </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setPendingDeleteSite(null)}>
                    Cancel
                </Button>
                <Button className="w-full sm:w-auto"
                    variant="destructive"
                    disabled={deleteSiteMutation.isPending}
                    onClick={() => {
                        if (!pendingDeleteSite?.id) return;
                        deleteSiteMutation.mutate(pendingDeleteSite.id);
                    }}
                >
                    {deleteSiteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {/* Worker Type Selection Dialog for Printing */}
    <Dialog open={printWorkerTypeDialog} onOpenChange={setPrintWorkerTypeDialog}>
        <DialogContent className={glassDialog}>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5">
                    <AdminToneIcon icon={Printer} tone="sky" />
                    Print Timesheet & Payslip
                </DialogTitle>
                <DialogDescription>
                    Choose a worker type for one worker, or print several workers at once. Local payslips include CPF and SINDA.
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2 sm:flex-row">
                <AdminChoiceCard
                    icon={User}
                    tone="sky"
                    title="Local worker"
                    subtitle="Singapore Citizen / PR"
                    hint="Includes CPF and SINDA"
                    onClick={() => {
                        setPrintSelectedWorkerType('local');
                        setPrintWorkerTypeDialog(false);
                        setShowPrintDialog(true);
                    }}
                />
                <AdminChoiceCard
                    icon={Users}
                    tone="emerald"
                    title="Foreign worker"
                    subtitle="Non-Singaporean"
                    hint="Standard payroll"
                    onClick={() => {
                        setPrintSelectedWorkerType('foreign');
                        setPrintWorkerTypeDialog(false);
                        setShowPrintDialog(true);
                    }}
                />
                <AdminChoiceCard
                    icon={UserCheck}
                    tone="violet"
                    title="Multiple workers"
                    subtitle="Several IDs"
                    hint="Configure each worker, print together"
                    onClick={() => {
                        setPrintWorkerTypeDialog(false);
                        setMultiPrintStep(1);
                        setShowMultiPrintDialog(true);
                    }}
                />
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                    variant="outline"
                    className="h-11 rounded-xl w-full sm:w-auto"
                    onClick={() => setPrintWorkerTypeDialog(false)}
                >
                    Cancel
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {/* Multi Print Dialog */}
    <Dialog open={showMultiPrintDialog} onOpenChange={(open) => { if (!open && !multiPrintProgress.isGenerating) resetMultiPrint(); }}>
        <DialogContent className={cn(glassDialog, 'max-w-3xl max-h-[85vh] overflow-y-auto')}>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5">
                    <AdminToneIcon icon={Printer} tone="violet" />
                    Print Timesheets & Payslips — Multiple Workers
                </DialogTitle>
                <DialogDescription>
                    {multiPrintStep === 1
                        ? 'Enter the month and the worker IDs to print together.'
                        : 'Adjust the payslip details for each worker, then print everything in one go.'}
                </DialogDescription>
            </DialogHeader>

            {multiPrintStep === 1 && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <AdminFieldLabel>Month</AdminFieldLabel>
                        <Input
                            type="month"
                            className={glassInput}
                            value={multiPrintMonth}
                            onChange={(e) => setMultiPrintMonth(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Worker IDs (comma or space separated)</AdminFieldLabel>
                        <Input
                            placeholder="e.g. 1001, 1002, 1003"
                            className={glassInput}
                            value={multiPrintIds}
                            onChange={(e) => setMultiPrintIds(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Default Salary Paid Date (optional, editable per worker)</AdminFieldLabel>
                        <Input
                            type="date"
                            className={glassInput}
                            value={multiPrintSalaryPaidDate}
                            onChange={(e) => setMultiPrintSalaryPaidDate(e.target.value)}
                        />
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="h-11 rounded-xl w-full sm:w-auto" onClick={resetMultiPrint}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleMultiPrintLoadWorkers}
                            disabled={!multiPrintMonth || !multiPrintIds.trim()}
                            className="h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)] w-full sm:w-auto"
                        >
                            Next
                        </Button>
                    </DialogFooter>
                </div>
            )}

            {multiPrintStep === 2 && (
                <div className="space-y-4">
                    <div className="text-sm text-slate-600">
                        Month: {(() => {
                            const [y, m] = multiPrintMonth.split('-');
                            return `${String(m).padStart(2, '0')}/${y}`;
                        })()} · {multiPrintWorkers.length} worker{multiPrintWorkers.length !== 1 ? 's' : ''}
                    </div>
                    <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
                        {multiPrintWorkers.map((worker, index) => (
                            <div key={worker.employee_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="mb-2 flex items-start justify-between gap-2">
                                    <div>
                                        <div className="font-medium">{worker.employee_name || worker.employee_id}</div>
                                        <div className="text-sm text-slate-600">ID: {worker.employee_id} | Type: {worker.worker_type}</div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                                        disabled={multiPrintProgress.isGenerating}
                                        onClick={() => setMultiPrintWorkers((prev) => prev.filter((_, i) => i !== index))}
                                    >
                                        Remove
                                    </Button>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Salary Paid Date</label>
                                        <Input
                                            type="date"
                                            value={worker.salary_paid_date || ''}
                                            onChange={(e) => updateMultiPrintWorker(index, { salary_paid_date: e.target.value })}
                                            className="text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Bonus</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={worker.bonus}
                                            onChange={(e) => updateMultiPrintWorker(index, { bonus: e.target.value })}
                                            className="text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Additions</label>
                                        {worker.additions.map((addition, addIndex) => (
                                            <div key={addIndex} className="flex gap-1">
                                                <Input
                                                    placeholder="Name"
                                                    value={addition.name}
                                                    onChange={(e) => updateMultiPrintWorker(index, {
                                                        additions: worker.additions.map((a, i) => (i === addIndex ? { ...a, name: e.target.value } : a)),
                                                    })}
                                                    className="flex-1 text-xs"
                                                />
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={addition.value}
                                                    onChange={(e) => updateMultiPrintWorker(index, {
                                                        additions: worker.additions.map((a, i) => (i === addIndex ? { ...a, value: e.target.value } : a)),
                                                    })}
                                                    className="w-20 text-xs"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="px-2 text-xs"
                                                    onClick={() => {
                                                        const next = worker.additions.filter((_, i) => i !== addIndex);
                                                        updateMultiPrintWorker(index, { additions: next.length > 0 ? next : [{ name: '', value: '' }] });
                                                    }}
                                                >
                                                    ×
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs"
                                            onClick={() => updateMultiPrintWorker(index, { additions: [...worker.additions, { name: '', value: '' }] })}
                                        >
                                            + Add
                                        </Button>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Deductions</label>
                                        {worker.deductions.map((deduction, dedIndex) => (
                                            <div key={dedIndex} className="flex gap-1">
                                                <Input
                                                    placeholder="Type"
                                                    value={deduction.type}
                                                    onChange={(e) => updateMultiPrintWorker(index, {
                                                        deductions: worker.deductions.map((d, i) => (i === dedIndex ? { ...d, type: e.target.value } : d)),
                                                    })}
                                                    className="flex-1 text-xs"
                                                />
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={deduction.amount}
                                                    onChange={(e) => updateMultiPrintWorker(index, {
                                                        deductions: worker.deductions.map((d, i) => (i === dedIndex ? { ...d, amount: e.target.value } : d)),
                                                    })}
                                                    className="w-20 text-xs"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="px-2 text-xs"
                                                    onClick={() => {
                                                        const next = worker.deductions.filter((_, i) => i !== dedIndex);
                                                        updateMultiPrintWorker(index, { deductions: next.length > 0 ? next : [{ type: '', amount: '' }] });
                                                    }}
                                                >
                                                    ×
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs"
                                            onClick={() => updateMultiPrintWorker(index, { deductions: [...worker.deductions, { type: '', amount: '' }] })}
                                        >
                                            + Add
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {multiPrintProgress.isGenerating && (
                        <div className="rounded-xl border bg-slate-50 px-4 py-3">
                            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
                                <span className="font-medium">Preparing documents...</span>
                                <span className="font-semibold">{multiPrintProgress.current} / {multiPrintProgress.total}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                                <div
                                    className="h-1.5 rounded-full bg-[var(--g-brand)] transition-all duration-200 ease-out"
                                    style={{ width: `${multiPrintProgress.total > 0 ? (multiPrintProgress.current / multiPrintProgress.total) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button
                            variant="outline"
                            className="h-11 rounded-xl w-full sm:w-auto"
                            onClick={() => setMultiPrintStep(1)}
                            disabled={multiPrintProgress.isGenerating}
                        >
                            Back
                        </Button>
                        <Button
                            onClick={handleMultiPrintAll}
                            disabled={multiPrintWorkers.length === 0 || multiPrintProgress.isGenerating}
                            className="h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)] w-full sm:w-auto"
                        >
                            {multiPrintProgress.isGenerating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Preparing...
                                </>
                            ) : (
                                <>
                                    <Printer className="mr-2 h-4 w-4" />
                                    Print All ({multiPrintWorkers.length})
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            )}
        </DialogContent>
    </Dialog>

    {/* Print Timesheet Dialog */}
    <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
                <DialogContent className={cn(glassDialog, 'max-w-2xl max-h-[85vh] overflow-y-auto')}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2.5">
                            <AdminToneIcon icon={Printer} tone="sky" />
                            Print Timesheet & Payslip
                        </DialogTitle>
                        <DialogDescription>
                            Generate a timesheet and payslip for a specific worker for a calendar month.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <AdminFieldLabel>Worker ID</AdminFieldLabel>
                            <Input
                                placeholder="Enter Worker ID"
                                className={glassInput}
                                value={printWorkerId}
                                onChange={(e) => setPrintWorkerId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Month</AdminFieldLabel>
                            <Input
                                type="month"
                                className={glassInput}
                                value={printMonthYear}
                                onChange={(e) => setPrintMonthYear(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Date of Salary Paid (Optional)</AdminFieldLabel>
                            <Input
                                type="date"
                                className={glassInput}
                                value={printSalaryPaidDate}
                                onChange={(e) => setPrintSalaryPaidDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Bonus (Optional)</AdminFieldLabel>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                className={glassInput}
                                value={printBonus}
                                onChange={(e) => setPrintBonus(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Additional Additions</AdminFieldLabel>
                            {printAdditions.map((addition, index) => (
                                <div key={index} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                                    <div className="flex-1">
                                        <Input
                                            placeholder="Addition Name"
                                            className={glassInput}
                                            value={addition.name}
                                            onChange={(e) => {
                                                const newAdditions = [...printAdditions];
                                                newAdditions[index].name = e.target.value;
                                                setPrintAdditions(newAdditions);
                                            }}
                                        />
                                    </div>
                                    <div className="w-24">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            className={glassInput}
                                            value={addition.value}
                                            onChange={(e) => {
                                                const newAdditions = [...printAdditions];
                                                newAdditions[index].value = e.target.value;
                                                setPrintAdditions(newAdditions);
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-11 rounded-xl"
                                        onClick={() => {
                                            const newAdditions = printAdditions.filter((_, i) => i !== index);
                                            setPrintAdditions(newAdditions.length > 0 ? newAdditions : [{ name: '', value: '' }]);
                                        }}
                                        disabled={printAdditions.length === 1}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-xl"
                                onClick={() => setPrintAdditions([...printAdditions, { name: '', value: '' }])}
                            >
                                Add Addition
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Deductions</AdminFieldLabel>
                            {printDeductions.map((deduction, index) => (
                                <div key={index} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                                    <div className="flex-1">
                                        <Input
                                            placeholder="Deduction Type"
                                            className={glassInput}
                                            value={deduction.type}
                                            onChange={(e) => {
                                                const newDeductions = [...printDeductions];
                                                newDeductions[index].type = e.target.value;
                                                setPrintDeductions(newDeductions);
                                            }}
                                        />
                                    </div>
                                    <div className="w-24">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            className={glassInput}
                                            value={deduction.amount}
                                            onChange={(e) => {
                                                const newDeductions = [...printDeductions];
                                                newDeductions[index].amount = e.target.value;
                                                setPrintDeductions(newDeductions);
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-11 rounded-xl"
                                        onClick={() => {
                                            const newDeductions = printDeductions.filter((_, i) => i !== index);
                                            setPrintDeductions(newDeductions.length > 0 ? newDeductions : [{ type: '', amount: '' }]);
                                        }}
                                        disabled={printDeductions.length === 1}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-xl"
                                onClick={() => setPrintDeductions([...printDeductions, { type: '', amount: '' }])}
                            >
                                Add Deduction
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button
                            variant="outline"
                            className="h-11 rounded-xl w-full sm:w-auto"
                            onClick={() => {
                                setShowPrintDialog(false);
                                setPrintWorkerId('');
                                setPrintMonthYear('');
                                setPrintSalaryPaidDate('');
                                setPrintBonus('');
                                setPrintAdditions([{ name: '', value: '' }]);
                                setPrintDeductions([{ type: '', amount: '' }]);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={() => {
                                if (printWorkerId && printMonthYear) {
                                    printTimesheetAndPayslip(printWorkerId, printMonthYear, printDeductions, printSalaryPaidDate, printBonus, printAdditions);
                                    setShowPrintDialog(false);
                                    setPrintWorkerId('');
                                    setPrintMonthYear('');
                                    setPrintSalaryPaidDate('');
                                    setPrintBonus('');
                                    setPrintAdditions([{ name: '', value: '' }]);
                                    setPrintDeductions([{ type: '', amount: '' }]);
                                }
                            }} className="w-full sm:w-auto h-11 rounded-xl bg-sky-600 hover:bg-sky-700">
                            <Printer className="w-4 h-4 mr-2" />
                            Print Timesheet & Payslip
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete All History</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. Please enter the PIN to confirm deletion of all shift history.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input
                            type="password"
                            placeholder="Enter PIN"
                            value={deletePin}
                            onChange={(e) => {
                                setDeletePin(e.target.value);
                                setDeletePinError('');
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleDeleteHistory();
                                }
                            }}
                        />
                        {deletePinError && (
                            <p className="text-sm text-red-600">{deletePinError}</p>
                        )}
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto"
                            variant="outline"
                            onClick={() => {
                                setShowDeleteDialog(false);
                                setDeletePin('');
                                setDeletePinError('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button className="w-full sm:w-auto"
                            variant="destructive"
                            onClick={handleDeleteHistory}
                            disabled={deleteAllMutation.isPending}
                        >
                            {deleteAllMutation.isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete All'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Individual Shift Delete PIN Dialog */}
            <Dialog open={showIndividualDeletePinDialog} onOpenChange={setShowIndividualDeletePinDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Shift</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. Please enter the PIN to confirm deletion of this shift.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input
                            type="password"
                            placeholder="Enter PIN"
                            value={individualDeletePin}
                            onChange={(e) => {
                                setIndividualDeletePin(e.target.value);
                                setIndividualDeletePinError('');
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleIndividualDelete();
                                }
                            }}
                        />
                        {individualDeletePinError && (
                            <p className="text-sm text-red-600">{individualDeletePinError}</p>
                        )}
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto"
                            variant="outline"
                            onClick={() => {
                                setShowIndividualDeletePinDialog(false);
                                setIndividualDeletePin('');
                                setIndividualDeletePinError('');
                                setPendingDeleteShiftId(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button className="w-full sm:w-auto"
                            variant="destructive"
                            onClick={handleIndividualDelete}
                            disabled={deleteShiftMutation.isPending}
                        >
                            {deleteShiftMutation.isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete Shift'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

    {/* Worker Type Selection Dialog */}
    <Dialog open={showWorkerTypeDialog} onOpenChange={setShowWorkerTypeDialog}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Select Worker Type</DialogTitle>
                <DialogDescription>
                    Choose whether to add a Local Singaporean worker or a Foreign worker.
                </DialogDescription>
            </DialogHeader>
            <div className="flex gap-4 justify-center py-6">
                <Button
                    onClick={() => {
                        setSelectedWorkerType('local');
                        setShowWorkerTypeDialog(false);
                        setShowAddWorkerDialog(true);
                    }}
                    className="flex flex-col items-center gap-3 p-6 h-auto bg-blue-600 hover:bg-blue-700"
                >
                    <User className="w-12 h-12" />
                    <div className="text-center">
                        <div className="font-semibold">Local Worker</div>
                        <div className="text-sm opacity-90">Singapore Citizen/PR</div>
                        <div className="text-xs opacity-75 mt-1">CPF & SINDA calculations</div>
                    </div>
                </Button>
                <Button
                    onClick={() => {
                        setSelectedWorkerType('foreign');
                        setShowWorkerTypeDialog(false);
                        setShowAddWorkerDialog(true);
                    }}
                    className="flex flex-col items-center gap-3 p-6 h-auto bg-green-600 hover:bg-green-700"
                >
                    <User className="w-12 h-12" />
                    <div className="text-center">
                        <div className="font-semibold">Foreign Worker</div>
                        <div className="text-xs opacity-90">Non-Singaporean</div>
                        <div className="text-xs opacity-75 mt-1">Standard payroll</div>
                    </div>
                </Button>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => setShowWorkerTypeDialog(false)}
                >
                    Cancel
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {/* Add Worker Dialog */}
    <Dialog open={showAddWorkerDialog} onOpenChange={setShowAddWorkerDialog}>
                <DialogContent className={moduleSheetDialog('max-w-4xl')}>
                    <DialogHeader>
                        <DialogTitle>Add New Worker</DialogTitle>
                        <DialogDescription>
                            Enter the worker's details to create a new profile.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee ID</label>
                            <Input
                                placeholder="Employee ID"
                                value={workerFormData.employee_id}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, employee_id: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">NRIC/FIN</label>
                            <Input
                                placeholder="NRIC/FIN"
                                value={workerFormData.nric_fin}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, nric_fin: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee Name</label>
                            <Input
                                placeholder="Employee Name"
                                value={workerFormData.employee_name}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, employee_name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Designation</label>
                            <Input
                                placeholder="Designation"
                                value={workerFormData.designation}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, designation: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date Joined</label>
                            <Input
                                type="date"
                                value={workerFormData.date_joined}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, date_joined: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Bank Account Number</label>
                            <Input
                                placeholder="Bank Account Number"
                                value={workerFormData.bank_account_number}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, bank_account_number: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">OT Rate per Hour ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.ot_rate_per_hour}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, ot_rate_per_hour: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sun/PH Rate per Day ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.sun_ph_rate_per_day}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, sun_ph_rate_per_day: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Basic Salary per Month ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.basic_salary_per_day}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, basic_salary_per_day: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Monthly Allowance ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="150.00"
                                value={workerFormData.monthly_allowance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, monthly_allowance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Annual Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="10"
                                value={workerFormData.annual_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, annual_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Medical Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="14"
                                value={workerFormData.medical_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, medical_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Hospitalization Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="60"
                                value={workerFormData.hospitalization_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, hospitalization_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Annual Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="10"
                                value={workerFormData.annual_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, annual_leave_balance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Medical Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="14"
                                value={workerFormData.medical_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, medical_leave_balance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Hospitalization Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="60"
                                value={workerFormData.hospitalization_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, hospitalization_leave_balance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Login password</label>
                            <Input
                                type="text"
                                placeholder="Password for worker login"
                                value={workerFormData.password}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, password: e.target.value })}
                            />
                        </div>

                        {/* Local Worker Specific Fields */}
                        {selectedWorkerType === 'local' && (
                            <>
                                <div className="col-span-full border-t pt-4 mt-4">
                                    <h3 className="text-lg font-semibold text-slate-700 mb-4">Local Worker Details (CPF & SINDA)</h3>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Date of Birth *</label>
                                    <Input
                                        type="date"
                                        value={workerFormData.birthday}
                                        onChange={(e) => {
                                            const newBirthday = e.target.value;
                                            setWorkerFormData({ ...workerFormData, birthday: newBirthday });

                                            // Auto-calculate CPF and SINDA when birthday changes
                                            if (newBirthday) {
                                                const age = calculateAge(newBirthday);
                                                const cpfEmployee = getCPFEmployeeRate(age);
                                                const cpfEmployer = getCPFEmployerRate(age);

                                                setCalculatedCPFEmployee(cpfEmployee);
                                                setCalculatedCPFEmployer(cpfEmployer);
                                                setCalculatedSINDA(0);
                                            }
                                        }}
                                    />
                                </div>

                                {/* Auto-calculation Preview Boxes */}
                                <div className="col-span-full space-y-3 mt-4">
                                    <h4 className="text-sm font-medium text-slate-600">Contribution Calculations</h4>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <div className="text-xs text-blue-600 font-medium">CPF Employee (%)</div>
                                            <div className="text-lg font-bold text-blue-800">{calculatedCPFEmployee.toFixed(2)}%</div>
                                        </div>

                                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                            <div className="text-xs text-green-600 font-medium">CPF Employer (%)</div>
                                            <div className="text-lg font-bold text-green-800">{calculatedCPFEmployer.toFixed(2)}%</div>
                                        </div>
                                    </div>

                                    <div className="text-xs text-slate-500 mt-2">
                                        Note: SINDA contribution will be calculated from employee's total monthly salary and deducted from their pay.
                                    </div>
                                    <div className="flex items-center space-x-2 mt-3">
                                        <input
                                            type="checkbox"
                                            id="sinda_eligible_add"
                                            checked={!!workerFormData.sinda_eligible}
                                            onChange={(e) => setWorkerFormData({ ...workerFormData, sinda_eligible: e.target.checked })}
                                            className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                                        />
                                        <label htmlFor="sinda_eligible_add" className="text-sm font-medium text-slate-700">
                                            SINDA eligible (Indian SHG — untick if opted out / not Indian descent)
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Face ID Management Section */}
                        <div className="col-span-2 space-y-4 border-t pt-4 mt-4">
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="face_id_enabled_add"
                                    checked={workerFormData.face_id_enabled}
                                    onChange={(e) => setWorkerFormData({ ...workerFormData, face_id_enabled: e.target.checked })}
                                    className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                                />
                                <label htmlFor="face_id_enabled_add" className="text-sm font-medium text-slate-700">
                                    Enable Face ID (Required for login if enabled)
                                </label>
                            </div>
                            <p className="text-xs text-slate-500">
                                If enabled, workers will need to enroll their face ID on first login. If disabled, workers can login with password only.
                            </p>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto"
                            variant="outline"
                            onClick={() => setShowAddWorkerDialog(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddWorker}
                            disabled={addWorkerMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                        >
                            {addWorkerMutation.isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Adding...
                                </>
                            ) : (
                                'Add Worker'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Worker Search Dialog */}
            <Dialog
                open={showWorkerSearchDialog}
                onOpenChange={(open) => {
                    setShowWorkerSearchDialog(open);
                    if (!open) {
                        setWorkerSearchResult(null);
                    }
                }}
            >
                <DialogContent className={moduleSheetDialog('max-w-5xl')}>
                    <DialogHeader>
                        <DialogTitle>{t('ui.searchWorker')}</DialogTitle>
                        <DialogDescription>
                            Enter an employee ID to search local and foreign worker tables, then review profile details and passed-out documents.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Employee ID</label>
                            <Input
                                placeholder="e.g. 1001"
                                value={workerSearchId}
                                onChange={(e) => setWorkerSearchId(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') runWorkerSearch();
                                }}
                            />
                        </div>
                        <Button
                            className="h-10 shrink-0 bg-amber-600 hover:bg-amber-700"
                            onClick={runWorkerSearch}
                            disabled={workerSearchLoading || !workerSearchId.trim()}
                        >
                            {workerSearchLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Searching…
                                </>
                            ) : (
                                <>
                                    <Search className="mr-2 h-4 w-4" />
                                    Search
                                </>
                            )}
                        </Button>
                    </div>

                    {workerSearchResult && (() => {
                        const { worker, type, timesheets, payslips } = workerSearchResult;
                        const displayName = worker.employee_name || worker.name || worker.employee_id;
                        const passwordSet = hasWorkerPasswordSet(worker.password_hash || worker.password || '');
                        const notInCompany = workerIsNotInCompany(worker);
                        const profileFields = [
                            { label: 'Employee ID', value: worker.employee_id },
                            { label: 'Worker type', value: type === 'local' ? 'Local (Singapore / PR)' : 'Foreign (work pass)' },
                            { label: 'Name', value: displayName },
                            { label: 'NRIC/FIN', value: worker.nric_fin || '—' },
                            { label: 'Designation', value: worker.designation || '—' },
                            { label: 'Date joined', value: worker.date_joined || '—' },
                            { label: 'Date of cessation', value: worker.date_of_cessation || '—' },
                            { label: 'Rejoin dates', value: formatRejoinDatesCell(worker) },
                            { label: 'In company', value: notInCompany ? 'No' : 'Yes' },
                            { label: 'Bank account', value: worker.bank_account_number || '—' },
                            { label: 'Basic salary / day', value: formatAmount(worker.basic_salary_per_day) },
                            { label: 'Monthly allowance', value: formatAmount(worker.monthly_allowance) },
                            { label: 'OT rate / hour', value: formatAmount(worker.ot_rate_per_hour) },
                            { label: 'Sun/PH rate / day', value: formatAmount(worker.sun_ph_rate_per_day) },
                            { label: 'Annual leave', value: `${worker.annual_leave_balance ?? '—'} / ${worker.annual_leave_limit ?? '—'}` },
                            { label: 'Medical leave', value: `${worker.medical_leave_balance ?? '—'} / ${worker.medical_leave_limit ?? '—'}` },
                            { label: 'Hospitalization leave', value: `${worker.hospitalization_leave_balance ?? '—'} / ${worker.hospitalization_leave_limit ?? '—'}` },
                            { label: 'Face ID', value: worker.face_id_enabled === false ? 'Disabled' : worker.face_id_set ? 'Enabled (enrolled)' : 'Enabled (not enrolled)' },
                        ];
                        if (type === 'local') {
                            profileFields.push(
                                { label: 'Birthday', value: worker.birthday || '—' },
                                { label: 'CPF employee %', value: worker.cpf_employee_contribution ?? '—' },
                                { label: 'CPF employer %', value: worker.cpf_employer_contribution ?? '—' },
                                { label: 'SINDA', value: formatAmount(worker.sinda_contribution) }
                            );
                        }

                        return (
                            <div className="mt-2 space-y-6">
                                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-lg font-semibold text-slate-900">{displayName}</h3>
                                            <Badge className={type === 'local' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-blue-100 text-blue-800 hover:bg-blue-100'}>
                                                {type === 'local' ? 'Local' : 'Foreign'}
                                            </Badge>
                                            {notInCompany && (
                                                <Badge variant="destructive">Not in company</Badge>
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-9 border-slate-300 bg-white text-slate-800 shadow-sm"
                                            onClick={handlePrintWorkerProfileFromSearch}
                                        >
                                            <Printer className="mr-2 h-4 w-4" />
                                            Print employee record
                                        </Button>
                                    </div>
                                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        <WorkerIdCard worker={worker} type={type} inCompany={!notInCompany} />
                                        {profileFields.map((field) => (
                                            <div key={field.label} className="rounded-lg border border-slate-200/80 bg-white px-3 py-2.5">
                                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{field.label}</p>
                                                <p className="mt-1 break-words text-sm font-medium text-slate-900">{field.value}</p>
                                            </div>
                                        ))}
                                        <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-2.5 sm:col-span-2 lg:col-span-3">
                                            <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Login password</p>
                                            <p className="mt-1 font-mono text-sm font-medium text-slate-900">
                                                {passwordSet ? '•••• (Set)' : '— Not set'}
                                            </p>
                                            <p className="mt-1 text-xs text-amber-800/80">
                                                Passwords are stored hashed and cannot be viewed. Reset via Edit Worker.
                                            </p>
                                        </div>
                                        <WorkerAccessPanel employeeId={worker.employee_id} />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h4 className="text-base font-semibold text-slate-900">Passed-out timesheets</h4>
                                        <span className="text-sm text-slate-500">{timesheets.length} record{timesheets.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    {timesheets.length > 0 ? (
                                        <div className="space-y-3">
                                            {timesheets.map((ts) => {
                                                const monthLabel = `${String(ts.month).padStart(2, '0')}/${ts.year}`;
                                                return (
                                                    <div
                                                        key={ts.id}
                                                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="font-medium text-slate-900">{monthLabel}</p>
                                                            <p className="mt-1 text-sm text-slate-600">{getPassedOutTimesheetStatusLabel(ts)}</p>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 border-slate-200 text-xs"
                                                                onClick={() => handleViewPassedOutTimesheet(ts)}
                                                            >
                                                                <FileText className="mr-1 h-3.5 w-3.5" /> View
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 border-slate-200 text-xs"
                                                                onClick={() => handleDownloadPassedOutTimesheet(ts)}
                                                            >
                                                                <Printer className="mr-1 h-3.5 w-3.5" /> Print
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center text-sm text-slate-600">
                                            No passed-out timesheets for this worker.
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h4 className="text-base font-semibold text-slate-900">Passed-out payslips</h4>
                                        <span className="text-sm text-slate-500">{payslips.length} record{payslips.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    {payslips.length > 0 ? (
                                        <div className="space-y-3">
                                            {payslips.map((payslip) => {
                                                const periodLabel = payslip.start_date && payslip.end_date
                                                    ? `${formatDate(payslip.start_date)} → ${formatDate(payslip.end_date)}`
                                                    : payslip.payslip_date
                                                        ? formatDate(payslip.payslip_date)
                                                        : '—';
                                                return (
                                                    <div
                                                        key={payslip.id}
                                                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="font-medium text-slate-900">{periodLabel}</p>
                                                            <p className="mt-1 text-sm text-slate-600 capitalize">
                                                                {payslip.payslip_type || payslip.worker_type || type} payslip
                                                                {payslip.salary_paid_date ? ` · Paid ${formatDate(payslip.salary_paid_date)}` : ''}
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 border-slate-200 text-xs"
                                                                onClick={() => handleViewPassedOutPayslipReport(payslip)}
                                                            >
                                                                <FileText className="mr-1 h-3.5 w-3.5" /> View
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 border-slate-200 text-xs"
                                                                onClick={() => handlePrintPassedOutPayslipReport(payslip)}
                                                            >
                                                                <Printer className="mr-1 h-3.5 w-3.5" /> Print
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center text-sm text-slate-600">
                                            No passed-out payslips for this worker.
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-xl border border-brand-soft bg-gradient-to-br from-brand-soft to-slate-50 p-4 sm:p-5">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <h4 className="text-base font-semibold text-slate-900">Yearly pay summary</h4>
                                            <p className="mt-1 text-sm text-slate-600">
                                                Generate a formal annual summary from all passed-out payslips — monthly basic, OT, CPF, SINDA, SDL, and totals.
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            className="h-10 shrink-0 bg-brand-hover hover:bg-brand-hover"
                                            onClick={handleOpenYearlySummaryDialog}
                                            disabled={payslips.length === 0}
                                        >
                                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                                            Generate summary
                                        </Button>
                                    </div>
                                    {payslips.length === 0 && (
                                        <p className="mt-2 text-xs text-slate-500">Pass out at least one payslip before generating a yearly summary.</p>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowWorkerSearchDialog(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Yearly pay summary — year picker */}
            <Dialog open={showYearlySummaryDialog} onOpenChange={setShowYearlySummaryDialog}>
                <DialogContent className={moduleSheetDialog('sm:max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>Yearly pay summary</DialogTitle>
                        <DialogDescription>
                            Select the calendar year to summarise all passed-out payslips for{' '}
                            {workerSearchResult?.worker?.employee_name || workerSearchResult?.worker?.employee_id || 'this worker'}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <label className="text-sm font-medium text-slate-700" htmlFor="yearly-summary-year">
                            Year
                        </label>
                        <Input
                            id="yearly-summary-year"
                            type="number"
                            min={2000}
                            max={2100}
                            value={yearlySummaryYear}
                            onChange={(e) => setYearlySummaryYear(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleGenerateYearlySummary();
                            }}
                        />
                        {workerSearchResult && yearlySummaryYear && (() => {
                            const preview = aggregateYearlyPaySummary(
                                workerSearchResult.payslips,
                                parseInt(yearlySummaryYear, 10),
                            );
                            return (
                                <p className="text-sm text-slate-600">
                                    {preview.payslipCount > 0
                                        ? `${preview.payslipCount} passed-out payslip(s) in ${preview.year} across ${preview.months.length} month(s).`
                                        : `No passed-out payslips found for ${yearlySummaryYear}.`}
                                </p>
                            );
                        })()}
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowYearlySummaryDialog(false)}>
                            Cancel
                        </Button>
                        <Button className="bg-brand-hover hover:bg-brand-hover w-full sm:w-auto" onClick={handleGenerateYearlySummary}>
                            <Printer className="mr-2 h-4 w-4" />
                            Generate &amp; print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Worker Type Selection Dialog for Edit */}
            <Dialog open={showEditWorkerTypeDialog} onOpenChange={setShowEditWorkerTypeDialog}>
                <DialogContent className={moduleSheetDialog('sm:max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>Select Worker Type</DialogTitle>
                        <DialogDescription>
                            Please select the type of worker you want to edit.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col space-y-4 py-4">
                        <Button 
                            onClick={() => handleEditWorkerTypeSelect('foreign')}
                            className="justify-start px-6 py-8 text-lg border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl shadow-sm"
                            variant="outline"
                        >
                            <div className="text-left">
                                <div className="font-semibold">Foreign Worker</div>
                                <div className="text-sm text-gray-500 mt-1">Edit a foreign worker's details</div>
                            </div>
                        </Button>
                        <Button 
                            onClick={() => handleEditWorkerTypeSelect('local')}
                            className="justify-start px-6 py-8 text-lg border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl shadow-sm"
                            variant="outline"
                        >
                            <div className="text-left">
                                <div className="font-semibold">Local Worker</div>
                                <div className="text-sm text-gray-500 mt-1">Edit a local worker's details including CPF and SINDA</div>
                            </div>
                        </Button>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" 
                            variant="outline" 
                            onClick={() => setShowEditWorkerTypeDialog(false)}
                        >
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Worker Dialog */}
            <Dialog open={showEditWorkerDialog} onOpenChange={setShowEditWorkerDialog}>
                <DialogContent className={moduleSheetDialog('max-w-4xl')}>
                    <DialogHeader>
                        <DialogTitle>Edit {selectedWorkerType === 'local' ? 'Local' : 'Foreign'} Worker</DialogTitle>
                        <DialogDescription>
                            Update the worker's information and salary details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-2">
                        {workerFormData.employee_id ? (
                            <div className="md:col-span-2">
                                <WorkerIdCard worker={workerFormData} type={selectedWorkerType} inCompany={workerFormData.in_company !== false} />
                            </div>
                        ) : null}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee ID</label>
                            <Input
                                placeholder="Employee ID"
                                value={workerFormData.employee_id}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, employee_id: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">NRIC/FIN</label>
                            <Input
                                placeholder="NRIC/FIN"
                                value={workerFormData.nric_fin}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, nric_fin: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Employee Name</label>
                            <Input
                                placeholder="Employee Name"
                                value={workerFormData.employee_name}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, employee_name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Designation</label>
                            <Input
                                placeholder="Designation"
                                value={workerFormData.designation}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, designation: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date Joined</label>
                            <Input
                                type="date"
                                value={workerFormData.date_joined}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, date_joined: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Bank Account Number</label>
                            <Input
                                placeholder="Bank Account Number"
                                value={workerFormData.bank_account_number}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, bank_account_number: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">OT Rate per Hour ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.ot_rate_per_hour}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, ot_rate_per_hour: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sun/PH Rate per Day ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.sun_ph_rate_per_day}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, sun_ph_rate_per_day: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Basic Salary per Month ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.basic_salary_per_day}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, basic_salary_per_day: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Monthly Allowance ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.monthly_allowance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, monthly_allowance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Incentive Allowance ($)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={workerFormData.incentive_allowance || ''}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, incentive_allowance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Login password</label>
                            <Input
                                type="password"
                                placeholder="Leave blank to keep; enter new password to reset"
                                value={workerFormData.password || ''}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, password: e.target.value })}
                                autoComplete="new-password"
                            />
                            {workerFormData.stored_password_encrypted && !workerFormData.password && (
                                <p className="text-xs text-amber-700">
                                    Password is hashed and cannot be shown. Enter a new password only if resetting.
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Annual Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="10"
                                value={workerFormData.annual_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, annual_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Medical Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="14"
                                value={workerFormData.medical_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, medical_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Hospitalization Leave Limit (Days)</label>
                            <Input
                                type="number"
                                placeholder="60"
                                value={workerFormData.hospitalization_leave_limit}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, hospitalization_leave_limit: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Annual Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="10"
                                value={workerFormData.annual_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, annual_leave_balance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Medical Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="14"
                                value={workerFormData.medical_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, medical_leave_balance: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Hospitalization Leave Balance</label>
                            <Input
                                type="number"
                                placeholder="60"
                                value={workerFormData.hospitalization_leave_balance}
                                onChange={(e) => setWorkerFormData({ ...workerFormData, hospitalization_leave_balance: e.target.value })}
                            />
                        </div>

                        {/* Local Worker Specific Fields */}
                        {selectedWorkerType === 'local' && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Date of Birth</label>
                                    <Input
                                        type="date"
                                        value={workerFormData.birthday || ''}
                                        onChange={(e) => {
                                            const newFormData = { ...workerFormData, birthday: e.target.value };
                                            // Recalculate CPF and SINDA when birthday changes
                                            if (e.target.value) {
                                                const age = calculateAge(e.target.value);
                                                newFormData.cpf_employee_contribution = getCPFEmployeeRate(age);
                                                newFormData.cpf_employer_contribution = getCPFEmployerRate(age);
                                                setCalculatedCPFEmployee(newFormData.cpf_employee_contribution);
                                                setCalculatedCPFEmployer(newFormData.cpf_employer_contribution);
                                                setCalculatedSINDA(0);
                                            }
                                            setWorkerFormData(newFormData);
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">CPF Employee Contribution (%)</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={calculatedCPFEmployee}
                                        readOnly
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">CPF Employer Contribution (%)</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={calculatedCPFEmployer}
                                        readOnly
                                    />
                                </div>
                                <div className="col-span-full space-y-2">
                                    <div className="text-xs text-slate-500">
                                        Note: SINDA contribution will be calculated from employee's total monthly salary and deducted from their pay.
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="sinda_eligible_edit"
                                            checked={!!workerFormData.sinda_eligible}
                                            onChange={(e) => setWorkerFormData({ ...workerFormData, sinda_eligible: e.target.checked })}
                                            className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                                        />
                                        <label htmlFor="sinda_eligible_edit" className="text-sm font-medium text-slate-700">
                                            SINDA eligible (Indian SHG — untick if opted out / not Indian descent)
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Additional Settings Section */}
                        <div className="col-span-2 space-y-4 border-t pt-4 mt-4">
                            <h4 className="text-sm font-semibold text-slate-700 mb-3">Additional Settings</h4>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Employment / cessation / rejoin */}
                                <div className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="in_company_edit"
                                            checked={workerFormData.in_company !== false}
                                            onChange={(e) =>
                                                setWorkerFormData({
                                                    ...workerFormData,
                                                    in_company: e.target.checked,
                                                })
                                            }
                                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <label htmlFor="in_company_edit" className="text-sm font-medium text-slate-700">
                                            In company (currently employed)
                                        </label>
                                    </div>
                                    <div className="space-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
                                        <div className="min-w-[180px] flex-1 space-y-1">
                                            <label htmlFor="date_of_cessation_edit" className="block text-sm font-medium text-slate-700">
                                                Date of cessation{' '}
                                                {workerFormData.in_company === false && (
                                                    <span className="text-red-500">*</span>
                                                )}
                                            </label>
                                            <input
                                                type="date"
                                                id="date_of_cessation_edit"
                                                value={workerFormData.date_of_cessation || ''}
                                                onChange={(e) =>
                                                    setWorkerFormData({
                                                        ...workerFormData,
                                                        date_of_cessation: e.target.value,
                                                    })
                                                }
                                                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                            <p className="text-xs text-slate-500">
                                                {workerFormData.in_company === false
                                                    ? 'Required when no longer employed (latest departure).'
                                                    : 'Keep the prior leave date here when they returned; pair with rejoin date(s).'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-2 rounded-md border border-slate-200/80 bg-white p-3">
                                        <label className="text-sm font-medium text-slate-700">Rejoin date(s)</label>
                                        <p className="text-xs leading-relaxed text-slate-500">
                                            Record each date they resumed employment after a cessation (add as many rows as needed). Clearing all rejoin dates is allowed only if cessation is cleared or timelines stay valid.
                                        </p>
                                        <div className="flex flex-col gap-2">
                                            {(workerFormData.rejoin_dates || []).map((rj, idx) => (
                                                <div key={`rejoin-${idx}`} className="flex flex-wrap items-center gap-2">
                                                    <input
                                                        type="date"
                                                        value={rj}
                                                        onChange={(e) => {
                                                            const next = [...(workerFormData.rejoin_dates || [])];
                                                            next[idx] = e.target.value;
                                                            setWorkerFormData({ ...workerFormData, rejoin_dates: next });
                                                        }}
                                                        className="min-w-[10rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-xs"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="shrink-0 border-slate-200"
                                                        onClick={() => {
                                                            const next = [...(workerFormData.rejoin_dates || [])];
                                                            next.splice(idx, 1);
                                                            setWorkerFormData({ ...workerFormData, rejoin_dates: next });
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="w-fit border-slate-200 bg-white"
                                                onClick={() =>
                                                    setWorkerFormData({
                                                        ...workerFormData,
                                                        rejoin_dates: [...(workerFormData.rejoin_dates || []), ''],
                                                    })
                                                }
                                            >
                                                <PlusCircle className="mr-2 h-4 w-4" />
                                                Add rejoin date
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Face ID Management */}
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="face_id_enabled_edit"
                                        checked={workerFormData.face_id_enabled}
                                        onChange={(e) => setWorkerFormData({ ...workerFormData, face_id_enabled: e.target.checked })}
                                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                                    />
                                    <label htmlFor="face_id_enabled_edit" className="text-sm font-medium text-slate-700">
                                        Enable Face ID (Required for login if enabled)
                                    </label>
                                </div>
                            </div>
                            {workerFormData.face_id_enabled && (
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={async () => {
                                            const tableName = selectedWorkerType === 'local' ? 'local_worker_details' : 'worker_details';
                                            const { data: worker } = await supabase
                                                .from(tableName)
                                                .select('employee_id, employee_name, face_id_set')
                                                .eq('employee_id', workerFormData.employee_id)
                                                .single();
                                            
                                            if (worker) {
                                                setFaceIDEnrollmentWorker({
                                                    employee_id: worker.employee_id,
                                                    employee_name: worker.employee_name,
                                                    workerType: selectedWorkerType,
                                                    face_id_set: worker.face_id_set || false,
                                                    face_id_enabled: true
                                                });
                                                // The edit dialog's focus trap would block the full-screen prompt.
                                                setShowEditWorkerDialog(false);
                                                setShowFaceIDEnrollmentDialog(true);
                                            }
                                        }}
                                        
                                    >
                                        <UserCheck  />
                                        {faceIDEnrollmentWorker?.face_id_set ? 'Update Face ID' : 'Enroll Face ID'}
                                    </Button>
                                    {faceIDEnrollmentWorker?.face_id_set && (
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            onClick={async () => {
                                                if (!(await confirmAction({ title: 'Delete Face ID?', message: 'Are you sure you want to delete the face ID data for this worker? They will need to re-enroll.', confirmLabel: 'Delete', destructive: true }))) {
                                                    return;
                                                }
                                                
                                                try {
                                                    const tableName = selectedWorkerType === 'local' ? 'local_worker_details' : 'worker_details';
                                                    const { error } = await supabase
                                                        .from(tableName)
                                                        .update({
                                                            face_embedding: null,
                                                            face_id_set: false
                                                        })
                                                        .eq('employee_id', workerFormData.employee_id);

                                                    if (error) throw error;

                                                    toast.success('Face ID data deleted successfully');
                                                    
                                                    // Refresh worker data
                                                    const { data: updatedWorker } = await supabase
                                                        .from(tableName)
                                                        .select('*')
                                                        .eq('employee_id', workerFormData.employee_id)
                                                        .single();
                                                    
                                                    if (updatedWorker) {
                                                        setFaceIDEnrollmentWorker({
                                                            employee_id: updatedWorker.employee_id,
                                                            employee_name: updatedWorker.employee_name,
                                                            workerType: selectedWorkerType,
                                                            face_id_set: false,
                                                            face_id_enabled: updatedWorker.face_id_enabled !== false
                                                        });
                                                    }
                                                    
                                                    queryClient.invalidateQueries({ queryKey: ['local-workers'] });
                                                    queryClient.invalidateQueries({ queryKey: ['foreign-workers'] });
                                                } catch (error) {
                                                    console.error('Error deleting face ID:', error);
                                                    toast.error('Failed to delete face ID data');
                                                }
                                            }}
                                        >
                                            <Trash2  />
                                            Delete Face ID
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={async () => {
                                            if (!(await confirmAction({
                                                title: 'Forget saved phones?',
                                                message: 'This worker will no longer be able to log in with one-tap Face ID on the phones they set up. They can set it up again with their password.',
                                                confirmLabel: 'Forget phones',
                                                destructive: true,
                                            }))) {
                                                return;
                                            }
                                            try {
                                                const { data, error } = await supabase
                                                    .from('worker_login_devices')
                                                    .update({ revoked_at: new Date().toISOString() })
                                                    .eq('worker_id', String(workerFormData.employee_id))
                                                    .is('revoked_at', null)
                                                    .select('id');
                                                if (error) throw error;
                                                toast.success(data?.length ? `Forgot ${data.length} saved phone${data.length > 1 ? 's' : ''}` : 'No saved phones for this worker');
                                            } catch (error) {
                                                console.error('Error forgetting saved phones:', error);
                                                toast.error('Could not forget saved phones');
                                            }
                                        }}
                                    >
                                        Forget saved phones
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter >
                        <div >
                            <Button
                                variant="outline"
                                onClick={() => setShowEditWorkerDialog(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleEditWorker}
                                disabled={editWorkerMutation.isPending}
                                
                            >
                                {editWorkerMutation.isPending ? (
                                    <>
                                        <Loader2  />
                                        Updating...
                                    </>
                                ) : (
                                    'Update Worker'
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Worker Dialog */}
            <Dialog open={showDeleteWorkerDialog} onOpenChange={setShowDeleteWorkerDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Worker</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. Please enter the password to confirm deletion of worker {deleteWorkerId}.
                        </DialogDescription>
                    </DialogHeader>
                    <div >
                        <Input
                            type="password"
                            placeholder="Enter password"
                            value={deletePassword}
                            onChange={(e) => {
                                setDeletePassword(e.target.value);
                                setDeletePasswordError('');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleDeleteWorker}
                        />
                        {deletePasswordError && (
                            <p >{deletePasswordError}</p>
                        )}
                    </div>
                    <DialogFooter >
                        <Button 
                            variant="outline"
                            onClick={() => {
                                setShowDeleteWorkerDialog(false);
            setDeleteWorkerId('');
            setDeleteWorkerType('');
            setDeletePassword('');
            setDeletePasswordError('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button 
                            variant="destructive"
                            onClick={handleDeleteWorker}
                            disabled={deleteWorkerMutation.isPending}
                        >
                            {deleteWorkerMutation.isPending ? (
                                <>
                                    <Loader2  />
                                    Deleting...
                                </>
                            ) : (
                                'Delete Worker'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Face ID enrollment — camera face capture in the iOS-style prompt */}
            <FaceMatchPrompt
                open={showFaceIDEnrollmentDialog && !!faceIDEnrollmentWorker}
                mode="enroll"
                intro={false}
                title={faceIDEnrollmentWorker?.face_id_set ? 'Update Face ID' : 'Set Up Face ID'}
                successTitle="Face ID saved"
                successSubtitle={faceIDEnrollmentWorker?.employee_name || ''}
                cancelLabel="Cancel"
                onEnrolled={async (faceEmbedding) => {
                    const tableName = faceIDEnrollmentWorker.workerType === 'local'
                        ? 'local_worker_details'
                        : 'worker_details';
                    const { error } = await supabase
                        .from(tableName)
                        .update({
                            face_embedding: faceEmbedding,
                            face_id_set: true,
                            face_id_enabled: true // Ensure it's enabled when enrolled
                        })
                        .eq('employee_id', faceIDEnrollmentWorker.employee_id);
                    if (error) {
                        console.error('Error saving face ID:', error);
                        throw { userMessage: 'Failed to save Face ID. Please try again.' };
                    }
                    setFaceIDEnrollmentWorker(prev => ({ ...prev, face_id_set: true, face_id_enabled: true }));
                    if (workerFormData.employee_id === faceIDEnrollmentWorker.employee_id) {
                        setWorkerFormData(prev => ({ ...prev, face_id_enabled: true }));
                    }
                    queryClient.invalidateQueries({ queryKey: ['local-workers'] });
                    queryClient.invalidateQueries({ queryKey: ['foreign-workers'] });
                }}
                onDone={() => {
                    toast.success('Face ID enrolled successfully!');
                    setShowFaceIDEnrollmentDialog(false);
                }}
                onUsePassword={() => setShowFaceIDEnrollmentDialog(false)}
                onExitComplete={() => setShowEditWorkerDialog(true)}
            />

            {/* Passed-out timesheet history (earlier versions of the same document) */}
            <Dialog open={!!timesheetHistory} onOpenChange={(open) => !open && setTimesheetHistory(null)}>
                <DialogContent className={moduleSheetDialog('max-w-lg')}>
                    <DialogHeader>
                        <DialogTitle>Timesheet history</DialogTitle>
                        <DialogDescription>
                            {timesheetHistory ? `${timesheetHistory.ts.worker_name || timesheetHistory.ts.worker_id} · ${String(timesheetHistory.ts.month).padStart(2, '0')}/${timesheetHistory.ts.year}` : ''}
                        </DialogDescription>
                    </DialogHeader>
                    {timesheetHistory && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="min-w-0 text-sm">
                                    <p className="font-medium text-slate-900">Rev {timesheetHistory.ts.revision || 1} · current</p>
                                    <p className="text-xs text-slate-500">{timesheetHistory.ts.status?.replace(/_/g, ' ')}</p>
                                </div>
                                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => handleViewPassedOutTimesheet(timesheetHistory.ts)}>
                                    View
                                </Button>
                            </div>
                            {timesheetHistory.revisions.length === 0 && (
                                <p className="py-4 text-center text-sm text-slate-500">No earlier versions.</p>
                            )}
                            {timesheetHistory.revisions.map((rev) => (
                                <div key={rev.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                                    <div className="min-w-0 text-sm">
                                        <p className="font-medium text-slate-900">
                                            {rev.archived_reason === 'duplicate' ? 'Duplicate copy (merged)' : `Rev ${rev.revision}`}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {rev.status?.replace(/_/g, ' ') || '—'} · replaced {rev.archived_at ? new Date(rev.archived_at).toLocaleString('en-SG') : ''}
                                        </p>
                                    </div>
                                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => previewHtml(rev.timesheet_html)}>
                                        View
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Create Leave Dialog */}
            <Dialog open={showCreateLeaveDialog} onOpenChange={(open) => {
                setShowCreateLeaveDialog(open);
                if (!open) setAdminLeaveAttachment(null);
            }}>
                <DialogContent className={cn(glassDialog, 'max-w-lg')}>
                    <DialogHeader>
                        <DialogTitle>Create Leave (Admin)</DialogTitle>
                        <DialogDescription>
                            Create and approve leave on behalf of a worker.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Worker ID</label>
                            <Input
                                value={adminLeaveData.employee_id}
                                onChange={(e) => setAdminLeaveData((prev) => ({ ...prev, employee_id: e.target.value.trim() }))}
                                placeholder="e.g. W001"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Leave Type</label>
                            <Select
                                value={adminLeaveData.leave_type}
                                onValueChange={(value) => setAdminLeaveData((prev) => ({ ...prev, leave_type: value }))}
                            >
                                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Annual Leave">Annual Leave</SelectItem>
                                    <SelectItem value="Medical Leave">Medical Leave</SelectItem>
                                    <SelectItem value="Hospitalization Leave">Hospitalization Leave</SelectItem>
                                    <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                    <SelectItem value="Unpaid Infant Care Leave">Unpaid Infant Care Leave</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Duration</label>
                            <Select
                                value={adminLeaveData.leave_duration}
                                onValueChange={(value) => setAdminLeaveData((prev) => ({ ...prev, leave_duration: value }))}
                            >
                                <SelectTrigger><SelectValue placeholder="Select duration" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="full_day">Full Day</SelectItem>
                                    <SelectItem value="half_day_morning">Half Day (Morning)</SelectItem>
                                    <SelectItem value="half_day_afternoon">Half Day (Afternoon)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">From</label>
                                <Input
                                    type="date"
                                    value={adminLeaveData.from_date}
                                    onChange={(e) => setAdminLeaveData((prev) => ({ ...prev, from_date: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">To</label>
                                <Input
                                    type="date"
                                    value={adminLeaveData.to_date}
                                    onChange={(e) => setAdminLeaveData((prev) => ({ ...prev, to_date: e.target.value }))}
                                />
                            </div>
                        </div>
                        {adminLeaveData.from_date && adminLeaveData.to_date && adminLeaveData.to_date >= adminLeaveData.from_date && (
                            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                This leave will cover{' '}
                                <strong>
                                    {countRequestedLeaveDays({
                                        ...adminLeaveData,
                                        leave_type: normalizeLeaveType(adminLeaveData.leave_type),
                                    })}
                                </strong>{' '}
                                day(s) from the selected dates only (balance cannot extend past the To date).
                                Sundays/PH are skipped for paid leave types.
                            </p>
                        )}
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Reason</label>
                            <Textarea
                                value={adminLeaveData.reason}
                                onChange={(e) => setAdminLeaveData((prev) => ({ ...prev, reason: e.target.value }))}
                                rows={2}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Attachment (optional)</label>
                            <Input
                                key={showCreateLeaveDialog ? 'leave-file-open' : 'leave-file-closed'}
                                type="file"
                                accept=".pdf,image/*"
                                onChange={async (e) => {
                                    const input = e.target;
                                    const picked = input.files?.[0] || null;
                                    if (!picked) {
                                        setAdminLeaveAttachment(null);
                                        return;
                                    }
                                    try {
                                        setAdminLeaveAttachment(await prepareLeaveAttachment(picked));
                                    } catch (err) {
                                        toast.error(err.message || 'This file cannot be attached');
                                        input.value = '';
                                        setAdminLeaveAttachment(null);
                                    }
                                }}
                            />
                            <p className="text-xs text-slate-500">
                                {adminLeaveAttachment
                                    ? adminLeaveAttachment.name
                                    : 'PDF or photo. Medical and hospitalization leave may require this before it can be approved.'}
                            </p>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowCreateLeaveDialog(false)}>Cancel</Button>
                        <Button
                            className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto"
                            onClick={() => createLeaveOnBehalf.mutate()}
                            disabled={createLeaveOnBehalf.isPending}
                        >
                            {createLeaveOnBehalf.isPending ? 'Creating…' : 'Create & Approve'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Leave History Dialog */}
            <Dialog open={showLeaveHistory} onOpenChange={setShowLeaveHistory}>
                <DialogContent className={cn(glassDialog, 'max-w-4xl max-h-[80vh] overflow-y-auto')}>
                    <DialogHeader>
                        <DialogTitle>Leave History</DialogTitle>
                        <DialogDescription>
                            Complete history of all leave requests (approved, rejected, pending)
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:flex-wrap sm:items-end">
                        <div className="flex flex-1 flex-col gap-1 min-w-[140px]">
                            <label htmlFor="leave-print-from" className="text-xs font-medium text-slate-600">
                                Print from
                            </label>
                            <Input
                                id="leave-print-from"
                                type="date"
                                value={leavePrintFromDate}
                                onChange={(e) => setLeavePrintFromDate(e.target.value)}
                                className="h-9 bg-white"
                            />
                        </div>
                        <div className="flex flex-1 flex-col gap-1 min-w-[140px]">
                            <label htmlFor="leave-print-to" className="text-xs font-medium text-slate-600">
                                Print to
                            </label>
                            <Input
                                id="leave-print-to"
                                type="date"
                                value={leavePrintToDate}
                                onChange={(e) => setLeavePrintToDate(e.target.value)}
                                className="h-9 bg-white"
                            />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 shrink-0 border-slate-300 bg-white sm:mb-0"
                            onClick={handlePrintLeaveFormsInRange}
                            disabled={isPrintingLeaveForms || isLoadingAllLeaveRequests}
                        >
                            {isPrintingLeaveForms ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Printer className="mr-2 h-4 w-4" />
                            )}
                            Print leave forms (date range)
                        </Button>
                    </div>

                    {isLoadingAllLeaveRequests ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
                        </div>
                    ) : allLeaveRequests?.length === 0 ? (
                        <div className="text-center py-10">
                            <Calendar className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                            <h4 className="text-lg font-medium text-slate-700 mb-2">No Leave History</h4>
                            <p className="text-slate-500">No leave requests have been submitted yet</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {allLeaveRequests?.map((request) => (
                                <Card key={request.id} className={`border ${
                                    request.status === 'approved' ? 'border-green-200 bg-green-50' :
                                    request.status === 'rejected' ? 'border-red-200 bg-red-50' :
                                    'border-yellow-200 bg-yellow-50'
                                }`}>
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <Badge
                                                    variant={request.status === 'approved' ? 'default' : request.status === 'rejected' ? 'destructive' : 'secondary'}
                                                    className={
                                                        request.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                        request.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                                        'bg-yellow-100 text-yellow-800'
                                                    }
                                                >
                                                    {request.status.toUpperCase()}
                                                </Badge>
                                                <Badge
                                                    variant={request.leave_type === 'AL' ? 'default' : 'secondary'}
                                                    className={request.leave_type === 'AL' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}
                                                >
                                                    {request.leave_type}
                                                </Badge>
                                                <span className="text-xs text-slate-500">
                                                    {format(new Date(request.created_at), 'MMM dd, yyyy HH:mm')}
                                                </span>
                                            </div>
                                            <div className="text-right text-xs text-slate-500">
                                                Days:{' '}
                                                {countLeaveDaysForDisplay({
                                                    from_date: request.from_date,
                                                    to_date: request.to_date,
                                                    leave_type: request.leave_type,
                                                    leave_duration: request.leave_duration,
                                                    days_requested: request.days_requested,
                                                })}
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex items-center gap-2">
                                                <User className="w-4 h-4 text-slate-400" />
                                                <span className="font-medium text-sm">{request.worker_details?.employee_name || request.employee_name || 'Unknown'}</span>
                                                <span className="text-slate-400">•</span>
                                                <span className="text-sm text-slate-500">ID: {request.employee_id}</span>
                                            </div>
                                            <div className="text-xs text-slate-600">
                                                <strong>Period:</strong> {formatDate(request.from_date)} → {formatDate(request.to_date)}
                                            </div>
                                            {request.reason && (
                                                <div className="text-xs text-slate-600">
                                                    <strong>Reason:</strong> {request.reason}
                                                </div>
                                            )}
                                            {request.admin_notes && (
                                                <div className="text-xs text-slate-600">
                                                    <strong>Admin Notes:</strong> {request.admin_notes}
                                                </div>
                                            )}
                                        </div>

                                        {/* Action buttons for individual leaves */}
                                        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handlePrintSingleLeaveForm(request)}
                                                disabled={isPrintingLeaveForms}
                                                className="text-xs bg-white hover:bg-slate-50 border-slate-200"
                                            >
                                                <Printer className="w-3 h-3 mr-1" />
                                                Print
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setEditingLeave(request);
                                                    setLeaveEditData({
                                                        leave_type: request.leave_type,
                                                        leave_duration: request.leave_duration,
                                                        from_date: request.from_date,
                                                        to_date: request.to_date
                                                    });
                                                    setShowEditLeaveDialog(true);
                                                }}
                                                className="text-xs bg-blue-50 hover:bg-blue-100 border-blue-200"
                                            >
                                                <Edit2 className="w-3 h-3 mr-1" />
                                                Edit
                                            </Button>
                                            {request.status === 'approved' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={async () => {
                                                        if (await confirmAction({ title: 'Cancel approved leave?', message: `Cancel approved leave for ${request.employee_name || request.employee_id}? Balance and shifts will be reverted.`, confirmLabel: 'Cancel leave', destructive: true })) {
                                                            updateLeaveStatus.mutate({
                                                                id: request.id,
                                                                status: 'cancelled',
                                                                adminNotes: 'Cancelled by admin',
                                                            });
                                                        }
                                                    }}
                                                    className="text-xs bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-800"
                                                >
                                                    <RotateCcw className="w-3 h-3 mr-1" />
                                                    Cancel approved
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={async () => {
                                                    if (await confirmAction({ title: 'Delete leave request?', message: `Are you sure you want to delete this leave request for ${request.employee_name}? This will also remove associated shift records.`, confirmLabel: 'Delete', destructive: true })) {
                                                        // Delete the leave request and associated shifts
                                                        deleteLeaveMutation.mutate(request.id);
                                                    } else {
                                                    }
                                                }}
                                                disabled={deleteLeaveMutation?.isPending}
                                                className="text-xs"
                                            >
                                                <Trash2 className="w-3 h-3 mr-1" />
                                                Delete Leave
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowLeaveHistory(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            
            {/* Print Payslip Dialog */}
            <Dialog open={showPayslipDialog} onOpenChange={setShowPayslipDialog}>
                <DialogContent className={moduleSheetDialog('max-w-2xl')}>
                    <DialogHeader>
                        <DialogTitle>Print Payslip</DialogTitle>
                        <DialogDescription>
                            Generate a monthly payslip for a specific worker.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Worker ID</label>
                            <Input
                                placeholder="Enter Worker ID"
                                value={payslipWorkerId}
                                onChange={(e) => setPayslipWorkerId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Month</label>
                            <Input
                                type="month"
                                value={payslipMonth}
                                onChange={(e) => setPayslipMonth(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date of Salary Paid (Optional)</label>
                            <Input
                                type="date"
                                value={payslipSalaryPaidDate}
                                onChange={(e) => setPayslipSalaryPaidDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Bonus (Optional)</label>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={printBonus}
                                onChange={(e) => setPrintBonus(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Additions</label>
                            {printAdditions.map((addition, index) => (
                                <div key={index} className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <Input
                                            placeholder="Addition Name"
                                            value={addition.name}
                                            onChange={(e) => {
                                                const newAdditions = [...printAdditions];
                                                newAdditions[index].name = e.target.value;
                                                setPrintAdditions(newAdditions);
                                            }}
                                        />
                                    </div>
                                    <div className="w-24">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={addition.value}
                                            onChange={(e) => {
                                                const newAdditions = [...printAdditions];
                                                newAdditions[index].value = e.target.value;
                                                setPrintAdditions(newAdditions);
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const newAdditions = printAdditions.filter((_, i) => i !== index);
                                            setPrintAdditions(newAdditions.length > 0 ? newAdditions : [{ name: '', value: '' }]);
                                        }}
                                        disabled={printAdditions.length === 1}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setPrintAdditions([...printAdditions, { name: '', value: '' }])}
                            >
                                Add Addition
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Deductions</label>
                            {payslipDeductions.map((deduction, index) => (
                                <div key={index} className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <Input
                                            placeholder="Deduction Type"
                                            value={deduction.type}
                                            onChange={(e) => {
                                                const newDeductions = [...payslipDeductions];
                                                newDeductions[index].type = e.target.value;
                                                setPayslipDeductions(newDeductions);
                                            }}
                                        />
                                    </div>
                                    <div className="w-24">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={deduction.amount}
                                            onChange={(e) => {
                                                const newDeductions = [...payslipDeductions];
                                                newDeductions[index].amount = e.target.value;
                                                setPayslipDeductions(newDeductions);
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const newDeductions = payslipDeductions.filter((_, i) => i !== index);
                                            setPayslipDeductions(newDeductions.length > 0 ? newDeductions : [{ type: '', amount: '' }]);
                                        }}
                                        disabled={payslipDeductions.length === 1}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setPayslipDeductions([...payslipDeductions, { type: '', amount: '' }])}
                            >
                                Add Deduction
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto"
                            variant="outline"
                            onClick={() => {
                                setShowPayslipDialog(false);
                                setPayslipWorkerId('');
                                setPayslipMonth('');
                                setPayslipSalaryPaidDate('');
                                setPrintBonus('');
                                setPrintAdditions([{ name: '', value: '' }]);
                                setPayslipDeductions([{ type: '', amount: '' }]);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={() => {
                                if (payslipWorkerId && payslipMonth && payslipSalaryPaidDate) {
                                    const [year, month] = payslipMonth.split('-');
                                    const monthYear = `${parseInt(year)}-${String(parseInt(month)).padStart(2, '0')}`;
                                    printTimesheetAndPayslip(
                                        payslipWorkerId,
                                        monthYear,
                                        payslipDeductions,
                                        payslipSalaryPaidDate,
                                        printBonus,
                                        printAdditions
                                    );
                                    setShowPayslipDialog(false);
                                    setPayslipWorkerId('');
                                    setPayslipMonth('');
                                    setPayslipSalaryPaidDate('');
                                    setPrintBonus('');
                                    setPrintAdditions([{ name: '', value: '' }]);
                                    setPayslipDeductions([{ type: '', amount: '' }]);
                                }
                            }} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                            <FileSpreadsheet className="w-4 h-4 mr-2" />
                            Print Payslip
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Enhanced Monthly Payslip Dialog */}
            <Dialog open={showMonthlyPayslipDialog} onOpenChange={setShowMonthlyPayslipDialog}>
                <DialogContent className={moduleSheetDialog('max-w-4xl')}>
                    <DialogHeader>
                        <DialogTitle>Generate Monthly Payslips</DialogTitle>
                        <DialogDescription>
                            {monthlyPayslipStep === 1 && "Select the period for payslip generation"}
                            {monthlyPayslipStep === 2 && "Review workers and configure individual additions/deductions"}
                            {monthlyPayslipStep === 3 && "Configure payslip details for individual worker"}
                        </DialogDescription>
                    </DialogHeader>
                    
                    {monthlyPayslipStep === 1 && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Start Date (DD/MM/YYYY)</label>
                                    <Input
                                        type="date"
                                        value={monthlyPayslipPeriod.startDate}
                                        onChange={(e) => setMonthlyPayslipPeriod({ ...monthlyPayslipPeriod, startDate: e.target.value })}
                                        placeholder="DD/MM/YYYY"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">End Date (DD/MM/YYYY)</label>
                                    <Input
                                        type="date"
                                        value={monthlyPayslipPeriod.endDate}
                                        onChange={(e) => setMonthlyPayslipPeriod({ ...monthlyPayslipPeriod, endDate: e.target.value })}
                                        placeholder="DD/MM/YYYY"
                                    />
                                </div>
                            </div>
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto"
                                    variant="outline"
                                    onClick={() => {
                                        setShowMonthlyPayslipDialog(false);
                                        setMonthlyPayslipStep(1);
                                        setMonthlyPayslipPeriod({ startDate: '', endDate: '' });
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button 
                                    onClick={() => handleMonthlyPayslipPeriodSubmit()}
                                    disabled={!monthlyPayslipPeriod.startDate || !monthlyPayslipPeriod.endDate} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700">
                                    Next
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {monthlyPayslipStep === 2 && (
                        <div className="space-y-4">
                            <div className="text-sm text-gray-600">
                                Period: {new Date(monthlyPayslipPeriod.startDate).toLocaleDateString()} - {new Date(monthlyPayslipPeriod.endDate).toLocaleDateString()}
                            </div>
                            
                            {monthlyPayslipWorkers.length > 0 ? (
                                <div className="space-y-2">
                                    <h3 className="font-medium">Workers ({monthlyPayslipWorkers.length})</h3>
                                    <div className="max-h-60 overflow-y-auto border rounded">
                                        {monthlyPayslipWorkers.map((worker, index) => (
                                            <div key={worker.employee_id} className="p-3 border-b hover:bg-gray-50 flex justify-between items-center">
                                                <div>
                                                    <div className="font-medium">{worker.employee_name}</div>
                                                    <div className="text-sm text-gray-600">ID: {worker.employee_id} | Type: {worker.worker_type}</div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleConfigureWorkerPayslip(worker)}
                                                    className="bg-blue-600 hover:bg-blue-700"
                                                >
                                                    Configure
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 text-gray-500">
                                    No workers found for the selected period
                                </div>
                            )}
                            
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto"
                                    variant="outline"
                                    onClick={() => setMonthlyPayslipStep(1)}
                                >
                                    Back
                                </Button>
                                <Button 
                                    onClick={() => handleGenerateAllPayslips()}
                                    disabled={monthlyPayslipWorkers.length === 0} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                                    Generate All Payslips
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {monthlyPayslipStep === 3 && (
                        <div className="space-y-4">
                            {(() => {
                                const configuringWorker = monthlyPayslipWorkers.find(w => w.isConfiguring);
                                if (!configuringWorker) return null;
                                
                                return (
                                    <>
                                        <div className="text-sm text-gray-600">
                                            Configuring for: {configuringWorker.employee_name} (ID: {configuringWorker.employee_id})
                                        </div>
                                        
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Bonus (Optional)</label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={configuringWorker.bonus || ''}
                                                    onChange={(e) => {
                                                        setMonthlyPayslipWorkers(prev => prev.map(w => 
                                                            w.employee_id === configuringWorker.employee_id 
                                                                ? { ...w, bonus: e.target.value }
                                                                : w
                                                        ));
                                                    }}
                                                />
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Additions</label>
                                                {configuringWorker.additions?.map((addition, index) => (
                                                    <div key={index} className="flex gap-2 items-end">
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="Addition Name"
                                                                value={addition.name || ''}
                                                                onChange={(e) => {
                                                                    setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                        if (w.employee_id === configuringWorker.employee_id) {
                                                                            const newAdditions = [...(w.additions || [])];
                                                                            newAdditions[index] = { ...newAdditions[index], name: e.target.value };
                                                                            return { ...w, additions: newAdditions };
                                                                        }
                                                                        return w;
                                                                    }));
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="w-24">
                                                            <Input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={addition.value || ''}
                                                                onChange={(e) => {
                                                                    setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                        if (w.employee_id === configuringWorker.employee_id) {
                                                                            const newAdditions = [...(w.additions || [])];
                                                                            newAdditions[index] = { ...newAdditions[index], value: e.target.value };
                                                                            return { ...w, additions: newAdditions };
                                                                        }
                                                                        return w;
                                                                    }));
                                                                }}
                                                            />
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                    if (w.employee_id === configuringWorker.employee_id) {
                                                                        const newAdditions = w.additions?.filter((_, i) => i !== index) || [];
                                                                        return { ...w, additions: newAdditions.length > 0 ? newAdditions : [{ name: '', value: '' }] };
                                                                    }
                                                                    return w;
                                                                }));
                                                            }}
                                                            disabled={configuringWorker.additions?.length === 1}
                                                        >
                                                            Remove
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                            if (w.employee_id === configuringWorker.employee_id) {
                                                                return { ...w, additions: [...(w.additions || []), { name: '', value: '' }] };
                                                            }
                                                            return w;
                                                        }));
                                                    }}
                                                >
                                                    Add Addition
                                                </Button>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Deductions</label>
                                                {configuringWorker.deductions?.map((deduction, index) => (
                                                    <div key={index} className="flex gap-2 items-end">
                                                        <div className="flex-1">
                                                            <Input
                                                                placeholder="Deduction Name"
                                                                value={deduction.name || ''}
                                                                onChange={(e) => {
                                                                    setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                        if (w.employee_id === configuringWorker.employee_id) {
                                                                            const newDeductions = [...(w.deductions || [])];
                                                                            newDeductions[index] = { ...newDeductions[index], name: e.target.value };
                                                                            return { ...w, deductions: newDeductions };
                                                                        }
                                                                        return w;
                                                                    }));
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="w-24">
                                                            <Input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={deduction.value || ''}
                                                                onChange={(e) => {
                                                                    setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                        if (w.employee_id === configuringWorker.employee_id) {
                                                                            const newDeductions = [...(w.deductions || [])];
                                                                            newDeductions[index] = { ...newDeductions[index], value: e.target.value };
                                                                            return { ...w, deductions: newDeductions };
                                                                        }
                                                                        return w;
                                                                    }));
                                                                }}
                                                            />
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                                    if (w.employee_id === configuringWorker.employee_id) {
                                                                        const newDeductions = w.deductions?.filter((_, i) => i !== index) || [];
                                                                        return { ...w, deductions: newDeductions.length > 0 ? newDeductions : [{ name: '', value: '' }] };
                                                                    }
                                                                    return w;
                                                                }));
                                                            }}
                                                            disabled={configuringWorker.deductions?.length === 1}
                                                        >
                                                            Remove
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setMonthlyPayslipWorkers(prev => prev.map(w => {
                                                            if (w.employee_id === configuringWorker.employee_id) {
                                                                return { ...w, deductions: [...(w.deductions || []), { name: '', value: '' }] };
                                                            }
                                                            return w;
                                                        }));
                                                    }}
                                                >
                                                    Add Deduction
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                            
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto"
                                    variant="outline"
                                    onClick={() => {
                                        setMonthlyPayslipWorkers(prev => prev.map(w => ({ ...w, isConfiguring: false })));
                                        setMonthlyPayslipStep(2);
                                    }}
                                >
                                    Back to Workers List
                                </Button>
                                <Button 
                                    onClick={() => {
                                        setMonthlyPayslipWorkers(prev => prev.map(w => ({ ...w, isConfiguring: false })));
                                        setMonthlyPayslipStep(2);
                                    }} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                                    Save Configuration
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Create Shift Dialog */}
            <Dialog open={showCreateShiftDialog} onOpenChange={setShowCreateShiftDialog}>
                <DialogContent className={cn(glassDialog, 'max-w-2xl')}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2.5">
                            <AdminToneIcon icon={PlusCircle} tone="indigo" />
                            Create Shift
                        </DialogTitle>
                        <DialogDescription>
                            Manually create a shift with entry, exit, breaks, and optional leave. Live shift updates pause while this form is open.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <AdminFieldLabel>Worker ID</AdminFieldLabel>
                                <Input
                                    className={glassInput}
                                    value={createShiftData.worker_id}
                                    onChange={(e) => setCreateShiftData({ ...createShiftData, worker_id: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <AdminFieldLabel>Work Date</AdminFieldLabel>
                                <Input
                                    type="date"
                                    className={glassInput}
                                    value={createShiftData.work_date}
                                    onChange={(e) => setCreateShiftData({ ...createShiftData, work_date: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Site (Optional)</AdminFieldLabel>
                            <Select
                                value={createShiftData.site_id || ''}
                                onValueChange={(value) =>
                                    setCreateShiftData({
                                        ...createShiftData,
                                        site_id: value === '__none__' ? '' : value
                                    })
                                }
                            >
                                <SelectTrigger className={cn(glassInput, 'w-full')}>
                                    <SelectValue placeholder="Select site" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No Site</SelectItem>
                                    {allSites.filter((site) => site.is_active !== false).map((site) => (
                                        <SelectItem key={site.id} value={String(site.id)}>
                                            {site.site_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <AdminFieldLabel>Entry Time</AdminFieldLabel>
                                <Input
                                    type="datetime-local"
                                    className={glassInput}
                                    value={createShiftData.entry_time}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, entry_time: e.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <AdminFieldLabel>Exit Time (Optional)</AdminFieldLabel>
                                <Input
                                    type="datetime-local"
                                    className={glassInput}
                                    value={createShiftData.leave_time}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, leave_time: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <AdminFieldLabel>Breaks</AdminFieldLabel>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 rounded-xl text-xs"
                                    onClick={() => {
                                        const currentBreaks = createShiftData.breaks || [];
                                        if (currentBreaks.length > 0) {
                                            const lastBreak = currentBreaks[currentBreaks.length - 1];
                                            if (!lastBreak.lunch_start || !lastBreak.lunch_end) {
                                                toast.error(
                                                    'Please fill start and end time for the last break before adding a new one'
                                                );
                                                return;
                                            }
                                        }
                                        const newBreaks = [...currentBreaks, { lunch_start: '', lunch_end: '' }];
                                        setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                    }}
                                >
                                    + Add Break
                                </Button>
                            </div>
                            {createShiftData.breaks.map((breakItem, index) => (
                                <div key={index} className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium">Break {index + 1}</h4>
                                        {createShiftData.breaks.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const newBreaks = createShiftData.breaks.filter(
                                                        (_, i) => i !== index
                                                    );
                                                    setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                                }}
                                                className="text-red-600 hover:text-red-700 h-6 w-6 p-0"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-600">Break Start Time</label>
                                            <Input
                                                type="datetime-local"
                                                value={breakItem.lunch_start}
                                                onChange={(e) => {
                                                    const newBreaks = [...createShiftData.breaks];
                                                    newBreaks[index].lunch_start = e.target.value;
                                                    setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                                }}
                                                className={cn(glassInput, 'h-10 text-xs')}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-600">Break End Time</label>
                                            <Input
                                                type="datetime-local"
                                                value={breakItem.lunch_end}
                                                onChange={(e) => {
                                                    const newBreaks = [...createShiftData.breaks];
                                                    newBreaks[index].lunch_end = e.target.value;
                                                    setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                                }}
                                                className={cn(glassInput, 'h-10 text-xs')}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <div className="text-right text-xs text-slate-600">
                                Total Break Hours:{' '}
                                {(
                                    (createShiftData.breaks || []).reduce((sum, b) => {
                                        const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
                                        const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;
                                        if (!startIso || !endIso) return sum;
                                        const diffMs = new Date(endIso) - new Date(startIso);
                                        if (!Number.isFinite(diffMs) || diffMs <= 0) return sum;
                                        return sum + diffMs / (1000 * 60 * 60);
                                    }, 0)
                                ).toFixed(2)}
                                h
                            </div>
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Leave Type (Optional)</AdminFieldLabel>
                            <Select
                                value={createShiftData.leave_type}
                                onValueChange={(value) =>
                                    setCreateShiftData({ ...createShiftData, leave_type: value })
                                }
                            >
                                <SelectTrigger className={cn(glassInput, 'w-full')}>
                                    <SelectValue placeholder="Select leave type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No Leave</SelectItem>
                                    <SelectItem value="Annual Leave">Annual Leave</SelectItem>
                                    <SelectItem value="Maternity Leave">Maternity Leave</SelectItem>
                                    <SelectItem value="Paternity Leave">Paternity Leave</SelectItem>
                                    <SelectItem value="Shared Parental Leave">Shared Parental Leave</SelectItem>
                                    <SelectItem value="Childcare Leave">Childcare Leave</SelectItem>
                                    <SelectItem value="Medical Leave">Medical Leave</SelectItem>
                                    <SelectItem value="Hospitalization Leave">Hospitalization Leave</SelectItem>
                                    <SelectItem value="National Service (NS) Leave">
                                        National Service (NS) Leave
                                    </SelectItem>
                                    <SelectItem value="Adoption Leave">Adoption Leave</SelectItem>
                                    <SelectItem value="Non-Statutory Leave (Employer Provided)">
                                        Non-Statutory Leave (Employer Provided)
                                    </SelectItem>
                                    <SelectItem value="Compassionate / Bereavement Leave">
                                        Compassionate / Bereavement Leave
                                    </SelectItem>
                                    <SelectItem value="Marriage Leave">Marriage Leave</SelectItem>
                                    <SelectItem value="Study / Exam Leave">Study / Exam Leave</SelectItem>
                                    <SelectItem value="Birthday Leave">Birthday Leave</SelectItem>
                                    <SelectItem value="Mental Health Day">Mental Health Day</SelectItem>
                                    <SelectItem value="Volunteer Leave">Volunteer Leave</SelectItem>
                                    <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                    <SelectItem value="Unpaid Infant Care Leave">Unpaid Infant Care Leave</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="h-11 rounded-xl w-full sm:w-auto" onClick={() => setShowCreateShiftDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            className="h-11 rounded-xl bg-brand hover:bg-brand-hover w-full sm:w-auto"
                            onClick={async () => {
                                const workerId = (createShiftData.worker_id || '').trim();

                                if (!workerId || !createShiftData.work_date || !createShiftData.entry_time) {
                                    toast.error('Worker ID, work date, and entry time are required');
                                    return;
                                }

                                const entryTimeIso = fromDateTimeLocalUtc(createShiftData.entry_time);
                                const leaveTimeIso = fromDateTimeLocalUtc(createShiftData.leave_time);

                                if (!entryTimeIso) {
                                    toast.error('Entry time is invalid');
                                    return;
                                }

                                if (leaveTimeIso && new Date(leaveTimeIso).getTime() <= new Date(entryTimeIso).getTime()) {
                                    toast.error('Exit time must be after entry time');
                                    return;
                                }

                                // Automatically derive work_date from entry_time in Singapore timezone
                                // This fixes the issue where shifts starting at 00:24 are marked as previous day
                                const workDateFromEntry = getWorkDateFromDateTime(entryTimeIso);
                                const workDate = workDateFromEntry || createShiftData.work_date;

                                const rawBreaks = createShiftData.breaks || [];
                                for (let i = 0; i < rawBreaks.length; i++) {
                                    const b = rawBreaks[i];
                                    const hasStart = !!b.lunch_start;
                                    const hasEnd = !!b.lunch_end;
                                    if (hasStart !== hasEnd) {
                                        toast.error('Each break must have both start and end time');
                                        return;
                                    }
                                    if (hasStart && hasEnd) {
                                        const startDate = new Date(fromDateTimeLocalUtc(b.lunch_start));
                                        const endDate = new Date(fromDateTimeLocalUtc(b.lunch_end));
                                        if (
                                            !Number.isFinite(startDate.getTime()) ||
                                            !Number.isFinite(endDate.getTime()) ||
                                            endDate <= startDate
                                        ) {
                                            toast.error('Break end time must be after start time');
                                            return;
                                        }
                                    }
                                }

                                const normalizedBreaks = rawBreaks
                                    .map((b) => ({
                                        break_start: b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null,
                                        break_end: b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null
                                    }))
                                    .filter((b) => b.break_start && b.break_end);

                                const isCompleted = !!leaveTimeIso;
                                const calculations = isCompleted
                                    ? calculateShiftHours(
                                          entryTimeIso,
                                          leaveTimeIso,
                                          normalizedBreaks,
                                          workDate
                                      )
                                    : { basicHours: 0, sundayHours: 0, otHours: 0 };

                                try {
                                    const { data: localWorker, error: localError } = await supabase
                                        .from('local_worker_details')
                                        .select('employee_id')
                                        .eq('employee_id', workerId)
                                        .maybeSingle();

                                    let workerExists = false;

                                    if (!localError && localWorker) {
                                        workerExists = true;
                                    } else {
                                        const { data: foreignWorker, error: foreignError } = await supabase
                                            .from('worker_details')
                                            .select('employee_id')
                                            .eq('employee_id', workerId)
                                            .maybeSingle();

                                        if (!foreignError && foreignWorker) {
                                            workerExists = true;
                                        }
                                    }

                                    if (!workerExists) {
                                        toast.error('Worker ID not found in worker tables');
                                        return;
                                    }

                                    const { data: insertedShift, error: insertShiftError } = await supabase
                                        .from('shifts')
                                        .insert([
                                            {
                                                worker_id: workerId,
                                                site_id: createShiftData.site_id ? createShiftData.site_id : null,
                                                work_date: workDate,
                                                entry_time: entryTimeIso,
                                                leave_time: leaveTimeIso,
                                                has_left: isCompleted,
                                                worked_hours: calculations.basicHours,
                                                sunday_hours: calculations.sundayHours,
                                                ot_hours: calculations.otHours,
                                                break_hours: calculations.breakHours,
                                                leave_type:
                                                    createShiftData.leave_type === '__none__'
                                                        ? null
                                                        : createShiftData.leave_type,
                                                ...(isCompleted ? pendingOnCompleteFields() : {}),
                                            }
                                        ])
                                        .select()
                                        .single();

                                    if (insertShiftError) {
                                        console.error('Error creating shift:', insertShiftError);
                                        if (insertShiftError.code === '23505') {
                                            toast.error('Shift already exists for this worker and date');
                                        } else if (insertShiftError.code === '23503') {
                                            toast.error('Invalid worker or site information');
                                        } else {
                                            toast.error('Failed to create shift');
                                        }
                                        return;
                                    }

                                    if (normalizedBreaks.length > 0 && insertedShift?.id) {
                                        const { error: insertBreaksError } = await supabase
                                            .from('breaks')
                                            .insert(
                                                normalizedBreaks.map((b) => ({
                                                    shift_id: insertedShift.id,
                                                    break_start: b.break_start,
                                                    break_end: b.break_end
                                                }))
                                            );

                                        if (insertBreaksError) {
                                            console.error('Failed to create breaks:', insertBreaksError);
                                            toast.error('Shift created but failed to save breaks');
                                        }
                                    }

                                    toast.success('Shift created successfully');
                                    setShowCreateShiftDialog(false);
                                    queryClient.invalidateQueries({ queryKey: ['shifts'] });
                                } catch (error) {
                                    console.error('Unexpected error creating shift:', error);
                                    toast.error('Failed to create shift');
                                }
                            }}
                        >
                            Create Shift
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <AdminEditShiftDialog
                key={editingShift?.id || 'edit-shift'}
                open={showEditShiftDialog}
                onOpenChange={(open) => {
                    setShowEditShiftDialog(open);
                    if (!open) setEditSaveAndApprove(false);
                }}
                editingShift={editingShift}
                initialData={shiftEditData}
                needsApprovalActions={Boolean(editingShift && shiftNeedsApprovalActions(editingShift))}
                onSave={handleEditShiftSave}
            />


            {/* Edit Leave Dialog */}
            <Dialog
                open={showEditLeaveDialog}
                onOpenChange={(open) => {
                    setShowEditLeaveDialog(open);
                    if (!open) {
                        setLeaveEditSoftWarnings([]);
                        setLeaveEditHardWarnings([]);
                    }
                }}
            >
                <DialogContent className={cn(glassDialog, 'max-w-lg')}>
                    <DialogHeader>
                        <DialogTitle>Edit Leave Request</DialogTitle>
                        <DialogDescription>
                            Save changes before approving. Soft conflict warnings appear when dates change; hard conflicts block save.
                        </DialogDescription>
                    </DialogHeader>
                    {editingLeave ? (
                        <>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Leave Type</label>
                                    <Select
                                        value={leaveEditData.leave_type}
                                        onValueChange={(value) => setLeaveEditData({ ...leaveEditData, leave_type: value })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select leave type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Annual Leave">Annual Leave</SelectItem>
                                            <SelectItem value="Maternity Leave">Maternity Leave</SelectItem>
                                            <SelectItem value="Paternity Leave">Paternity Leave</SelectItem>
                                            <SelectItem value="Shared Parental Leave">Shared Parental Leave</SelectItem>
                                            <SelectItem value="Childcare Leave">Childcare Leave</SelectItem>
                                            <SelectItem value="Medical Leave">Medical Leave</SelectItem>
                                            <SelectItem value="Hospitalization Leave">Hospitalization Leave</SelectItem>
                                            <SelectItem value="National Service (NS) Leave">National Service (NS) Leave</SelectItem>
                                            <SelectItem value="Adoption Leave">Adoption Leave</SelectItem>
                                            <SelectItem value="Non-Statutory Leave (Employer Provided)">Non-Statutory Leave (Employer Provided)</SelectItem>
                                            <SelectItem value="Compassionate / Bereavement Leave">Compassionate / Bereavement Leave</SelectItem>
                                            <SelectItem value="Marriage Leave">Marriage Leave</SelectItem>
                                            <SelectItem value="Study / Exam Leave">Study / Exam Leave</SelectItem>
                                            <SelectItem value="Birthday Leave">Birthday Leave</SelectItem>
                                            <SelectItem value="Mental Health Day">Mental Health Day</SelectItem>
                                            <SelectItem value="Volunteer Leave">Volunteer Leave</SelectItem>
                                            <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                            <SelectItem value="Unpaid Infant Care Leave">Unpaid Infant Care Leave</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Duration</label>
                                    <Select
                                        value={leaveEditData.leave_duration}
                                        onValueChange={(value) => setLeaveEditData({ ...leaveEditData, leave_duration: value })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select duration" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="full_day">Full Day</SelectItem>
                                            <SelectItem value="half_day_morning">Half Day (Morning)</SelectItem>
                                            <SelectItem value="half_day_afternoon">Half Day (Afternoon)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">From Date</label>
                                        <Input
                                            type="date"
                                            value={leaveEditData.from_date}
                                            onChange={(e) => setLeaveEditData({ ...leaveEditData, from_date: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">To Date</label>
                                        <Input
                                            type="date"
                                            value={leaveEditData.to_date}
                                            onChange={(e) => setLeaveEditData({ ...leaveEditData, to_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                                {leaveEditHardWarnings.length > 0 && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 space-y-1">
                                        {leaveEditHardWarnings.map((w) => <p key={w}>{w}</p>)}
                                    </div>
                                )}
                                {leaveEditSoftWarnings.length > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                                        <p className="font-medium">Soft warnings</p>
                                        {leaveEditSoftWarnings.map((w) => <p key={w}>{w}</p>)}
                                    </div>
                                )}
                                {['pending_admin', 'pending', 'pending_manager'].includes(editingLeave.status) && (
                                    <p className="text-xs text-slate-500">
                                        Status: {getLeaveStatusLabel(editingLeave.status)} — edit is allowed while pending admin/manager.
                                    </p>
                                )}
                            </div>
                            <DialogFooter className="flex-col gap-2 sm:flex-row">
                                <Button className="w-full sm:w-auto"
                                    variant="outline"
                                    onClick={() => setShowEditLeaveDialog(false)}
                                >
                                    Cancel
                                </Button>
                                <Button 
                                    onClick={async () => {
                                        if (!leaveEditData.leave_type || !leaveEditData.from_date || !leaveEditData.to_date) {
                                            toast.error('Please fill in all required fields');
                                            return;
                                        }

                                        try {
                                            const conflicts = await evaluateLeaveConflicts({
                                                supabase,
                                                employeeId: editingLeave.employee_id,
                                                fromDate: leaveEditData.from_date,
                                                toDate: leaveEditData.to_date,
                                                leaveType: leaveEditData.leave_type,
                                                leaveDuration: leaveEditData.leave_duration,
                                                siteId: editingLeave.site_id || null,
                                                attachmentPath: editingLeave.attachment_path || null,
                                                excludingLeaveId: editingLeave.id,
                                                policy: leavePolicySettings || null,
                                            });
                                            setLeaveEditHardWarnings(conflicts.hard || []);
                                            setLeaveEditSoftWarnings(conflicts.soft || []);
                                            if (conflicts.hard?.length) {
                                                toast.error(conflicts.hard[0]);
                                                return;
                                            }
                                            if (conflicts.soft?.length) {
                                                const proceed = await confirmAction({
                                                    title: 'Save with warnings?',
                                                    message: `Warnings:\n• ${conflicts.soft.join('\n• ')}\n\nSave changes anyway?`,
                                                    confirmLabel: 'Save anyway',
                                                });
                                                if (!proceed) return;
                                            }

                                            const editorName = adminEmail || sessionStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'Admin';
                                            await updateLeaveRequestFields(supabase, {
                                                leaveId: editingLeave.id,
                                                leaveEditData,
                                                editorName,
                                                previousLeave: editingLeave,
                                            });

                                            toast.success('Leave request updated successfully');
                                            setShowEditLeaveDialog(false);
                                            setLeaveEditSoftWarnings([]);
                                            setLeaveEditHardWarnings([]);
                                            queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
                                            queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
                                            queryClient.invalidateQueries({ queryKey: ['shifts'] });
                                            queryClient.invalidateQueries({ queryKey: ['workerData'] });
                                        } catch (error) {
                                            console.error('Error updating leave:', error);
                                            toast.error(error.message || 'Failed to update leave request');
                                        }
                                    }} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700">
                                    Save changes
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-slate-500">Loading leave data...</p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Leave policy & blackout dialog */}
            <Dialog open={showLeavePolicyDialog} onOpenChange={setShowLeavePolicyDialog}>
                <DialogContent className={cn(glassDialog, 'max-w-2xl max-h-[85vh] overflow-y-auto')}>
                    <DialogHeader>
                        <DialogTitle>Leave policy &amp; blackouts</DialogTitle>
                        <DialogDescription>
                            Company leave rules and blackout periods. Half-day work policy is stored for display; backend currently keeps work when enabled.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Max concurrent (company)</label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={leavePolicyForm.max_concurrent_company ?? 10}
                                    onChange={(e) =>
                                        setLeavePolicyForm((p) => ({
                                            ...p,
                                            max_concurrent_company: Number(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Max concurrent (per site)</label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={leavePolicyForm.max_concurrent_per_site ?? 5}
                                    onChange={(e) =>
                                        setLeavePolicyForm((p) => ({
                                            ...p,
                                            max_concurrent_per_site: Number(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">MC attachment min days</label>
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={leavePolicyForm.mc_attachment_min_days ?? 1}
                                    onChange={(e) =>
                                        setLeavePolicyForm((p) => ({
                                            ...p,
                                            mc_attachment_min_days: Number(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Withdraw approved (hours)</label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={leavePolicyForm.withdraw_approved_hours ?? 24}
                                    onChange={(e) =>
                                        setLeavePolicyForm((p) => ({
                                            ...p,
                                            withdraw_approved_hours: Number(e.target.value),
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                                <label className="text-sm font-medium">PH leave rule</label>
                                <Select
                                    value={leavePolicyForm.ph_leave_rule || 'exclude_charge'}
                                    onValueChange={(v) =>
                                        setLeavePolicyForm((p) => ({ ...p, ph_leave_rule: v }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="exclude_charge">Exclude charge (skip Sun/PH)</SelectItem>
                                        <SelectItem value="charge_leave">Charge leave (all calendar days)</SelectItem>
                                        <SelectItem value="ph_credit_only">PH credit only</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="mt-1 text-xs text-slate-500">
                                    {phLeaveRuleLabel(leavePolicyForm.ph_leave_rule)}
                                </p>
                            </div>
                            <div className="sm:col-span-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-slate-300"
                                        checked={!!leavePolicyForm.half_day_keeps_work}
                                        onChange={(e) =>
                                            setLeavePolicyForm((p) => ({
                                                ...p,
                                                half_day_keeps_work: e.target.checked,
                                            }))
                                        }
                                    />
                                    Half-day leave keeps same-day work
                                </label>
                                <p className="text-xs text-slate-600">
                                    {halfDayWorkPolicyLabel(!!leavePolicyForm.half_day_keeps_work)}
                                </p>
                            </div>
                        </div>
                        <Button
                            type="button"
                            className="bg-brand hover:bg-brand-hover"
                            disabled={saveLeavePolicyMutation.isPending}
                            onClick={() =>
                                saveLeavePolicyMutation.mutate({
                                    max_concurrent_company: Number(leavePolicyForm.max_concurrent_company) || 10,
                                    max_concurrent_per_site: Number(leavePolicyForm.max_concurrent_per_site) || 5,
                                    mc_attachment_min_days: Number(leavePolicyForm.mc_attachment_min_days) || 1,
                                    withdraw_approved_hours: Number(leavePolicyForm.withdraw_approved_hours) || 24,
                                    half_day_keeps_work: !!leavePolicyForm.half_day_keeps_work,
                                    ph_leave_rule: leavePolicyForm.ph_leave_rule || 'exclude_charge',
                                })
                            }
                        >
                            {saveLeavePolicyMutation.isPending ? 'Saving…' : 'Save policy'}
                        </Button>

                        <div className="border-t border-slate-200 pt-4 space-y-3">
                            <h3 className="text-sm font-semibold text-slate-800">Blackout dates</h3>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-600">From</label>
                                    <Input
                                        type="date"
                                        value={blackoutForm.from_date}
                                        onChange={(e) =>
                                            setBlackoutForm((p) => ({ ...p, from_date: e.target.value }))
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-600">To</label>
                                    <Input
                                        type="date"
                                        value={blackoutForm.to_date}
                                        onChange={(e) =>
                                            setBlackoutForm((p) => ({ ...p, to_date: e.target.value }))
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-600">Site (optional)</label>
                                    <Select
                                        value={blackoutForm.site_id || '__all__'}
                                        onValueChange={(v) =>
                                            setBlackoutForm((p) => ({
                                                ...p,
                                                site_id: v === '__all__' ? '' : v,
                                            }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Company-wide" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__all__">Company-wide</SelectItem>
                                            {(allSites || []).map((s) => (
                                                <SelectItem key={s.id} value={String(s.id)}>
                                                    {s.name || s.site_name || s.id}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-600">Reason</label>
                                    <Input
                                        value={blackoutForm.reason}
                                        onChange={(e) =>
                                            setBlackoutForm((p) => ({ ...p, reason: e.target.value }))
                                        }
                                        placeholder="e.g. Peak season"
                                    />
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    !blackoutForm.from_date ||
                                    !blackoutForm.to_date ||
                                    addBlackoutMutation.isPending
                                }
                                onClick={() => {
                                    if (blackoutForm.to_date < blackoutForm.from_date) {
                                        toast.error('To date must be on or after from date');
                                        return;
                                    }
                                    addBlackoutMutation.mutate({
                                        from_date: blackoutForm.from_date,
                                        to_date: blackoutForm.to_date,
                                        site_id: blackoutForm.site_id || null,
                                        reason: blackoutForm.reason || null,
                                    });
                                }}
                            >
                                Add blackout
                            </Button>
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {(leaveBlackoutDates || []).length === 0 ? (
                                    <p className="text-xs text-slate-500">No blackout periods.</p>
                                ) : (
                                    leaveBlackoutDates.map((b) => (
                                        <div
                                            key={b.id}
                                            className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                                        >
                                            <div>
                                                <p className="font-medium text-slate-800">
                                                    {b.from_date} → {b.to_date}
                                                </p>
                                                <p className="text-slate-500">
                                                    {b.site_id
                                                        ? `Site: ${
                                                              allSites.find((s) => String(s.id) === String(b.site_id))
                                                                  ?.name || b.site_id
                                                          }`
                                                        : 'Company-wide'}
                                                    {b.reason ? ` · ${b.reason}` : ''}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-red-600"
                                                onClick={() => deleteBlackoutMutation.mutate(b.id)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowLeavePolicyDialog(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        {/* Manager Management Dialog */}
        <Dialog open={showManagerDialog} onOpenChange={setShowManagerDialog}>
            <DialogContent className={cn(glassDialog, 'max-w-4xl max-h-[80vh] overflow-y-auto')}>
                <DialogHeader>
                    <DialogTitle>Manager Management</DialogTitle>
                    <DialogDescription>
                        View, edit, and add manager accounts.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-6">
                    {/* Add/Edit Manager Form */}
                    <div className="border rounded-lg p-4 bg-slate-50">
                        <h3 className="text-lg font-semibold mb-4">
                            {editingManager ? 'Edit Manager' : 'Add New Manager'}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Name</label>
                                <Input
                                    value={managerFormData.name}
                                    onChange={(e) => setManagerFormData({...managerFormData, name: e.target.value})}
                                    placeholder="Enter manager name"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Email</label>
                                <Input
                                    type="email"
                                    value={managerFormData.email}
                                    onChange={(e) => setManagerFormData({...managerFormData, email: e.target.value})}
                                    placeholder="Enter email"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Password</label>
                                <Input
                                    type="password"
                                    value={managerFormData.password_hash}
                                    onChange={(e) => setManagerFormData({...managerFormData, password_hash: e.target.value})}
                                    placeholder="Enter password"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <Button onClick={handleSaveManager} className="bg-green-600 hover:bg-green-700">
                                {editingManager ? 'Update Manager' : 'Add Manager'}
                            </Button>
                            <Button variant="outline" onClick={() => {
                                setShowManagerDialog(false);
                                setEditingManager(null);
                            }}>
                                Cancel
                            </Button>
                        </div>
                    </div>

                    {/* Managers List */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Current Managers</h3>
                        {isLoadingManagers ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {managers.map((manager) => (
                                    <div key={manager.id} className="flex items-center justify-between p-3 border rounded-lg">
                                        <div className="flex-1">
                                            <div className="font-medium">{manager.name}</div>
                                            <div className="text-sm text-slate-600">{manager.email}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleEditManager(manager)}
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => handleDeleteManager(manager.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {managers.length === 0 && (
                                    <div className="text-center py-8 text-slate-500">
                                        No managers found. Add your first manager above.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>

        {/* Supervisor Management Dialog */}
        <Dialog open={showSupervisorDialog} onOpenChange={setShowSupervisorDialog}>
            <DialogContent className={cn(glassDialog, 'max-w-4xl max-h-[80vh] overflow-y-auto')}>
                <DialogHeader>
                    <DialogTitle>Supervisor Management</DialogTitle>
                    <DialogDescription>
                        View, edit, and add supervisor accounts.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Add/Edit Supervisor Form */}
                    <div className="border rounded-lg p-4 bg-slate-50">
                        <h3 className="text-lg font-semibold mb-4">
                            {editingSupervisor ? 'Edit Supervisor' : 'Add New Supervisor'}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium">Supervisor ID</label>
                                <Input
                                    value={supervisorFormData.supervisor_id}
                                    onChange={(e) => setSupervisorFormData({...supervisorFormData, supervisor_id: e.target.value})}
                                    placeholder="Enter supervisor ID"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Name</label>
                                <Input
                                    value={supervisorFormData.name}
                                    onChange={(e) => setSupervisorFormData({...supervisorFormData, name: e.target.value})}
                                    placeholder="Enter supervisor name"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Password</label>
                                <Input
                                    type="password"
                                    value={supervisorFormData.password_hash}
                                    onChange={(e) => setSupervisorFormData({...supervisorFormData, password_hash: e.target.value})}
                                    placeholder="Enter password"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Site</label>
                                <Select
                                    value={supervisorFormData.site_id}
                                    onValueChange={(value) => setSupervisorFormData({...supervisorFormData, site_id: value})}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select site" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allSites.filter((site) => site.is_active !== false).map((site) => (
                                            <SelectItem key={site.id} value={site.id}>
                                                {site.site_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Email (Optional)</label>
                                <Input
                                    type="email"
                                    value={supervisorFormData.email}
                                    onChange={(e) => setSupervisorFormData({...supervisorFormData, email: e.target.value})}
                                    placeholder="Enter email"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Phone (Optional)</label>
                                <Input
                                    value={supervisorFormData.phone}
                                    onChange={(e) => setSupervisorFormData({...supervisorFormData, phone: e.target.value})}
                                    placeholder="Enter phone number"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <Button onClick={handleSaveSupervisor} className="bg-blue-600 hover:bg-blue-700">
                                {editingSupervisor ? 'Update Supervisor' : 'Add Supervisor'}
                            </Button>
                            <Button variant="outline" onClick={() => {
                                setShowSupervisorDialog(false);
                                setEditingSupervisor(null);
                            }}>
                                Cancel
                            </Button>
                        </div>
                    </div>

                    {/* Supervisors List */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Current Supervisors</h3>
                        {isLoadingSupervisors ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {supervisors.map((supervisor) => (
                                    <div key={supervisor.id} className="flex items-center justify-between p-3 border rounded-lg">
                                        <div className="flex-1">
                                            <div className="font-medium">{supervisor.name}</div>
                                            <div className="text-sm text-slate-600">ID: {supervisor.supervisor_id}</div>
                                            <div className="text-sm text-slate-600">Site: {supervisor.sites?.site_name || 'Unknown'}</div>
                                            {supervisor.email && <div className="text-sm text-slate-600">{supervisor.email}</div>}
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleEditSupervisor(supervisor)}
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => handleDeleteSupervisor(supervisor.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {supervisors.length === 0 && (
                                    <div className="text-center py-8 text-slate-500">
                                        No supervisors found. Add your first supervisor above.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>

        {/* Pass Out Payslip Dialog - Mode Selection */}
        <Dialog open={showPassOutPayslipDialog && !passOutPayslipMode} onOpenChange={(open) => {
            if (!open) {
                setShowPassOutPayslipDialog(false);
                setPassOutPayslipMode('');
            }
        }}>
            <DialogContent className={glassDialog}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={Download} tone="violet" />
                        Pass Out Payslip
                    </DialogTitle>
                    <DialogDescription>
                        Send a payslip to one worker or generate for everyone.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 py-2 sm:flex-row">
                    <AdminChoiceCard
                        icon={User}
                        tone="sky"
                        title="Individual"
                        subtitle="One worker"
                        hint="ID, month, bonus, and deductions"
                        onClick={() => setPassOutPayslipMode('individual')}
                    />
                    <AdminChoiceCard
                        icon={Users}
                        tone="violet"
                        title="All workers"
                        subtitle="Batch generation"
                        hint="Configure each worker after picking the month"
                        onClick={() => setPassOutPayslipMode('all')}
                    />
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button variant="outline" className="h-11 rounded-xl w-full sm:w-auto" onClick={() => {
                        setShowPassOutPayslipDialog(false);
                        setPassOutPayslipMode('');
                    }}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Pass Out Payslip Dialog - Individual */}
        <Dialog open={showPassOutPayslipDialog && passOutPayslipMode === 'individual'} onOpenChange={(open) => {
            if (!open) {
                setShowPassOutPayslipDialog(false);
                setPassOutPayslipMode('');
            }
        }}>
            <DialogContent className={cn(glassDialog, 'max-w-2xl max-h-[85vh] overflow-y-auto')}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={Download} tone="violet" />
                        Pass Out Payslip
                    </DialogTitle>
                    <DialogDescription>
                        Pass out payslip and timesheet for a specific worker.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <AdminFieldLabel>Worker ID</AdminFieldLabel>
                        <Input
                            placeholder="Enter Worker ID"
                            className={glassInput}
                            value={passOutPayslipWorkerId}
                            onChange={(e) => setPassOutPayslipWorkerId(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Month</AdminFieldLabel>
                        <Input
                            type="month"
                            className={glassInput}
                            value={passOutPayslipMonth}
                            onChange={(e) => setPassOutPayslipMonth(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Date of Salary Paid</AdminFieldLabel>
                        <Input
                            type="date"
                            className={glassInput}
                            value={passOutPayslipSalaryPaidDate}
                            onChange={(e) => setPassOutPayslipSalaryPaidDate(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Bonus (Optional)</AdminFieldLabel>
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            className={glassInput}
                            value={passOutPayslipBonus}
                            onChange={(e) => setPassOutPayslipBonus(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <AdminFieldLabel>Additions</AdminFieldLabel>
                        {passOutPayslipAdditions.map((addition, index) => (
                            <div key={index} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                                <div className="flex-1">
                                    <Input
                                        placeholder="Addition Name"
                                        value={addition.name}
                                        onChange={(e) => {
                                            const newAdditions = [...passOutPayslipAdditions];
                                            newAdditions[index].name = e.target.value;
                                            setPassOutPayslipAdditions(newAdditions);
                                        }}
                                    />
                                </div>
                                <div className="w-24">
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={addition.value}
                                        onChange={(e) => {
                                            const newAdditions = [...passOutPayslipAdditions];
                                            newAdditions[index].value = e.target.value;
                                            setPassOutPayslipAdditions(newAdditions);
                                        }}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        const newAdditions = passOutPayslipAdditions.filter((_, i) => i !== index);
                                        setPassOutPayslipAdditions(newAdditions.length > 0 ? newAdditions : [{ name: '', value: '' }]);
                                    }}
                                    disabled={passOutPayslipAdditions.length === 1}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPassOutPayslipAdditions([...passOutPayslipAdditions, { name: '', value: '' }])}
                        >
                            Add Addition
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Deductions</label>
                        {passOutPayslipDeductions.map((deduction, index) => (
                            <div key={index} className="flex gap-2 items-end">
                                <div className="flex-1">
                                    <Input
                                        placeholder="Deduction Type"
                                        value={deduction.type}
                                        onChange={(e) => {
                                            const newDeductions = [...passOutPayslipDeductions];
                                            newDeductions[index].type = e.target.value;
                                            setPassOutPayslipDeductions(newDeductions);
                                        }}
                                    />
                                </div>
                                <div className="w-24">
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={deduction.amount}
                                        onChange={(e) => {
                                            const newDeductions = [...passOutPayslipDeductions];
                                            newDeductions[index].amount = e.target.value;
                                            setPassOutPayslipDeductions(newDeductions);
                                        }}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        const newDeductions = passOutPayslipDeductions.filter((_, i) => i !== index);
                                        setPassOutPayslipDeductions(newDeductions.length > 0 ? newDeductions : [{ type: '', amount: '' }]);
                                    }}
                                    disabled={passOutPayslipDeductions.length === 1}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPassOutPayslipDeductions([...passOutPayslipDeductions, { type: '', amount: '' }])}
                        >
                            Add Deduction
                        </Button>
                    </div>
                    <PayslipBalancePicker
                        balances={passOutPayslipBalances}
                        selection={passOutPayslipBalanceSel}
                        onSelectionChange={setPassOutPayslipBalanceSel}
                        amountPaid={passOutPayslipAmountPaid}
                        onAmountPaidChange={setPassOutPayslipAmountPaid}
                    />
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button
                        variant="outline"
                        className="h-11 rounded-xl w-full sm:w-auto"
                        onClick={() => {
                            setShowPassOutPayslipDialog(false);
                            setPassOutPayslipMode('');
                            setPassOutPayslipWorkerId('');
                            setPassOutPayslipStartDate('');
                            setPassOutPayslipEndDate('');
                            setPassOutPayslipSalaryPaidDate('');
                            setPassOutPayslipBonus('');
                            setPassOutPayslipAdditions([{ name: '', value: '' }]);
                            setPassOutPayslipDeductions([{ type: '', amount: '' }]);
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={passOutPayslipIndividual}
                        className="h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)] w-full sm:w-auto"
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Pass Out Payslip
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Pass Out Payslip Dialog - All Workers */}
        <Dialog open={showPassOutPayslipDialog && passOutPayslipMode === 'all'} onOpenChange={(open) => {
            if (!open) {
                setShowPassOutPayslipDialog(false);
                setPassOutPayslipMode('');
                setPassOutPayslipAllStep(1);
            }
        }}>
            <DialogContent className={cn(glassDialog, 'max-w-4xl max-h-[85vh] overflow-y-auto')}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={Download} tone="violet" />
                        Pass Out Payslip — All Workers
                    </DialogTitle>
                    <DialogDescription>
                        {passOutPayslipAllStep === 1 && "Select the month for payslip generation"}
                        {passOutPayslipAllStep === 2 && "Configure payslip details for each worker"}
                    </DialogDescription>
                </DialogHeader>
                
                {passOutPayslipAllStep === 1 && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <AdminFieldLabel>Month</AdminFieldLabel>
                            <Input
                                type="month"
                                className={glassInput}
                                value={passOutPayslipMonth}
                                onChange={(e) => setPassOutPayslipMonth(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <AdminFieldLabel>Default Salary Paid Date (can be changed per worker)</AdminFieldLabel>
                            <Input
                                type="date"
                                className={glassInput}
                                value={passOutPayslipSalaryPaidDate}
                                onChange={(e) => setPassOutPayslipSalaryPaidDate(e.target.value)}
                            />
                        </div>
                        <DialogFooter className="flex-col gap-2 sm:flex-row">
                            <Button
                                variant="outline"
                                className="h-11 rounded-xl w-full sm:w-auto"
                                onClick={() => {
                                    setShowPassOutPayslipDialog(false);
                                    setPassOutPayslipMode('');
                                    setPassOutPayslipAllStep(1);
                                    setPassOutPayslipMonth('');
                                    setPassOutPayslipSalaryPaidDate('');
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handlePassOutAllWorkersPeriodSubmit}
                                disabled={!passOutPayslipMonth}
                                className="h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)] w-full sm:w-auto"
                            >
                                Next
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {passOutPayslipAllStep === 2 && (
                    <div className="space-y-4">
                        <div className="text-sm text-gray-600">
                            Month: {passOutPayslipMonth ? (() => {
                                const [y, m] = passOutPayslipMonth.split('-');
                                return `${String(m).padStart(2, '0')}/${y}`;
                            })() : '—'}
                        </div>
                        
                        {passOutPayslipAllWorkers.length > 0 ? (
                            <div className="space-y-2">
                                <h3 className="font-medium">Workers ({passOutPayslipAllWorkers.length})</h3>
                                <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                                    {passOutPayslipAllWorkers.map((worker, index) => (
                                        <div key={worker.employee_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <div className="font-medium">{worker.employee_name || worker.name}</div>
                                                    <div className="text-sm text-gray-600">ID: {worker.employee_id} | Type: {worker.worker_type}</div>
                                                </div>
                                            </div>
                                            <div className="space-y-2 mt-2">
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium">Salary Paid Date</label>
                                                    <Input
                                                        type="date"
                                                        value={worker.salary_paid_date || ''}
                                                        onChange={(e) => {
                                                            const updated = [...passOutPayslipAllWorkers];
                                                            updated[index].salary_paid_date = e.target.value;
                                                            setPassOutPayslipAllWorkers(updated);
                                                        }}
                                                        className="text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium">Bonus</label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={worker.bonus || '0'}
                                                        onChange={(e) => {
                                                            const updated = [...passOutPayslipAllWorkers];
                                                            updated[index].bonus = e.target.value;
                                                            setPassOutPayslipAllWorkers(updated);
                                                        }}
                                                        className="text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium">Additions</label>
                                                    {worker.additions.map((addition, addIndex) => (
                                                        <div key={addIndex} className="flex gap-1">
                                                            <Input
                                                                placeholder="Name"
                                                                value={addition.name}
                                                                onChange={(e) => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].additions[addIndex].name = e.target.value;
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs flex-1"
                                                            />
                                                            <Input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={addition.value}
                                                                onChange={(e) => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].additions[addIndex].value = e.target.value;
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs w-20"
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].additions = updated[index].additions.filter((_, i) => i !== addIndex);
                                                                    if (updated[index].additions.length === 0) {
                                                                        updated[index].additions = [{ name: '', value: '' }];
                                                                    }
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs px-2"
                                                            >
                                                                ×
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            const updated = [...passOutPayslipAllWorkers];
                                                            updated[index].additions.push({ name: '', value: '' });
                                                            setPassOutPayslipAllWorkers(updated);
                                                        }}
                                                        className="text-xs w-full"
                                                    >
                                                        + Add
                                                    </Button>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-xs font-medium">Deductions</label>
                                                    {worker.deductions.map((deduction, dedIndex) => (
                                                        <div key={dedIndex} className="flex gap-1">
                                                            <Input
                                                                placeholder="Type"
                                                                value={deduction.type}
                                                                onChange={(e) => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].deductions[dedIndex].type = e.target.value;
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs flex-1"
                                                            />
                                                            <Input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                value={deduction.amount}
                                                                onChange={(e) => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].deductions[dedIndex].amount = e.target.value;
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs w-20"
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    const updated = [...passOutPayslipAllWorkers];
                                                                    updated[index].deductions = updated[index].deductions.filter((_, i) => i !== dedIndex);
                                                                    if (updated[index].deductions.length === 0) {
                                                                        updated[index].deductions = [{ type: '', amount: '' }];
                                                                    }
                                                                    setPassOutPayslipAllWorkers(updated);
                                                                }}
                                                                className="text-xs px-2"
                                                            >
                                                                ×
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            const updated = [...passOutPayslipAllWorkers];
                                                            updated[index].deductions.push({ type: '', amount: '' });
                                                            setPassOutPayslipAllWorkers(updated);
                                                        }}
                                                        className="text-xs w-full"
                                                    >
                                                        + Add
                                                    </Button>
                                                </div>
                                                <PayslipBalancePicker
                                                    compact
                                                    balances={worker.open_balances || []}
                                                    selection={worker.balance_sel || {}}
                                                    onSelectionChange={(sel) =>
                                                        setPassOutPayslipAllWorkers((prev) => prev.map((w, i) => (i === index ? { ...w, balance_sel: sel } : w)))
                                                    }
                                                    amountPaid={worker.amount_paid ?? ''}
                                                    onAmountPaidChange={(value) =>
                                                        setPassOutPayslipAllWorkers((prev) => prev.map((w, i) => (i === index ? { ...w, amount_paid: value } : w)))
                                                    }
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                No workers found
                            </div>
                        )}
                        
                        {/* Compact Progress Bar */}
                        {passOutPayslipProgress.isGenerating && (
                            <div className="px-6 py-3 border-t bg-slate-50">
                                <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                                    <span className="font-medium">Generating payslips...</span>
                                    <span className="font-semibold">{passOutPayslipProgress.current} / {passOutPayslipProgress.total}</span>
                                </div>
                                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className="bg-[var(--g-brand)] h-1.5 rounded-full transition-all duration-200 ease-out"
                                        style={{
                                            width: `${passOutPayslipProgress.total > 0 ? (passOutPayslipProgress.current / passOutPayslipProgress.total) * 100 : 0}%`
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                        
                        <DialogFooter className="flex-col gap-2 sm:flex-row">
                            <Button className="w-full sm:w-auto"
                                variant="outline"
                                onClick={() => {
                                    setPassOutPayslipAllStep(1);
                                    setPassOutPayslipProgress({ current: 0, total: 0, isGenerating: false });
                                }}
                                disabled={passOutPayslipProgress.isGenerating}
                            >
                                Back
                            </Button>
                            <Button
                                onClick={handlePassOutPayslipAllWorkers}
                                disabled={passOutPayslipAllWorkers.length === 0 || passOutPayslipProgress.isGenerating}
                                className="h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)] w-full sm:w-auto"
                            >
                                {passOutPayslipProgress.isGenerating ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4 mr-2" />
                                        Pass Out All Payslips
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>

        {/* Pass Out Timesheet Dialog - Mode Selection */}
        <Dialog open={showPassOutTimesheetDialog && !passOutTimesheetMode} onOpenChange={(open) => {
            if (!open) setShowPassOutTimesheetDialog(false);
        }}>
            <DialogContent className={glassDialog}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={FileText} tone="teal" />
                        Pass Out Timesheet
                    </DialogTitle>
                    <DialogDescription>
                        Send timesheets for worker approval.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 py-2 sm:flex-row">
                    <AdminChoiceCard
                        icon={User}
                        tone="sky"
                        title="Individual"
                        subtitle="One worker ID"
                        onClick={() => setPassOutTimesheetMode('individual')}
                    />
                    <AdminChoiceCard
                        icon={UserCheck}
                        tone="teal"
                        title="Group"
                        subtitle="Several IDs"
                        onClick={() => setPassOutTimesheetMode('group')}
                    />
                    <AdminChoiceCard
                        icon={Users}
                        tone="violet"
                        title="All workers"
                        subtitle="Every active worker"
                        onClick={() => setPassOutTimesheetMode('all')}
                    />
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button variant="outline" className="h-11 rounded-xl w-full sm:w-auto" onClick={() => setShowPassOutTimesheetDialog(false)}>Cancel</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Pass Out Timesheet Dialog - Individual / Group / All */}
        <Dialog open={showPassOutTimesheetDialog && !!passOutTimesheetMode} onOpenChange={(open) => {
            if (!open) { setShowPassOutTimesheetDialog(false); setPassOutTimesheetMode(''); }
        }}>
            <DialogContent className={cn(glassDialog, 'max-w-md')}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={FileText} tone="teal" />
                        Pass Out Timesheet — {passOutTimesheetMode === 'individual' ? 'Individual' : passOutTimesheetMode === 'group' ? 'Group' : 'All Workers'}
                    </DialogTitle>
                    <DialogDescription>
                        {passOutTimesheetMode === 'all' ? 'Select month. Timesheets will be sent to all active workers.' : 'Select month and worker ID(s).'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <AdminFieldLabel>Month</AdminFieldLabel>
                        <Input type="month" className={glassInput} value={passOutTimesheetMonth} onChange={(e) => setPassOutTimesheetMonth(e.target.value)} />
                    </div>
                    {passOutTimesheetMode === 'individual' && (
                        <div className="space-y-2">
                            <AdminFieldLabel>Worker ID</AdminFieldLabel>
                            <Input placeholder="Enter Worker ID" className={glassInput} value={passOutTimesheetWorkerId} onChange={(e) => setPassOutTimesheetWorkerId(e.target.value)} />
                        </div>
                    )}
                    {passOutTimesheetMode === 'group' && (
                        <div className="space-y-2">
                            <AdminFieldLabel>Worker IDs (comma or space separated)</AdminFieldLabel>
                            <Input placeholder="e.g. W001, W002, W003" className={glassInput} value={passOutTimesheetWorkerIds} onChange={(e) => setPassOutTimesheetWorkerIds(e.target.value)} />
                        </div>
                    )}
                </div>
                {passOutTimesheetProgress.isGenerating && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{passOutTimesheetProgress.current} / {passOutTimesheetProgress.total}</span>
                    </div>
                )}
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button variant="outline" className="h-11 rounded-xl w-full sm:w-auto" onClick={() => { setShowPassOutTimesheetDialog(false); setPassOutTimesheetMode(''); }} disabled={passOutTimesheetProgress.isGenerating}>Cancel</Button>
                    <Button onClick={passOutTimesheet} disabled={!passOutTimesheetMonth || passOutTimesheetProgress.isGenerating || (passOutTimesheetMode === 'individual' && !passOutTimesheetWorkerId?.trim()) || (passOutTimesheetMode === 'group' && !passOutTimesheetWorkerIds?.trim())} className="h-11 rounded-xl bg-teal-600 hover:bg-teal-700 w-full sm:w-auto">
                        {passOutTimesheetProgress.isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : 'Pass Out Timesheet'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        </div>
    );
};
