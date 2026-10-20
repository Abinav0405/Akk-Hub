/**
 * Employee home — ONE page for every employee feature (merged portal).
 *
 * Base: Timesheet Manager's worker portal (clock in/out by site QR, breaks, leave, payslips,
 * timesheets, company forms, driver journeys, account). Added: Material Tracker (take / return,
 * my requests) and Site Progress (submit photos, my submissions) with live counts, and a hub
 * sign-out that ends every module session.
 * Copied from src/modules/timesheet/pages/WorkerPortal.jsx (that file is superseded).
 */
import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { storageKey } from '@/core/storage';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    Bell, Clock, Coffee, LogOut, Calendar, AlertCircle, FileText, Loader2, Download, Key, HelpCircle, Printer, ClipboardList, History, Car, ChevronDown, Fingerprint, ClipboardCheck, Languages, Boxes, PackagePlus, Camera, Link2, ShieldCheck
} from "lucide-react";
import { useMaterialsSummary, useProgressSummary } from '@/pages/employee/useEmployeeModules';
import { signOutEverywhere } from '@/core/auth/identity';
import { paths } from '@/app/paths';
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl, cn } from '@/modules/timesheet/lib/utils';
import LanguageSwitcher from '@/core-i18n';
import { useLanguage } from '@/core-i18n';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseTimesheet as supabase } from '@/core/supabase';
import DriverStatusCard from '@/modules/timesheet/components/DriverStatusCard';
import ScanSuccessOverlay from '@/modules/timesheet/components/ScanSuccessOverlay';
import ScanFailureOverlay from '@/modules/timesheet/components/ScanFailureOverlay';
import {
    ActionTiles,
    AttendanceDock as HomeDock,
    FormsBanner,
    HomeHeader,
    ListGroup,
    NotificationsList,
    ShiftCard,
} from '@/modules/timesheet/components/worker/WorkerHome';
import { disableBiometricLogin, getBiometricPrefs } from '@/core/auth/biometric';
import { endLoginCurtain, isLoginCurtainOpen } from '@/core/auth/loginCurtain';
import { formatTime, formatDate, calculateShiftHours, getAutoBreaksToCreate, toSingaporeDateStr, parseDateOnly, getTodaySingapore } from '@/modules/timesheet/lib/timeUtils';
import {
    buildLeaveBalancePreview,
    countRequestedLeaveDays,
    evaluateLeaveConflicts,
    fetchLeavePolicy,
    findOverlappingLeaveRequests,
    getBalanceFieldForLeaveType,
    getLatestWorkerSiteId,
    getLeaveStatusLabel,
    halfDayWorkPolicyLabel,
    normalizeLeaveType,
    phLeaveRuleLabel,
    prepareLeaveAttachment,
    requiresMedicalAttachment,
    sumPendingReservedDays,
} from '@/modules/timesheet/lib/leaveService';
import { approximateTime, approximateTimeISO } from '@/modules/timesheet/lib/timeApproximation';
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { clearWorkerSession, revokeRoleSession, changeWorkerPassword, verifyRoleSession } from '@/core/auth/timesheetSession';
import { pendingOnCompleteFields, isShiftApproved, shiftNeedsApprovalActions } from '@/modules/timesheet/lib/shiftApproval';
import { ShiftApprovalStatusBadge } from '@/modules/timesheet/components/ShiftApprovalActions';
import { unregisterPushDevice } from '@/modules/timesheet/lib/pushRegistration';
import {
    getActiveJourneyForWorker,
    startJourney,
    endJourney,
    startBreak,
    endBreak,
} from '@/modules/timesheet/lib/vehicleService';
import {
    startVehicleTracking,
    stopVehicleTracking,
    resumeVehicleTrackingIfNeeded,
    pauseVehicleTrackingUploads,
    resumeVehicleTrackingUploads,
    captureCurrentPosition,
    getLastKnownCoords,
    getCurrentTrackingJourneyId,
} from '@/modules/timesheet/lib/vehicleTracking';
import { requestVehicleTrackingPermissions, getGpsErrorMessage, isNativeAppVehicleTrackingDisabled, getUseWebsiteForDrivingMessage } from '@/modules/timesheet/lib/vehicleTrackingNotification';
import { formatDuration } from '@/modules/timesheet/lib/vehicleJourneyStats';
import {
    useMobileTouchOptimized,
    usePauseRefetchWhileTouching,
} from '@/modules/timesheet/lib/mobileTouch';
import { registerNativeBackHandler } from '@/core/nativeShell';
import { getSingaporeGreeting } from '@/ui/native/NativeChrome';
import TopBar from '@/ui/hub/TopBar';
import { isAppUI, useWideLayout } from '@/core/platform';

// Camera, PDF and tutorial code are only needed after an explicit action. Keeping them out of
// the first employee-home chunk makes the post-login screen responsive on lower-end phones.
const QRScanner = lazy(() => import('@/modules/timesheet/components/QRScanner'));
const VehicleQRScanner = lazy(() => import('@/modules/timesheet/components/VehicleQRScanner'));
const AppTour = lazy(() => import('@/modules/timesheet/components/AppTour'));
const BiometricLoginSettings = lazy(() => import('@/modules/timesheet/components/biometric/BiometricLoginSettings'));

function DeferredFeatureLoading({ label = 'Loading…' }) {
    return (
        <div className="flex min-h-36 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            {label}
        </div>
    );
}

/** Capacitor app (Android). The website keeps its original markup below. */
const NATIVE_APP = Capacitor.isNativePlatform();

function seenStorageKey(kind, workerId) {
    return `akk_worker_seen_${kind}_${workerId}`;
}

function readSeenRecord(kind, workerId) {
    if (!workerId) return null;
    try {
        const raw = localStorage.getItem(seenStorageKey(kind, workerId));
        if (raw == null) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writeSeenRecord(kind, workerId, record) {
    if (!workerId) return;
    try {
        localStorage.setItem(seenStorageKey(kind, workerId), JSON.stringify(record));
    } catch {
        /* ignore quota */
    }
}

export default function EmployeeHome() {
    const materialsSummary = useMaterialsSummary();
    const progressSummary = useProgressSummary();
    const { t } = useLanguage();
    const [activeScan, setActiveScan] = useState(null); // 'entry', 'breaks', 'leave'
    const [currentShift, setCurrentShift] = useState(null);
    const [isScanProcessing, setIsScanProcessing] = useState(false);
    const [isPasswordProcessing, setIsPasswordProcessing] = useState(false);
    const isScanProcessingRef = useRef(false);
    const activeScanRef = useRef(null);
    const currentShiftRef = useRef(null);

    useEffect(() => { activeScanRef.current = activeScan; }, [activeScan]);
    useEffect(() => { currentShiftRef.current = currentShift; }, [currentShift]);
    /** Wallet-style full-screen success after QR scan completes */
    const [scanCelebration, setScanCelebration] = useState(null); // { title, subtitle? }

    const dismissScanCelebration = useCallback(() => setScanCelebration(null), []);

    const showScanCelebration = useCallback((payload) => {
        setScanCelebration(payload);
    }, []);

    const [scanFailure, setScanFailure] = useState(null);
    const [driverStatusExpanded, setDriverStatusExpanded] = useState(false);
    const [showDriverActionDialog, setShowDriverActionDialog] = useState(false);
    const [pendingDriverScan, setPendingDriverScan] = useState(null);
    const dismissScanFailure = useCallback(() => setScanFailure(null), []);
    const showScanFailure = useCallback((payload) => {
        setScanFailure(payload);
    }, []);

    /** QR scanner row-level validation: close scanner + failure overlay (replaces onScanError). */
    const handleQrValidationFailure = useCallback((payload) => {
        setActiveScan(null);
        showScanFailure(payload);
    }, [showScanFailure]);

    const navigate = useNavigate();

    const [showLeaveRequestDialog, setShowLeaveRequestDialog] = useState(false);
    const [showPasswordDialog, setShowPasswordDialog] = useState(false);
    const [showBiometricDialog, setShowBiometricDialog] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    /** Header collapses to just the name once the page scrolls (sentinel leaves the viewport). */
    const [headerCompact, setHeaderCompact] = useState(false);
    const topSentinelRef = useRef(null);
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [leaveRequestData, setLeaveRequestData] = useState({
        leave_type: '',
        leave_duration: 'full_day',
        from_date: '',
        to_date: '',
        reason: ''
    });
    const [leaveAttachmentFile, setLeaveAttachmentFile] = useState(null);
    const [leaveConflictHard, setLeaveConflictHard] = useState([]);
    const [leaveConflictSoft, setLeaveConflictSoft] = useState([]);

    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim(),
    );
    const [workerName, setWorkerName] = useState(() => localStorage.getItem(storageKey('timesheet', 'workerName')) || '');
    const mobileTouch = useMobileTouchOptimized();
    // Desktop (sidebar) layout: two-column dashboard, attendance buttons inline.
    const wide = useWideLayout();
    const pauseRefetchWhileTouching = usePauseRefetchWhileTouching();
    const [showPayslipDownloadDialog, setShowPayslipDownloadDialog] = useState(false);
    /** In-app HTML preview (mobile-friendly: full-screen read; Download exports PDF) */
    const [documentPreview, setDocumentPreview] = useState(null);
    const [isPreviewPdfExporting, setIsPreviewPdfExporting] = useState(false);
    const [inboxSeenTick, setInboxSeenTick] = useState(0);
    const [isTutorialRunning, setIsTutorialRunning] = useState(false);
    const isNativeApp = Capacitor.isNativePlatform();

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker') {
                if (session.subject_id) setWorkerId(String(session.subject_id).trim());
                if (session.session_data?.workerName) setWorkerName(session.session_data.workerName);
            }
        });
    }, []);

    // Fetch worker's leave history
    const { data: workerLeaveRequests = [], isLoading: isLoadingLeaveHistory } = useQuery({
        queryKey: ['workerLeaveHistory', workerId],
        queryFn: async () => {
            if (!workerId) return [];

            const { data, error } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('employee_id', workerId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        },
        enabled: !!workerId
    });

    const workerType = localStorage.getItem(storageKey('timesheet', 'workerType')) || 'foreign';
    const workerTable = workerType === 'local' ? 'local_worker_details' : 'worker_details';
    const idField = workerType === 'local' ? 'employee_id' : 'employee_id';
    const queryClient = useQueryClient();

    const {
        data: activeVehicleJourney,
        refetch: refetchVehicleJourney,
        isFetched: vehicleJourneyFetched,
    } = useQuery({
        queryKey: ['activeVehicleJourney', workerId, workerType],
        queryFn: () => getActiveJourneyForWorker(workerId, workerType),
        enabled: !!workerId,
        refetchInterval: 20000,
        refetchIntervalInBackground: false,
        retry: false,
    });

    const activeVehicleJourneyRef = useRef(activeVehicleJourney);
    activeVehicleJourneyRef.current = activeVehicleJourney;

    useEffect(() => {
        if (!workerId) return;
        void resumeVehicleTrackingIfNeeded(() => getActiveJourneyForWorker(workerId, workerType));
    }, [workerId, workerType]);

    // Admin (or another device) ended/deleted the journey — stop local GPS so uploads do not linger.
    useEffect(() => {
        if (!vehicleJourneyFetched) return;
        const trackingId = getCurrentTrackingJourneyId();
        if (!trackingId) return;
        if (!activeVehicleJourney || activeVehicleJourney.id !== trackingId) {
            void stopVehicleTracking();
        }
    }, [activeVehicleJourney, vehicleJourneyFetched]);

    // Fetch worker's in_company status - redirect to login if no longer in company
    const { data: workerInCompany = true, isSuccess: workerInCompanyLoaded } = useQuery({
        queryKey: ['workerInCompany', workerId],
        queryFn: async () => {
            if (!workerId) return true;
            const { data, error } = await supabase
                .from(workerTable)
                .select('in_company')
                .eq(idField, workerId)
                .single();
            if (error) return false; // Fail closed — treat as inactive on error
            return data?.in_company !== false;
        },
        enabled: !!workerId
    });

    const workerTutorialSteps = useMemo(() => {
        const dock = { placement: 'top', disableScrolling: true };
        const steps = [
            {
                target: '[data-tour="worker-header"]',
                content: 'Your name and employee ID. The bell shows new payslips, leave updates and announcements; tap your initials for account settings.',
                disableBeacon: true,
            },
            {
                target: '[data-tour="worker-status"]',
                content: 'Your shift today: whether you are clocked in, your site, hours worked and breaks.',
            },
            {
                target: '[data-tour="worker-attendance"]',
                content: 'Scan to clock in when you arrive. During a shift this bar shows Break and Clock out.',
                ...dock,
            },
            {
                target: '[data-tour="worker-shortcuts"]',
                content: 'Shortcuts to timesheets, leave requests, payslips and company forms.',
            },
            {
                target: '[data-tour="worker-leave"]',
                content: 'Leave request opens the form to apply for leave with dates and a reason.',
            },
            {
                target: '[data-tour="worker-shift-history"]',
                content: 'Shift history lists your approved, pending, and past shifts.',
            },
            {
                target: '[data-tour="worker-leave-history"]',
                content: 'Leave history shows every leave application and your remaining balances.',
            },
            {
                target: '[data-tour="worker-scan-driver"]',
                content: 'Scan as driver starts or continues vehicle tracking. Use it when you need to scan the vehicle QR.',
            },
        ];
        if (workerInCompany) {
            steps.push(
                {
                    target: '[data-tour="worker-payslip"]',
                    content: 'Payslips lists passed-out payslips. View opens an on-screen preview; save exports a PDF.',
                },
                {
                    target: '[data-tour="worker-timesheets"]',
                    content: 'Timesheets is where you review, submit, or decline timesheets sent to you.',
                },
            );
        }
        return steps;
    }, [workerInCompany]);

    // Kick out workers no longer in company (e.g. was logged in when admin marked them)
    useEffect(() => {
        if (workerId && workerInCompanyLoaded && workerInCompany === false) {
            void unregisterPushDevice();
            clearWorkerSession();
            toast.error("Your account is no longer active. Please contact your employer.");
            navigate('/login', { replace: true });
        }
    }, [workerId, workerInCompanyLoaded, workerInCompany, navigate]);

    useEffect(() => {
        if (!documentPreview) return;
        window.__akkCloseTopOverlay = () => {
            setDocumentPreview(null);
            return true;
        };
        return () => {
            delete window.__akkCloseTopOverlay;
        };
    }, [documentPreview]);

    /** Native back while the QR scanner is open returns to the portal (not out of it). */
    useEffect(() => {
        if (!NATIVE_APP || !activeScan) return undefined;
        return registerNativeBackHandler(() => {
            if (!isScanProcessingRef.current) setActiveScan(null);
            return true;
        });
    }, [activeScan]);

    const announcementsQuery = useQuery({
        queryKey: ['announcements'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('announcements')
                .select('id, title, body, image_url, publish_at')
                .eq('is_active', true)
                .order('publish_at', { ascending: false })
                .limit(5);
            if (error) throw error;
            return data || [];
        },
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    const feedbackFormsQuery = useQuery({
        queryKey: ['worker-feedback-forms', workerId],
        enabled: !!workerId,
        queryFn: async () => {
            const { data: forms, error } = await supabase
                .from('feedback_forms')
                .select('id, title, description, publish_revision')
                .eq('is_published', true)
                .order('published_at', { ascending: false });
            if (error) throw error;
            if (!forms?.length) {
                return { incomplete: [], hasPublished: false, allComplete: false };
            }

            const { data: subs, error: subErr } = await supabase
                .from('feedback_form_submissions')
                .select('form_id, publish_revision')
                .eq('worker_id', workerId);
            if (subErr) throw subErr;

            const submittedKey = new Set(
                (subs || []).map((s) => `${s.form_id}:${s.publish_revision}`)
            );
            const incomplete = forms.filter(
                (f) => !submittedKey.has(`${f.id}:${f.publish_revision ?? 0}`)
            );
            return {
                incomplete,
                hasPublished: true,
                allComplete: incomplete.length === 0,
            };
        },
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
    });

    // Fetch passed out payslips
    const {
        data: fetchedPassedOutPayslips,
        isLoading: isLoadingPayslips,
        refetch: refetchPayslips,
    } = useQuery({
        queryKey: ['passedOutPayslips', workerId],
        queryFn: async () => {
            if (!workerId) return [];

            const { data, error } = await supabase
                .from('passed_out_payslips')
                .select('*')
                .eq('worker_id', workerId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching passed out payslips:', error);
                throw error;
            }
            return data || [];
        },
        enabled: !!workerId,
        /** Fallback when Realtime/RLS blocks postgres_changes — still notifies within this interval. */
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
    });

    // Use the query data directly instead of separate state to avoid infinite loops
    const passedOutPayslips = fetchedPassedOutPayslips ?? [];

    const payslipIdsSeenRef = useRef(null);

    useEffect(() => {
        payslipIdsSeenRef.current = null;
    }, [workerId]);

    useEffect(() => {
        if (!workerId) return;
        /** `data` is undefined until the first fetch settles; do not default it to [] or we seed "seen" as empty and then treat every payslip as new after cold start. */
        if (fetchedPassedOutPayslips === undefined) return;

        const list = fetchedPassedOutPayslips;
        const nextIds = new Set(list.map((p) => p.id));
        if (payslipIdsSeenRef.current === null) {
            payslipIdsSeenRef.current = nextIds;
            return;
        }
        const prev = payslipIdsSeenRef.current;
        for (const p of list) {
            if (!prev.has(p.id)) {
                void p;
            }
        }
        payslipIdsSeenRef.current = nextIds;
    }, [fetchedPassedOutPayslips, workerId]);

    const { data: actionTimesheets = [] } = useQuery({
        queryKey: ['passedOutTimesheets', workerId, 'actionBadge'],
        queryFn: async () => {
            if (!workerId) return [];
            const { data, error } = await supabase
                .from('passed_out_timesheets')
                .select('id, status')
                .eq('worker_id', workerId)
                .in('status', ['pending_worker', 'returned_to_worker']);
            if (error) throw error;
            return data || [];
        },
        enabled: !!workerId,
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
    });

    useEffect(() => {
        if (!workerId || fetchedPassedOutPayslips === undefined) return;
        if (readSeenRecord('payslips', workerId) != null) return;
        const seeded = {};
        for (const p of fetchedPassedOutPayslips) seeded[p.id] = true;
        writeSeenRecord('payslips', workerId, seeded);
        setInboxSeenTick((n) => n + 1);
    }, [workerId, fetchedPassedOutPayslips]);

    useEffect(() => {
        if (!workerId) return;
        if (readSeenRecord('leaves', workerId) != null) return;
        const seeded = {};
        for (const row of workerLeaveRequests) seeded[row.id] = row.status;
        writeSeenRecord('leaves', workerId, seeded);
        setInboxSeenTick((n) => n + 1);
    }, [workerId, workerLeaveRequests]);

    const unreadPayslipCount = useMemo(() => {
        if (!workerId || fetchedPassedOutPayslips === undefined) return 0;
        const seen = readSeenRecord('payslips', workerId);
        if (!seen) return 0;
        return fetchedPassedOutPayslips.filter((p) => !seen[p.id]).length;
    }, [workerId, fetchedPassedOutPayslips, inboxSeenTick]);

    const unreadLeaveCount = useMemo(() => {
        if (!workerId) return 0;
        const seen = readSeenRecord('leaves', workerId);
        if (!seen) return 0;
        return workerLeaveRequests.filter((row) => {
            const decided = row.status === 'approved' || row.status === 'rejected';
            if (!decided) return false;
            return seen[row.id] !== row.status;
        }).length;
    }, [workerId, workerLeaveRequests, inboxSeenTick]);

    const timesheetActionCount = actionTimesheets.length;

    const markPayslipsSeen = useCallback(() => {
        if (!workerId) return;
        const record = { ...(readSeenRecord('payslips', workerId) || {}) };
        for (const p of passedOutPayslips) record[p.id] = true;
        writeSeenRecord('payslips', workerId, record);
        setInboxSeenTick((n) => n + 1);
    }, [workerId, passedOutPayslips]);

    const markLeavesSeen = useCallback(() => {
        if (!workerId) return;
        const record = {};
        for (const row of workerLeaveRequests) record[row.id] = row.status;
        writeSeenRecord('leaves', workerId, record);
        setInboxSeenTick((n) => n + 1);
    }, [workerId, workerLeaveRequests]);

    // Submit leave request mutation
    const submitLeaveRequestMutation = useMutation({
        mutationFn: async (leaveData) => {
            // Block submission if ANY active (not rejected/cancelled) leave for this
            // worker overlaps the requested dates. Re-checked just before insert too,
            // because the attachment upload takes time and a double-tap / parallel
            // submit could insert a row meanwhile.
            const assertNoOverlap = async () => {
                const overlapping = await findOverlappingLeaveRequests({
                    supabase,
                    employeeId: workerId,
                    fromDate: leaveData.from_date,
                    toDate: leaveData.to_date,
                });
                if (overlapping.length > 0) {
                    const first = overlapping[0];
                    const fmtDayMonth = (dateStr) => {
                        const [, month, day] = String(dateStr || '').split('-');
                        return day && month ? `${day}/${month}` : dateStr;
                    };
                    const statusLabel = getLeaveStatusLabel(first.status).toLowerCase();
                    throw new Error(
                        `You already have leave ${statusLabel} for overlapping dates (${fmtDayMonth(first.from_date)} – ${fmtDayMonth(first.to_date)}). Please check your leave history — do not submit the same leave twice.`
                    );
                }
            };
            await assertNoOverlap();

            const site_id = await getLatestWorkerSiteId(supabase, workerId);

            // Full conflict evaluation (blackouts, concurrency, attachment, half-day, etc.)
            const conflicts = await evaluateLeaveConflicts({
                supabase,
                employeeId: workerId,
                fromDate: leaveData.from_date,
                toDate: leaveData.to_date,
                leaveType: leaveData.leave_type,
                leaveDuration: leaveData.leave_duration,
                siteId: site_id,
                attachmentPath: leaveData.attachmentFile ? 'pending-upload' : null,
                policy: leavePolicy || undefined,
            });
            if (conflicts.hard?.length) {
                throw new Error(conflicts.hard[0]);
            }
            if (conflicts.soft?.length) {
                conflicts.soft.forEach((msg) => toast.warning(msg));
            }

            // A balance shortfall must not block submission: on approval the days beyond the
            // balance are recorded as unpaid leave (and the form already tells the worker so).
            const balanceField = getBalanceFieldForLeaveType(leaveData.leave_type);
            if (balanceField && workerBalance && !isPlaceholderBalance) {
                const availableBalance = Number(workerBalance[balanceField] || 0);
                const reservedPendingDays = await sumPendingReservedDays({
                    supabase,
                    employeeId: workerId,
                    leaveType: leaveData.leave_type,
                });
                const shortfall = leaveData.days_requested - Math.max(0, availableBalance - reservedPendingDays);
                if (shortfall > 0) {
                    toast.warning(
                        `Your balance covers only part of this request — ${shortfall} day(s) will be recorded as unpaid leave if approved.`
                    );
                }
            }

            let attachment_path = null;
            if (leaveData.attachmentFile) {
                const prepared = await prepareLeaveAttachment(leaveData.attachmentFile);
                const rawName = prepared.name || 'attachment';
                const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
                const uploadPath = `${workerId}/${Date.now()}_${safeName}`;
                const { error: uploadError } = await supabase.storage
                    .from('leave-attachments')
                    .upload(uploadPath, prepared, { upsert: false, contentType: prepared.type || undefined });
                if (uploadError) {
                    console.error('Leave attachment upload failed:', uploadError);
                    throw new Error(
                        `Could not upload your attachment (${uploadError.message || 'upload error'}). Please try a smaller JPG/PDF file or check your connection.`
                    );
                }
                attachment_path = uploadPath;
            }

            const initialStatus = workerType === 'local' ? 'pending_admin' : 'pending_manager';

            await assertNoOverlap();

            const { error } = await supabase
                .from('leave_requests')
                .insert([{
                    employee_id: workerId,
                    leave_type: normalizeLeaveType(leaveData.leave_type),
                    leave_duration: leaveData.leave_duration,
                    from_date: leaveData.from_date,
                    to_date: leaveData.to_date,
                    reason: leaveData.reason || '',
                    status: initialStatus,
                    created_at: new Date().toISOString(),
                    days_requested: leaveData.days_requested,
                    attachment_path,
                    site_id,
                }]);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Leave request submitted successfully!');
            setShowLeaveRequestDialog(false);
            setLeaveRequestData({
                leave_type: '',
                leave_duration: 'full_day',
                from_date: '',
                to_date: '',
                reason: ''
            });
            setLeaveAttachmentFile(null);
            setLeaveConflictHard([]);
            setLeaveConflictSoft([]);
            queryClient.invalidateQueries(['workerLeaveHistory', workerId]);
            queryClient.invalidateQueries(['pendingReservedDays', workerId]);
        },
        onError: (error) => {
            console.error('Error submitting leave request:', error);
            toast.error(error.message || 'Failed to submit leave request');
        }
    });

    // Fetch company leave policy (once)
    const { data: leavePolicy } = useQuery({
        queryKey: ['leavePolicy'],
        queryFn: () => fetchLeavePolicy(supabase),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch worker's leave balances
    const { data: workerBalance, isLoading: isLoadingBalance, isPlaceholderData: isPlaceholderBalance } = useQuery({
        queryKey: ['workerBalance', workerId, workerType],
        queryFn: async () => {
            if (!workerId) return null;

            const { data, error } = await supabase
                .from(workerTable)
                .select('annual_leave_balance, medical_leave_balance, hospitalization_leave_balance, annual_leave_limit, medical_leave_limit, hospitalization_leave_limit')
                .eq(idField, workerId)
                .maybeSingle();

            if (error) {
                console.error('Error fetching worker balance:', error);
                // Unknown balance: hide the balance box rather than showing a misleading 0.
                return null;
            }

            return data || null;
        },
        enabled: !!workerId,
        // Provide default values while loading
        placeholderData: {
            annual_leave_balance: 0,
            medical_leave_balance: 0,
            hospitalization_leave_balance: 0,
            annual_leave_limit: 10,
            medical_leave_limit: 14,
            hospitalization_leave_limit: 60,
        }
    });

    // Pending reserved days for live balance preview
    const { data: pendingReservedDays = 0 } = useQuery({
        queryKey: ['pendingReservedDays', workerId, leaveRequestData.leave_type],
        queryFn: async () => {
            if (!workerId || !leaveRequestData.leave_type) return 0;
            return sumPendingReservedDays({
                supabase,
                employeeId: workerId,
                leaveType: leaveRequestData.leave_type,
            });
        },
        enabled: !!workerId && !!leaveRequestData.leave_type && showLeaveRequestDialog,
    });

    // Live conflict checks when leave form fields change
    useEffect(() => {
        if (
            !showLeaveRequestDialog ||
            !workerId ||
            !leaveRequestData.leave_type ||
            !leaveRequestData.from_date ||
            !leaveRequestData.to_date
        ) {
            setLeaveConflictHard([]);
            setLeaveConflictSoft([]);
            return;
        }

        let cancelled = false;
        const run = async () => {
            try {
                const siteId = await getLatestWorkerSiteId(supabase, workerId);
                const result = await evaluateLeaveConflicts({
                    supabase,
                    employeeId: workerId,
                    fromDate: leaveRequestData.from_date,
                    toDate: leaveRequestData.to_date,
                    leaveType: leaveRequestData.leave_type,
                    leaveDuration: leaveRequestData.leave_duration,
                    siteId,
                    attachmentPath: leaveAttachmentFile ? 'pending-upload' : null,
                    policy: leavePolicy || undefined,
                });
                if (!cancelled) {
                    setLeaveConflictHard(result.hard || []);
                    setLeaveConflictSoft(result.soft || []);
                }
            } catch (err) {
                // A failed advisory check must not leave stale errors disabling the Submit button.
                console.error('Leave conflict check failed:', err);
                if (!cancelled) {
                    setLeaveConflictHard([]);
                    setLeaveConflictSoft([]);
                }
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [
        showLeaveRequestDialog,
        workerId,
        leaveRequestData.leave_type,
        leaveRequestData.from_date,
        leaveRequestData.to_date,
        leaveRequestData.leave_duration,
        leaveAttachmentFile,
        leavePolicy,
    ]);

    // Realtime + FCM for workers: see `WorkerNotificationLayout` (stays mounted across portal / timesheets / leave history).

    // Fetch current shift (today's shifts and any active shifts from previous days)
    const { data: todaysShifts, refetch: refetchShift, isLoading: isLoadingShift } = useQuery({
        queryKey: ['currentShift', workerId],
        queryFn: async () => {
            if (!workerId) return [];

            // Use Singapore timezone to get correct date (fixes midnight shift date issue)
            const today = getTodaySingapore();
            // Fetching shifts for worker

            // First, fetch today's shifts
            const { data: todayShifts, error: todayError } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', workerId)
                .eq('work_date', today)
                .order('created_at', { ascending: false });

            if (todayError) {
                console.error('Error fetching todays shifts:', todayError);
                throw todayError;
            }

            // Also check for any active shifts from previous days (where has_left is false)
            const { data: activePreviousShifts, error: previousError } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', workerId)
                .eq('has_left', false)
                .lt('work_date', today)  // Only previous days
                .order('created_at', { ascending: false });

            if (previousError) {
                console.error('Error fetching previous active shifts:', previousError);
                throw previousError;
            }

            // Combine both sets of shifts
            const allShifts = [...(todayShifts || []), ...(activePreviousShifts || [])];
            
            // Remove duplicates (in case a shift appears in both queries)
            const uniqueShifts = allShifts.filter((shift, index, self) => 
                index === self.findIndex(s => s.id === shift.id)
            );

            // Sort by creation date (most recent first)
            uniqueShifts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            // If we have shifts, fetch site data separately for each
            if (uniqueShifts.length > 0) {
                const siteIds = [...new Set(uniqueShifts.map(shift => shift.site_id))];
                const { data: sites } = await supabase
                    .from('sites')
                    .select('id, site_name, latitude, longitude')
                    .in('id', siteIds);

                // Merge site data into shifts
                uniqueShifts.forEach(shift => {
                    shift.sites = sites?.find(s => s.id === shift.site_id) || null;
                });
            }

            return uniqueShifts;
        },
        refetchInterval: pauseRefetchWhileTouching ? false : 15_000,
        refetchIntervalInBackground: false,
        enabled: !!workerId
    });

    useEffect(() => {
        if (todaysShifts && todaysShifts.length > 0) {
            // First, try to find any active shift (has_left is false) from any day
            const activeShift = todaysShifts.find(shift => !shift.has_left);
            
            if (activeShift) {
                setCurrentShift(activeShift);
            } else {
                // If no active shifts, get the most recent shift
                setCurrentShift(todaysShifts[0]);
            }
        } else {
            setCurrentShift(null);
        }
    }, [todaysShifts]);

    const handleScanSuccess = async (site, qrToken) => {
        if (isScanProcessingRef.current) return;

        const scanAction = activeScanRef.current;
        const shift = currentShiftRef.current;

        if (!workerId || !site) {
            toast.error("Invalid site or missing worker information");
            showScanFailure({
                title: 'Scan unsuccessful',
                subtitle: 'Missing worker or site information.',
            });
            return;
        }

        isScanProcessingRef.current = true;
        setIsScanProcessing(true);

        try {
            const now = new Date();
            // Approximate the scan time
            const approximatedNow = approximateTime(now);
            if (!approximatedNow) {
                console.error('Time approximation failed, using original time');
                toast.error('Time approximation error. Please try again.');
                showScanFailure({
                    title: 'Could not record time',
                    subtitle: 'Please try scanning again.',
                });
                setIsScanProcessing(false);
                isScanProcessingRef.current = false;
                return;
            }
            const nowISO = approximatedNow.toISOString();
            
            // Use Singapore timezone to get correct date (fixes midnight shift date issue)
            const today = getTodaySingapore();
            
            const workerIdValue = workerId;
            const workerIdField = 'worker_id';

            if (scanAction === 'entry') {
                // First, check if there's an existing active shift from ANY day
                const { data: existingShift, error: shiftError } = await supabase
                    .from('shifts')
                    .select('*')
                    .eq(workerIdField, workerIdValue)
                    .eq('has_left', false)
                    .maybeSingle();

                if (shiftError) {
                    console.error('Error checking for existing shifts:', shiftError);
                    throw shiftError;
                }
                if (existingShift) {
                    const shiftDate = toSingaporeDateStr(existingShift.work_date);
                    
                    if (shiftDate === today) {
                        toast.error("You already have an active shift for today");
                        showScanFailure({
                            title: 'Already clocked in',
                            subtitle: 'You already have an active shift for today.',
                        });
                    } else {
                        toast.error(`You have an active shift from ${shiftDate}. Please complete it before starting a new shift.`);
                        showScanFailure({
                            title: 'Active shift open',
                            subtitle: `Finish your shift from ${shiftDate} before starting a new one.`,
                        });
                    }
                    setIsScanProcessing(false);
                    isScanProcessingRef.current = false;
                    setActiveScan(null);
                    return;
                }

                // Create new shift record with approximated entry time
                const shiftData = {
                    [workerIdField]: workerIdValue,
                    site_id: site.id,
                    work_date: today,
                    entry_time: nowISO, // Use approximated time
                    has_left: false,
                    // Removed worker_type as it's not in the schema
                    created_at: nowISO
                };
                
                const { data, error } = await supabase
                    .from('shifts')
                    .insert([shiftData])
                    .select()
                    .single();

                if (error) {
                    console.error('Error creating shift:', error);
                    if (error.code === '23505') { // Unique violation
                        throw new Error('You already have an active shift');
                    } else if (error.code === '23503') { // Foreign key violation
                        throw new Error('Invalid site or worker information');
                    } else {
                        throw new Error(error.message || 'Failed to record shift');
                    }
                }

                // Fetch the created shift with site details
                const { data: shiftWithSite } = await supabase
                    .from('shifts')
                    .select('*, sites(*)')
                    .eq('id', data.id)
                    .single();

                showScanCelebration({
                    title: 'Entry recorded',
                    subtitle: site.site_name ? `At ${site.site_name}` : undefined,
                });
                if (shiftWithSite) {
                    setCurrentShift(shiftWithSite);
                }
                await refetchShift();

            } else if (scanAction === 'breaks') {
                if (!shift || !shift.entry_time) {
                    toast.error("Must clock in first");
                    showScanFailure({
                        title: 'Scan unsuccessful',
                        subtitle: 'Clock in at a site before using break.',
                    });
                    setIsScanProcessing(false);
                    isScanProcessingRef.current = false;
                    return;
                }
                
                // Verify the worker is at the same site as their current shift
                if (shift.site_id !== site.id) {
                    toast.error("Must be at the same site as your current shift");
                    showScanFailure({
                        title: 'Wrong site',
                        subtitle: 'Scan the QR at the site where your shift is active.',
                    });
                    setIsScanProcessing(false);
                    isScanProcessingRef.current = false;
                    return;
                }

                // Check if there's an ongoing break (break_start without break_end)
                const { data: ongoingBreak, error: breakCheckError } = await supabase
                    .from('breaks')
                    .select('*')
                    .eq('shift_id', shift.id)
                    .is('break_end', null)
                    .maybeSingle();

                if (breakCheckError) {
                    throw breakCheckError;
                }

                if (ongoingBreak) {
                    // End the ongoing break with approximated time
                    const { error } = await supabase
                        .from('breaks')
                        .update({ break_end: nowISO }) // Use approximated time
                        .eq('id', ongoingBreak.id);

                    if (error) throw error;

                    showScanCelebration({
                        title: 'Break ended',
                        subtitle: site.site_name ? site.site_name : undefined,
                    });
                } else {
                    // Start a new break with approximated time
                    const { error } = await supabase
                        .from('breaks')
                        .insert([{
                            shift_id: shift.id,
                            break_start: nowISO // Use approximated time
                        }]);

                    if (error) throw error;

                    showScanCelebration({
                        title: 'Break started',
                        subtitle: site.site_name ? site.site_name : undefined,
                    });
                }

                await refetchShift();

            } else if (scanAction === 'leave') {
                if (!shift || !shift.entry_time) {
                    toast.error("Must clock in first");
                    showScanFailure({
                        title: 'Scan unsuccessful',
                        subtitle: 'Clock in before clocking out.',
                    });
                    setIsScanProcessing(false);
                    isScanProcessingRef.current = false;
                    return;
                }
                
                // Verify the worker is at the same site as their current shift
                if (shift.site_id !== site.id) {
                    toast.error("Must be at the same site as your current shift");
                    showScanFailure({
                        title: 'Wrong site',
                        subtitle: 'Scan the QR at the site where your shift is active.',
                    });
                    setIsScanProcessing(false);
                    isScanProcessingRef.current = false;
                    return;
                }

                // Fetch all breaks for this shift
                const { data: shiftBreaks, error: breaksError } = await supabase
                    .from('breaks')
                    .select('*')
                    .eq('shift_id', shift.id)
                    .order('break_start', { ascending: true });

                if (breaksError) {
                    console.error('Error fetching breaks:', breaksError);
                    throw breaksError;
                }

                // ATT-01: close an open break at clock-out so lunch is not paid as work
                const openBreaks = (shiftBreaks || []).filter((b) => b.break_start && !b.break_end);
                for (const openBreak of openBreaks) {
                    const { error: closeBreakError } = await supabase
                        .from('breaks')
                        .update({ break_end: nowISO })
                        .eq('id', openBreak.id);
                    if (closeBreakError) {
                        console.error('Error closing open break on clock-out:', closeBreakError);
                        throw closeBreakError;
                    }
                }
                const closedShiftBreaks = (shiftBreaks || []).map((b) =>
                    b.break_start && !b.break_end ? { ...b, break_end: nowISO } : b
                );

                // Auto-create remaining mandatory break time (duration, not scan count — ATT-02)
                const autoBreaksToCreate = getAutoBreaksToCreate(
                    shift.entry_time,
                    approximatedNow,
                    closedShiftBreaks
                );

                if (autoBreaksToCreate.length > 0) {
                    for (const breakData of autoBreaksToCreate) {
                        const { error: insertError } = await supabase
                            .from('breaks')
                            .insert([{
                                shift_id: shift.id,
                                break_start: breakData.break_start,
                                break_end: breakData.break_end
                            }]);
                        if (insertError) {
                            console.error('Error auto-creating break:', insertError);
                            throw insertError;
                        }
                    }
                }

                // Combine closed existing + auto-created breaks for hour calculation
                const allBreaks = [
                    ...closedShiftBreaks,
                    ...autoBreaksToCreate.map((b) => ({ break_start: b.break_start, break_end: b.break_end }))
                ].sort((a, b) => new Date(a.break_start) - new Date(b.break_start));

                // Calculate final hours with breaks (use approximated times to match Time Details display)
                // Use work_date (shift start date), not today (clock-out date), so overnight PH shifts
                // are correctly treated as PH (e.g. 18 Feb PH shift ending 19 Feb 01:30)
                const calculations = calculateShiftHours(
                    shift.entry_time,
                    approximatedNow,
                    allBreaks,
                    shift.work_date || today
                );

                // Update shift with leave time and calculated hours
                const { data: updateData, error } = await supabase
                    .from('shifts')
                    .update({
                        leave_time: nowISO, // Use approximated time
                        has_left: true,
                        worked_hours: calculations.basicHours,
                        sunday_hours: calculations.sundayHours,
                        ot_hours: calculations.otHours,
                        ...pendingOnCompleteFields(),
                    })
                    .eq('id', shift.id)
                    .select();

                if (error) {
                    console.error('Database update error:', error);
                    throw error;
                }

                // Update local state immediately for better UX
                setCurrentShift({
                    ...shift,
                    leave_time: nowISO,
                    has_left: true,
                    worked_hours: calculations.basicHours,
                    sunday_hours: calculations.sundayHours,
                    ot_hours: calculations.otHours,
                    ...pendingOnCompleteFields(),
                });

                showScanCelebration({
                    title: 'Clocked out',
                    subtitle: 'Shift sent for manager approval — view it in Shift history',
                });
                queryClient.invalidateQueries({ queryKey: ['shiftHistory', workerId] });
                await refetchShift();
            }

            setActiveScan(null);

        } catch (error) {
            console.error('Scan processing error:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint
            });
            const msg = error.message || 'Unknown error';
            toast.error(`Failed to process scan: ${msg}`);
            showScanFailure({
                title: 'Scan unsuccessful',
                subtitle: msg,
            });
        } finally {
            isScanProcessingRef.current = false;
            setIsScanProcessing(false);
        }
    };

    const handleDriverScanSuccess = async (vehicle, qrToken, coords) => {
        if (isScanProcessingRef.current) return;
        isScanProcessingRef.current = true;
        setIsScanProcessing(true);

        try {
            let lat = coords?.latitude;
            let lng = coords?.longitude;
            // Prefer ref so a stale React Query snapshot cannot start a second journey.
            const currentJourney = activeVehicleJourneyRef.current;

            if (!currentJourney) {
                if (isNativeAppVehicleTrackingDisabled()) {
                    showScanFailure({
                        title: 'Use the website for driving',
                        subtitle: getUseWebsiteForDrivingMessage(),
                    });
                    return;
                }
                if (lat == null || lng == null) {
                    const permOk = await requestVehicleTrackingPermissions();
                    if (!permOk) {
                        showScanFailure({
                            title: 'Location permission required',
                            subtitle: getGpsErrorMessage({ code: 1 }),
                        });
                        return;
                    }
                    try {
                        const pos = await captureCurrentPosition();
                        lat = pos.latitude;
                        lng = pos.longitude;
                    } catch (err) {
                        showScanFailure({
                            title: 'Location unavailable',
                            subtitle: getGpsErrorMessage(err),
                        });
                        return;
                    }
                }

                const journey = await startJourney({
                    vehicleId: vehicle.id,
                    workerId,
                    workerType,
                    workerName: workerName || workerId,
                    lat,
                    lng,
                });

                await startVehicleTracking({
                    journeyId: journey.id,
                    vehicleLabel: vehicle.vehicle_number,
                });

                showScanCelebration({
                    title: 'Journey started',
                    subtitle: `${vehicle.vehicle_number} · location tracking active`,
                });
                await refetchVehicleJourney();
                setActiveScan(null);
                return;
            }

            if (currentJourney.vehicle_id !== vehicle.id) {
                showScanFailure({
                    title: 'Different vehicle',
                    subtitle: 'Finish your current journey before scanning another vehicle.',
                });
                return;
            }

            if (currentJourney.status === 'on_break') {
                if (isNativeAppVehicleTrackingDisabled()) {
                    showScanFailure({
                        title: 'Use the website for driving',
                        subtitle: getUseWebsiteForDrivingMessage(),
                    });
                    return;
                }
                await endBreak(currentJourney.id);
                await resumeVehicleTrackingUploads(
                    currentJourney.id,
                    vehicle.vehicle_number
                );
                showScanCelebration({ title: 'Break ended', subtitle: 'Tracking resumed' });
                await refetchVehicleJourney();
                setActiveScan(null);
                return;
            }

            setPendingDriverScan({ vehicle, coords });
            setShowDriverActionDialog(true);
            setActiveScan(null);
        } catch (error) {
            showScanFailure({
                title: 'Driver scan failed',
                subtitle: error.message || 'Could not process vehicle scan.',
            });
            // The journey row may already exist (e.g. GPS failed to start right after it was
            // created) — refresh so the driver card shows and Finish ride stays available.
            void refetchVehicleJourney();
        } finally {
            isScanProcessingRef.current = false;
            setIsScanProcessing(false);
        }
    };

    const handleDriverActionChoice = async (action) => {
        const coords = pendingDriverScan?.coords;
        await runDriverJourneyAction(action, coords);
    };

    const runDriverJourneyAction = async (action, coordsFromScan) => {
        const journey = activeVehicleJourneyRef.current;
        if (!journey) {
            toast.error('No active vehicle journey.');
            return;
        }
        if (isScanProcessingRef.current) return;

        setShowDriverActionDialog(false);
        isScanProcessingRef.current = true;
        setIsScanProcessing(true);

        let lat = coordsFromScan?.latitude;
        let lng = coordsFromScan?.longitude;
        if (lat == null || lng == null) {
            const last = getLastKnownCoords();
            lat = last?.latitude;
            lng = last?.longitude;
        }
        if (lat == null || lng == null) {
            try {
                const pos = await captureCurrentPosition();
                lat = pos.latitude;
                lng = pos.longitude;
            } catch {
                // Finish / break still allowed without a GPS fix (e.g. indoors).
            }
        }

        const vehicleLabel = journey.vehicles?.vehicle_number
            || pendingDriverScan?.vehicle?.vehicle_number
            || '';

        try {
            if (action === 'finish') {
                // Pause uploads first; only clear tracking after a successful complete so a
                // failed endJourney does not leave the driver without GPS mid-ride.
                await pauseVehicleTrackingUploads();
                try {
                    const completed = await endJourney(journey.id, { lat, lng });
                    try {
                        await stopVehicleTracking();
                    } catch (e) {
                        console.warn('stopVehicleTracking failed', e);
                    }
                    showScanCelebration({
                        title: 'Journey completed',
                        subtitle: `${Number(completed.total_distance_km || 0).toFixed(1)} km · ${formatDuration(completed.duration_seconds)}`,
                    });
                } catch (finishErr) {
                    // Only restart GPS if the ride is still open and not on break.
                    if (!isNativeAppVehicleTrackingDisabled() && journey.status !== 'on_break') {
                        try {
                            const stillOpen = await getActiveJourneyForWorker(workerId, workerType);
                            if (stillOpen?.id === journey.id && stillOpen.status === 'active') {
                                await resumeVehicleTrackingUploads(journey.id, vehicleLabel);
                            }
                        } catch (resumeErr) {
                            console.warn('Could not resume tracking after failed finish', resumeErr);
                        }
                    }
                    throw finishErr;
                }
            } else if (action === 'break') {
                await pauseVehicleTrackingUploads();
                try {
                    await startBreak(journey.id, { lat, lng });
                } catch (breakErr) {
                    if (!isNativeAppVehicleTrackingDisabled()) {
                        try {
                            await resumeVehicleTrackingUploads(journey.id, vehicleLabel);
                        } catch (resumeErr) {
                            console.warn('Could not resume tracking after failed break', resumeErr);
                        }
                    }
                    throw breakErr;
                }
                showScanCelebration({ title: 'Short break', subtitle: 'Tap Resume or scan the vehicle QR when ready' });
            } else if (action === 'resume') {
                if (isNativeAppVehicleTrackingDisabled()) {
                    showScanFailure({
                        title: 'Use the website for driving',
                        subtitle: getUseWebsiteForDrivingMessage(),
                    });
                    return;
                }
                await endBreak(journey.id);
                await resumeVehicleTrackingUploads(journey.id, vehicleLabel);
                showScanCelebration({ title: 'Break ended', subtitle: 'Tracking resumed' });
            }
            setPendingDriverScan(null);
            await refetchVehicleJourney();
            queryClient.invalidateQueries({ queryKey: ['vehicleJourneys'] });
        } catch (error) {
            toast.error(error.message || 'Action failed');
            showScanFailure({ title: 'Action failed', subtitle: error.message });
        } finally {
            isScanProcessingRef.current = false;
            setIsScanProcessing(false);
        }
    };

    const getShiftStatus = () => {
        // Removed excessive logging to prevent console spam
        if (!currentShift) return { status: 'not_started', text: 'Not clocked in' };

        if (!currentShift.has_left) {
            const hasOngoingBreak = (shiftBreaks || []).some(b => b.break_start && !b.break_end);
            if (hasOngoingBreak) return { status: 'on_lunch', text: 'On break' };
            return { status: 'working', text: 'Working' };
        }

        return { status: 'completed', text: 'Shift completed' };
    };

    const [shiftBreaks, setShiftBreaks] = useState([]);
    const [totalBreakTime, setTotalBreakTime] = useState(0);

    // Fetch breaks for the current shift
    useEffect(() => {
        const fetchBreaks = async () => {
            if (currentShift?.id) {
                const { data: breaks, error } = await supabase
                    .from('breaks')
                    .select('*')
                    .eq('shift_id', currentShift.id)
                    .order('break_start', { ascending: true });

                if (error) {
                    console.error('Error fetching breaks:', error);
                    toast.error('Failed to load break records');
                    return;
                }
                if (breaks) {
                    setShiftBreaks(breaks);
                    // Calculate total break time in minutes
                    const totalMinutes = breaks.reduce((total, breakItem) => {
                        if (breakItem.break_start && breakItem.break_end) {
                            const start = new Date(breakItem.break_start);
                            const end = new Date(breakItem.break_end);
                            return total + (end - start) / (1000 * 60); // Convert to minutes
                        }
                        return total;
                    }, 0);
                    setTotalBreakTime(totalMinutes);
                }
            }
        };

        fetchBreaks();
    }, [currentShift?.id]);

    const shiftStatus = getShiftStatus();
    const canClockOut = currentShift && currentShift.entry_time && !currentShift.has_left;
    const hasActiveShift = Boolean(canClockOut);
    const onBreak = shiftStatus.status === 'on_lunch';
    const canClockIn = !hasActiveShift;
    const incompleteForms = feedbackFormsQuery.data?.incomplete || [];

    const startClockInScan = () => {
        if (hasActiveShift) {
            toast.error("You already have an active shift. Please clock out first.");
            return;
        }
        setActiveScan('entry');
    };
    const startBreakScan = () => {
        if (!hasActiveShift) return;
        setActiveScan('breaks');
    };
    const startClockOutScan = () => {
        if (!canClockOut) return;
        setActiveScan('leave');
    };

    const startDockBreak = () => {
        if (hasActiveShift) {
            startBreakScan();
            return;
        }
        if (activeVehicleJourney?.status === 'on_break') {
            void runDriverJourneyAction('resume');
            return;
        }
        if (activeVehicleJourney) {
            void runDriverJourneyAction('break');
        }
    };

    const startDockClockOut = () => {
        if (hasActiveShift) {
            startClockOutScan();
            return;
        }
        if (activeVehicleJourney) {
            void runDriverJourneyAction('finish');
        }
    };

    /** t() with an English fallback for strings that don't have a translation key yet. */
    const tt = (key, fallback, vars) => {
        const value = t(key, vars);
        return value === key ? fallback : value;
    };

    // Announcements count toward the bell until the worker opens the notifications sheet.
    const [seenAnnouncementIds, setSeenAnnouncementIds] = useState(
        () => readSeenRecord('announcements', workerId)?.ids || [],
    );
    const announcements = announcementsQuery.data || [];
    const unseenAnnouncements = announcements.filter((a) => !seenAnnouncementIds.includes(a.id)).length;
    const bellCount = unreadPayslipCount + unreadLeaveCount + timesheetActionCount + unseenAnnouncements;
    const openNotifications = () => {
        const ids = announcements.map((a) => a.id);
        writeSeenRecord('announcements', workerId, { ids });
        setSeenAnnouncementIds(ids);
        setShowNotifications(true);
    };

    useEffect(() => {
        const el = topSentinelRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver(([entry]) => setHeaderCompact(!entry.isIntersecting), { threshold: 0 });
        io.observe(el);
        return () => io.disconnect();
    }, [activeScan]);

    const dockCanClockOut = Boolean(canClockOut || (activeVehicleJourney && !hasActiveShift));
    const dockHasBreakTarget = Boolean(hasActiveShift || activeVehicleJourney);
    const dockOnBreak = hasActiveShift ? onBreak : activeVehicleJourney?.status === 'on_break';
    /** Native: until today's shift has loaded once, show placeholders and hold the dock actions. */
    const nativeShiftLoading = NATIVE_APP && isLoadingShift && !todaysShifts;

    // Arriving from login: lower the login curtain once today's shift has loaded (so the home
    // screen appears complete, not as skeletons), or after 1.5 s at most.
    useEffect(() => {
        if (!isLoginCurtainOpen()) return undefined;
        if (!isLoadingShift) {
            const raf = window.requestAnimationFrame(() => endLoginCurtain());
            return () => window.cancelAnimationFrame(raf);
        }
        const t = window.setTimeout(endLoginCurtain, 1500);
        return () => window.clearTimeout(t);
    }, [isLoadingShift]);

    // Passed-out payslip/timesheet: PDF via html2pdf blob → browser download or native Share sheet
    const handleDownloadPassedOutPayslip = async (payslip, type = 'payslip') => {
        try {
            if (type === 'timesheet' && payslip?.timesheet_locked === true) {
                toast.error('Timesheet is currently unavailable please contact your manager');
                return;
            }

            const html = type === 'payslip' ? payslip.payslip_html : payslip.timesheet_html;
            if (!html) {
                toast.error(`${type === 'payslip' ? 'Payslip' : 'Timesheet'} not available`);
                return;
            }

            const loadingToast = toast.loading(`Generating PDF for ${type === 'payslip' ? 'payslip' : 'timesheet'}...`);
            const startDate = new Date(payslip.start_date).toLocaleDateString('en-CA').replace(/\//g, '-');
            const endDate = new Date(payslip.end_date).toLocaleDateString('en-CA').replace(/\//g, '-');
            const fileName = `${type === 'payslip' ? 'Payslip' : 'Timesheet'}_${workerId}_${startDate}_to_${endDate}.pdf`;

            const { shareHtmlAsPdf } = await import('@/modules/timesheet/lib/pdfDownload');
            await shareHtmlAsPdf(html, fileName);

            toast.dismiss(loadingToast);
            toast.success(
                Capacitor.isNativePlatform()
                    ? `${type === 'payslip' ? 'Payslip' : 'Timesheet'} ready — choose an app to save or share`
                    : `${type === 'payslip' ? 'Payslip' : 'Timesheet'} downloaded successfully`
            );
        } catch (error) {
            console.error('Error downloading payslip as PDF:', error);
            toast.dismiss();
            toast.error('Failed to download ' + (type === 'payslip' ? 'payslip' : 'timesheet'));
        }
    };

    // Open payslip/timesheet in-app full-screen (avoids mobile WebView losing navigation)
    const handleViewPassedOutPayslip = (payslip, type = 'payslip') => {
        try {
            if (type === 'timesheet' && payslip?.timesheet_locked === true) {
                toast.error('Timesheet is currently unavailable please contact your manager');
                return;
            }

            const html = type === 'payslip' ? payslip.payslip_html : payslip.timesheet_html;
            if (!html) {
                toast.error(`${type === 'payslip' ? 'Payslip' : 'Timesheet'} not available`);
                return;
            }

            setDocumentPreview({
                html,
                title: type === 'payslip' ? 'Payslip' : 'Timesheet',
            });
        } catch (error) {
            console.error('Error viewing payslip:', error);
            toast.error('Failed to open ' + (type === 'payslip' ? 'payslip' : 'timesheet'));
        }
    };

    /** Web: print dialog. Native APK/WebView: window.open often jumps to Chrome and print() does nothing — use PDF + Share instead. */
    const handlePrintDocumentPreview = async () => {
        const html = documentPreview?.html || '';
        if (!html.trim()) {
            toast.error('Document preview not available');
            return;
        }

        if (isNativeApp) {
            setIsPreviewPdfExporting(true);
            const safeTitle = (documentPreview?.title || 'Document')
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '_')
                .slice(0, 48);
            const fileName = `${safeTitle || 'Document'}_${workerId}_${Date.now()}.pdf`;
            const loadingToast = toast.loading('Creating PDF…');
            try {
                const { shareHtmlAsPdf } = await import('@/modules/timesheet/lib/pdfDownload');
                await shareHtmlAsPdf(html, fileName);
                toast.dismiss(loadingToast);
                toast.success('Choose an app to save, print, or share the PDF');
            } catch (e) {
                toast.dismiss(loadingToast);
                console.error(e);
                toast.error('Could not create PDF');
            } finally {
                setIsPreviewPdfExporting(false);
            }
            return;
        }

        try {
            const win = window.open('', '', 'height=800,width=1000');
            if (!win) {
                toast.error('Popup blocked — allow popups to print');
                return;
            }
            win.document.write(html);
            win.document.close();
            setTimeout(() => win.print(), 500);
            toast.success('Print dialog opened — use "Save as PDF" to download');
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    const handleLeaveDurationChange = (value) => {
        setLeaveRequestData((prev) => {
            const next = { ...prev, leave_duration: value };
            if (value?.includes('half_day') && prev.from_date) {
                next.to_date = prev.from_date;
            }
            return next;
        });
    };

    const handleLeaveFromDateChange = (value) => {
        setLeaveRequestData((prev) => {
            const next = { ...prev, from_date: value };
            if (prev.leave_duration?.includes('half_day')) {
                next.to_date = value;
            }
            return next;
        });
    };

    const handleSubmitLeaveRequest = () => {
        // Hard guard against double-tap: never start a second submit while one is in flight.
        if (submitLeaveRequestMutation.isPending) return;

        if (!leaveRequestData.leave_type || !leaveRequestData.from_date || !leaveRequestData.to_date) {
            toast.error('Please fill in all required fields');
            return;
        }

        const isHalfDay = leaveRequestData.leave_duration?.includes('half_day');
        const fromDateStr = leaveRequestData.from_date;
        const toDateStr = isHalfDay ? leaveRequestData.from_date : leaveRequestData.to_date;

        const fromDate = parseDateOnly(fromDateStr);
        const toDate = parseDateOnly(toDateStr);

        if (!fromDate || !toDate) {
            toast.error('Please enter valid from and to dates');
            return;
        }
        if (toDate < fromDate) {
            toast.error('To date cannot be before from date');
            return;
        }

        const normalizedType = normalizeLeaveType(leaveRequestData.leave_type);
        const payload = {
            ...leaveRequestData,
            leave_type: normalizedType,
            from_date: fromDateStr,
            to_date: toDateStr,
        };
        const daysRequested = countRequestedLeaveDays(payload);

        if (
            requiresMedicalAttachment({
                leaveType: normalizedType,
                requestedDays: daysRequested,
                policy: leavePolicy,
            }) &&
            !leaveAttachmentFile
        ) {
            toast.error(
                `Medical/Hospitalization leave of ${leavePolicy?.mc_attachment_min_days ?? 1}+ day(s) requires an MC/doctor attachment.`
            );
            return;
        }

        if (leaveConflictHard.length) {
            toast.error(leaveConflictHard[0]);
            return;
        }

        // Overlap + balance validation happens inside the mutation so the submit
        // button stays disabled (isPending) for the entire check-then-insert window.
        submitLeaveRequestMutation.mutate({
            ...payload,
            days_requested: daysRequested,
            attachmentFile: leaveAttachmentFile,
        });
    };

    const leaveBalancePreview =
        leaveRequestData.leave_type && leaveRequestData.from_date && leaveRequestData.to_date
            ? (() => {
                  const balanceField = getBalanceFieldForLeaveType(leaveRequestData.leave_type);
                  const currentBalance = balanceField
                      ? Number(workerBalance?.[balanceField] || 0)
                      : 0;
                  const preview = buildLeaveBalancePreview({
                      leaveType: leaveRequestData.leave_type,
                      fromDate: leaveRequestData.from_date,
                      toDate: leaveRequestData.leave_duration?.includes('half_day')
                          ? leaveRequestData.from_date
                          : leaveRequestData.to_date,
                      leaveDuration: leaveRequestData.leave_duration,
                      currentBalance,
                      pendingReservedDays,
                      ph_leave_rule: leavePolicy?.ph_leave_rule,
                  });
                  // Don't show a misleading "all unpaid" preview when the balance couldn't be loaded.
                  return balanceField && (!workerBalance || isPlaceholderBalance)
                      ? { ...preview, tracksBalance: false }
                      : preview;
              })()
            : null;

    const attachmentRequired = leaveBalancePreview
        ? requiresMedicalAttachment({
              leaveType: leaveRequestData.leave_type,
              requestedDays: leaveBalancePreview.requestedDays,
              policy: leavePolicy,
          })
        : false;

    // Handle password change
    const handlePasswordChange = async () => {
        if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
            toast.error('Please fill in all password fields');
            return;
        }

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast.error('New passwords do not match');
            return;
        }

        if (passwordData.newPassword.length < 4) {
            toast.error('New password must be at least 4 characters long');
            return;
        }

        setIsPasswordProcessing(true);

        try {
            const changed = await changeWorkerPassword({
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword,
            });

            if (!changed) {
                toast.error('Current password is incorrect');
                return;
            }

            toast.success('Password updated successfully!');
            // The biometric credential still holds the old password — remove it.
            const bioPrefs = getBiometricPrefs();
            if (bioPrefs.enabled && bioPrefs.workerId === String(workerId)) {
                await disableBiometricLogin({ keepDeclined: true });
                toast.info('Biometric login was turned off. Turn it on again in Biometric login.');
            }
            setShowPasswordDialog(false);
            setPasswordData({
                currentPassword: '',
                newPassword: '',
                confirmPassword: '',
            });
        } catch (error) {
            console.error('Error updating password:', error);
            toast.error(error.message || 'Failed to update password');
        } finally {
            setIsPasswordProcessing(false);
        }
    };

    // Handle logout (client-side navigation — avoids full reload + native splash replay)
    const handleLogout = async () => {
        void unregisterPushDevice();
        await signOutEverywhere();
        navigate('/', { replace: true });
    };

    const attendanceDock = (
        <HomeDock
            loading={nativeShiftLoading}
            canClockIn={canClockIn}
            hasBreakTarget={dockHasBreakTarget}
            onBreak={dockOnBreak}
            canClockOut={dockCanClockOut}
            onClockIn={startClockInScan}
            onBreakScan={startDockBreak}
            onClockOut={startDockClockOut}
            copy={{
                attendance: t('worker.attendance'),
                scanToClockIn: tt('worker.scanToClockIn', 'Scan to clock in'),
                break: t('worker.break'),
                endBreak: t('worker.endBreak'),
                clockOut: t('worker.clockOut'),
            }}
        />
    );

    return (
        <div className={cn('wh-page relative min-h-dvh-safe', NATIVE_APP && 'akk-worker-portal akk-screen')}>
            <ScanSuccessOverlay
                open={!!scanCelebration}
                title={scanCelebration?.title ?? ''}
                subtitle={scanCelebration?.subtitle}
                onDismiss={dismissScanCelebration}
                durationMs={2200}
            />
            <ScanFailureOverlay
                open={!!scanFailure}
                title={scanFailure?.title ?? 'Scan unsuccessful'}
                subtitle={scanFailure?.subtitle}
                onDismiss={dismissScanFailure}
                durationMs={2400}
            />
            {isTutorialRunning ? (
                <Suspense fallback={null}>
                    <AppTour
                        run={isTutorialRunning}
                        steps={workerTutorialSteps}
                        onClose={() => setIsTutorialRunning(false)}
                    />
                </Suspense>
            ) : null}
            {isAppUI() ? (
                <HomeHeader
                    tour="worker-header"
                    logoSrc="/Akk-logo.jpg"
                    eyebrow={getSingaporeGreeting()}
                    name={workerName || 'Worker'}
                    employeeId={`${tt('worker.employeeId', 'Employee ID')} ${workerId || '—'}`}
                    bellCount={bellCount}
                    bellLabel={tt('worker.notifications', 'Notifications')}
                    onBell={openNotifications}
                    onAvatar={() => navigate(paths.account)}
                    compact={headerCompact && !activeScan}
                />
            ) : (
                <TopBar
                    eyebrow={getSingaporeGreeting()}
                    title={workerName || 'Worker'}
                    subtitle={`${tt('worker.employeeId', 'Employee ID')} ${workerId || '—'}`}
                    trailing={
                        <>
                            <button
                                type="button"
                                className="g-icon-btn"
                                onClick={openNotifications}
                                aria-label={
                                    bellCount > 0
                                        ? `${tt('worker.notifications', 'Notifications')}, ${bellCount} new`
                                        : tt('worker.notifications', 'Notifications')
                                }
                                data-tour="worker-header"
                            >
                                <Bell aria-hidden />
                                {bellCount > 0 ? (
                                    <span className="g-icon-btn__dot">{bellCount > 9 ? '9+' : bellCount}</span>
                                ) : null}
                            </button>
                            <Link to={paths.account} className="g-icon-btn g-icon-btn--plain" aria-label="Account">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--g-brand-soft)] text-xs font-bold text-[var(--g-brand-text)]">
                                    {(workerName || 'W').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                                </span>
                            </Link>
                        </>
                    }
                />
            )}

            <main className={cn('wh-content app-page-content', activeScan && 'wh-content--scan')}>
                <AnimatePresence mode={mobileTouch ? 'sync' : 'wait'}>
                    {!activeScan ? (
                        <motion.div
                            key="dashboard"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="wh-stack"
                        >
                            <div ref={topSentinelRef} className="wh-sentinel" aria-hidden="true" />

                            <FormsBanner
                                forms={incompleteForms}
                                to={createPageUrl(`WorkerFormFill?id=${incompleteForms[0]?.id ?? ''}`)}
                                title={
                                    incompleteForms.length === 1
                                        ? tt('worker.formToComplete', '1 form to complete')
                                        : tt('worker.formsToComplete', `${incompleteForms.length} forms to complete`, { n: incompleteForms.length })
                                }
                            />

                            <div className="wh-home-grid">
                            <div className="wh-home-main">
                            <ShiftCard
                                tour="worker-status"
                                state={nativeShiftLoading ? 'loading' : shiftStatus.status}
                                shift={currentShift}
                                breaks={shiftBreaks}
                                totalBreakMinutes={totalBreakTime}
                                siteName={
                                    currentShift?.sites?.site_name ||
                                    (hasActiveShift ? tt('worker.onSite', 'On site') : tt('worker.noSiteYet', 'No site yet'))
                                }
                                extra={currentShift?.has_left ? <ShiftApprovalStatusBadge shift={currentShift} /> : null}
                                copy={{
                                    notClockedIn: tt('worker.notClockedIn', 'Not clocked in'),
                                    onShift: tt('worker.onShift', 'On shift'),
                                    onBreak: tt('worker.onBreak', 'On break'),
                                    shiftDone: tt('worker.shiftDone', 'Shift done'),
                                    workedToday: tt('worker.workedToday', 'Worked today'),
                                    scanHint: tt('worker.scanToStart', 'Scan the QR code at your site to start your shift.'),
                                    clockedIn: tt('worker.clockedIn', 'Clocked in'),
                                    clockedOut: tt('worker.clockedOut', 'Clocked out'),
                                    break: t('worker.break'),
                                    notTakenYet: tt('worker.notTakenYet', 'Not taken yet'),
                                    since: tt('worker.since', 'Since'),
                                }}
                            />

                            {activeVehicleJourney && (
                                <DriverStatusCard
                                    journey={activeVehicleJourney}
                                    expanded={driverStatusExpanded}
                                    onExpand={() => setDriverStatusExpanded((v) => !v)}
                                    actionBusy={isScanProcessing}
                                    onFinish={() => void runDriverJourneyAction('finish')}
                                    onBreak={() => void runDriverJourneyAction('break')}
                                    onResume={() => void runDriverJourneyAction('resume')}
                                />
                            )}
                            {wide ? attendanceDock : null}
                            </div>

                            <div className="wh-home-side">
                            <ActionTiles
                                tour="worker-shortcuts"
                                label={t('worker.moreActions')}
                                tiles={[
                                    {
                                        key: 'site-photos',
                                        icon: Camera,
                                        tone: 'teal',
                                        title: 'Site photos',
                                        hint:
                                            progressSummary.data?.declined > 0
                                                ? `${progressSummary.data.declined} declined — fix & resend`
                                                : 'Before · during · after',
                                        to: paths.progress.submit,
                                        badge: progressSummary.data?.declined || 0,
                                    },
                                    {
                                        key: 'materials',
                                        icon: PackagePlus,
                                        tone: 'sky',
                                        title: 'Materials',
                                        hint:
                                            materialsSummary.data?.itemsOut > 0
                                                ? `${materialsSummary.data.itemsOut} item${materialsSummary.data.itemsOut === 1 ? '' : 's'} to return`
                                                : 'Take or return',
                                        to: paths.materials.request,
                                        badge: materialsSummary.data?.pending || 0,
                                    },
                                    workerInCompany && {
                                        key: 'timesheets',
                                        icon: Clock,
                                        tone: 'teal',
                                        title: t('worker.timesheets'),
                                        hint: t('worker.timesheetsHint'),
                                        to: "/timesheet/timesheets",
                                        badge: timesheetActionCount,
                                        tour: 'worker-timesheets',
                                    },
                                    {
                                        key: 'leave',
                                        icon: FileText,
                                        tone: 'sky',
                                        title: t('worker.leaveRequest'),
                                        hint: t('worker.leaveRequestHint'),
                                        onClick: () => setShowLeaveRequestDialog(true),
                                        tour: 'worker-leave',
                                    },
                                    workerInCompany && {
                                        key: 'payslips',
                                        icon: Download,
                                        tone: 'violet',
                                        title: t('worker.payslips'),
                                        hint: t('worker.payslipsHint'),
                                        badge: unreadPayslipCount,
                                        onClick: () => {
                                            markPayslipsSeen();
                                            setShowPayslipDownloadDialog(true);
                                            refetchPayslips();
                                        },
                                        tour: 'worker-payslip',
                                    },
                                    {
                                        key: 'forms',
                                        icon: ClipboardList,
                                        tone: 'brand',
                                        title: t('worker.companyForms'),
                                        hint: t('worker.companyFormsHint'),
                                        to: "/timesheet/company-forms",
                                        tour: 'worker-company-forms',
                                    },
                                ].filter(Boolean)}
                            />
                            </div>
                            </div>

                            {/* On desktop the sidebar already lists these screens. */}
                            {wide ? null : (
                            <>
                            <ListGroup
                                label={tt('worker.timeAndLeave', 'Time & leave')}
                                rows={[
                                    {
                                        key: 'shift-history',
                                        icon: History,
                                        title: t('worker.shiftHistory'),
                                        to: "/timesheet/shifts",
                                        tour: 'worker-shift-history',
                                    },
                                    {
                                        key: 'leave-history',
                                        icon: Calendar,
                                        title: t('worker.leaveHistory'),
                                        to: "/timesheet/leave/history",
                                        badge: unreadLeaveCount,
                                        onClick: markLeavesSeen,
                                        tour: 'worker-leave-history',
                                    },
                                ]}
                            />

                            <ListGroup
                                label="Materials"
                                rows={[
                                    {
                                        key: 'materials-request',
                                        icon: PackagePlus,
                                        title: 'Take or return materials',
                                        to: paths.materials.request,
                                    },
                                    {
                                        key: 'materials-history',
                                        icon: Boxes,
                                        title: 'My material requests',
                                        to: paths.materials.history,
                                        pill:
                                            materialsSummary.data?.pending > 0
                                                ? `${materialsSummary.data.pending} pending`
                                                : materialsSummary.status === 'disconnected'
                                                  ? 'Link account'
                                                  : undefined,
                                    },
                                ]}
                            />

                            <ListGroup
                                label="Site progress"
                                rows={[
                                    {
                                        key: 'progress-submit',
                                        icon: Camera,
                                        title: 'Submit site photos',
                                        to: paths.progress.submit,
                                    },
                                    {
                                        key: 'progress-submissions',
                                        icon: ClipboardCheck,
                                        title: 'My submissions',
                                        to: paths.progress.submissions,
                                        pill:
                                            progressSummary.data?.declined > 0
                                                ? `${progressSummary.data.declined} declined`
                                                : progressSummary.data?.drafts > 0
                                                  ? `${progressSummary.data.drafts} not sent`
                                                  : progressSummary.status === 'disconnected'
                                                    ? 'Link account'
                                                    : undefined,
                                    },
                                    {
                                        key: 'verify',
                                        icon: ShieldCheck,
                                        title: 'Verify a photo',
                                        to: paths.verify,
                                    },
                                ]}
                            />
                            </>
                            )}

                            <div className="wh-home-more">
                            <ListGroup
                                label={tt('worker.work', 'Work')}
                                rows={[
                                    feedbackFormsQuery.data?.hasPublished && {
                                        key: 'submitted-forms',
                                        icon: ClipboardCheck,
                                        title: tt('worker.submittedForms', 'Submitted forms'),
                                        to: "/timesheet/forms",
                                    },
                                    {
                                        key: 'driver',
                                        icon: Car,
                                        title: t('worker.scanDriver'),
                                        pill: activeVehicleJourney
                                            ? tt('worker.journeyActive', 'Journey active')
                                            : tt('worker.driversOnly', 'Drivers only'),
                                        onClick: () => setActiveScan('driver'),
                                        tour: 'worker-scan-driver',
                                    },
                                ]}
                            />

                            <ListGroup
                                id="worker-account"
                                label={tt('worker.account', 'Account')}
                                rows={[
                                    {
                                        key: 'modules',
                                        icon: Link2,
                                        title: 'Hub account & linked modules',
                                        to: paths.account,
                                    },
                                    {
                                        key: 'password',
                                        icon: Key,
                                        title: tt('worker.changePassword', 'Change password'),
                                        onClick: () => setShowPasswordDialog(true),
                                    },
                                    Capacitor.isNativePlatform() && {
                                        key: 'biometric',
                                        icon: Fingerprint,
                                        title: tt('worker.biometricLogin', 'Biometric login'),
                                        onClick: () => setShowBiometricDialog(true),
                                    },
                                    {
                                        key: 'tutorial',
                                        icon: HelpCircle,
                                        title: tt('worker.tutorial', 'Tutorial'),
                                        onClick: () => setIsTutorialRunning(true),
                                    },
                                    // Language + sign-out live on hub /account (single chrome).
                                    NATIVE_APP && {
                                        key: 'language',
                                        icon: Languages,
                                        title: t('common.language'),
                                        trailing: <LanguageSwitcher className="wh-lang" />,
                                    },
                                    NATIVE_APP && {
                                        key: 'logout',
                                        icon: LogOut,
                                        title: t('common.logout'),
                                        onClick: handleLogout,
                                        danger: true,
                                    },
                                ]}
                            />
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="scanner"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="space-y-3"
                        >
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    onClick={() => setActiveScan(null)}
                                    variant="outline"
                                    disabled={isScanProcessing}
                                    className="h-10 shrink-0 rounded-xl border-slate-200/90 bg-white"
                                >
                                    Back
                                </Button>
                                <div className="min-w-0 flex-1">
                                    <h2 className="truncate text-base font-semibold tracking-tight text-slate-900">
                                        {activeScan === 'entry' && 'Clock in'}
                                        {activeScan === 'breaks' && (onBreak ? 'End break' : 'Start break')}
                                        {activeScan === 'leave' && 'Clock out'}
                                        {activeScan === 'driver' && 'Scan as driver'}
                                    </h2>
                                    <p className="truncate text-xs text-slate-500">
                                        {currentShift && (activeScan === 'leave' || activeScan === 'breaks')
                                            ? currentShift.sites?.site_name
                                            : activeScan === 'driver'
                                              ? 'Scan the vehicle QR'
                                              : 'Scan the site QR'}
                                    </p>
                                </div>
                            </div>

                            <Suspense fallback={<DeferredFeatureLoading label="Opening scanner…" />}>
                                {activeScan === 'driver' ? (
                                    <VehicleQRScanner
                                        onScanSuccess={handleDriverScanSuccess}
                                        onValidationFailure={handleQrValidationFailure}
                                        disabled={isScanProcessing}
                                        requireGps={!activeVehicleJourney}
                                    />
                                ) : (
                                    <QRScanner
                                        action={activeScan}
                                        onScanSuccess={handleScanSuccess}
                                        onValidationFailure={handleQrValidationFailure}
                                        requiredDistance={350}
                                        currentShiftSiteId={(activeScan === 'leave' || activeScan === 'breaks') ? currentShift?.site_id : null}
                                        disabled={isScanProcessing}
                                    />
                                )}
                            </Suspense>

                            <details className="group px-1 text-xs text-slate-500">
                                <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
                                    <AlertCircle className="h-3.5 w-3.5 text-[#dc6b2f]" />
                                    Scan tips
                                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                                </summary>
                                <ol className="mt-1.5 list-inside list-decimal space-y-1 leading-relaxed">
                                    {activeScan === 'driver' ? (
                                        <>
                                            <li>Scan the QR sticker inside the vehicle to start.</li>
                                            <li>When you arrive, tap <strong>Finish ride</strong> on the driver card — you do not need GPS to clock out.</li>
                                            <li>Allow location when starting so the map can track the trip.</li>
                                        </>
                                    ) : (
                                        <>
                                            <li>Stay within range of the site (location is checked).</li>
                                            <li>Allow camera and location when the browser asks.</li>
                                            <li>Point at the site QR, or use Scan photo from gallery.</li>
                                        </>
                                    )}
                                </ol>
                            </details>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Phones: floating above the tab bar. Desktop: inline under the shift card. */}
            {!activeScan && !wide ? attendanceDock : null}

            {/* Notifications (bell) */}
            <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
                <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl border-slate-200/80 bg-[#f4f6fa] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{tt('worker.notifications', 'Notifications')}</DialogTitle>
                        <DialogDescription>{tt('worker.notificationsHint', 'Updates and announcements for you')}</DialogDescription>
                    </DialogHeader>
                    <NotificationsList
                        emptyText={tt('worker.noNotifications', "You're all caught up.")}
                        announcementsLabel={t('worker.announcements')}
                        announcements={announcements}
                        updates={[
                            incompleteForms.length > 0 && {
                                key: 'forms',
                                icon: ClipboardList,
                                tone: 'amber',
                                title: tt('worker.formsToComplete', `${incompleteForms.length} forms to complete`, { n: incompleteForms.length }),
                                hint: incompleteForms.map((f) => f.title).join(', '),
                                onClick: () => {
                                    setShowNotifications(false);
                                    navigate(`/timesheet/forms/${incompleteForms[0].id}`);
                                },
                            },
                            unreadPayslipCount > 0 && {
                                key: 'payslips',
                                icon: Download,
                                tone: 'violet',
                                title: tt('worker.newPayslips', `${unreadPayslipCount} new payslip${unreadPayslipCount === 1 ? '' : 's'}`, { n: unreadPayslipCount }),
                                hint: t('worker.payslipsHint'),
                                onClick: () => {
                                    setShowNotifications(false);
                                    markPayslipsSeen();
                                    setShowPayslipDownloadDialog(true);
                                    refetchPayslips();
                                },
                            },
                            timesheetActionCount > 0 && {
                                key: 'timesheets',
                                icon: Clock,
                                tone: 'teal',
                                title: tt('worker.timesheetsToReview', `${timesheetActionCount} timesheet${timesheetActionCount === 1 ? '' : 's'} to review`, { n: timesheetActionCount }),
                                hint: t('worker.timesheetsHint'),
                                onClick: () => {
                                    setShowNotifications(false);
                                    navigate("/timesheet/timesheets");
                                },
                            },
                            unreadLeaveCount > 0 && {
                                key: 'leave',
                                icon: Calendar,
                                tone: 'sky',
                                title: tt('worker.leaveUpdates', 'Leave updates'),
                                hint: t('worker.leaveHistoryHint'),
                                onClick: () => {
                                    setShowNotifications(false);
                                    markLeavesSeen();
                                    navigate("/timesheet/leave/history");
                                },
                            },
                        ].filter(Boolean)}
                    />
                </DialogContent>
            </Dialog>

            {/* Driver action dialog */}
            <Dialog open={showDriverActionDialog} onOpenChange={setShowDriverActionDialog}>
                <DialogContent className="max-w-sm rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle>Journey in progress</DialogTitle>
                        <DialogDescription>
                            What would you like to do with {pendingDriverScan?.vehicle?.vehicle_number}?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Button
                            className="h-12 bg-[#dc6b2f] hover:bg-[#c45d28]"
                            onClick={() => handleDriverActionChoice('finish')}
                            disabled={isScanProcessing}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Finish ride
                        </Button>
                        <Button
                            variant="outline"
                            className="h-12"
                            onClick={() => handleDriverActionChoice('break')}
                            disabled={isScanProcessing}
                        >
                            <Coffee className="mr-2 h-4 w-4" />
                            Short break
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Leave Request Dialog */}
            <Dialog open={showLeaveRequestDialog} onOpenChange={setShowLeaveRequestDialog}>
                <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-slate-200/80 sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Submit Leave Request</DialogTitle>
                        <DialogDescription>
                            Request annual leave (AL) or medical leave (MC). Foreign workers: manager then admin approval. Local workers: admin approval.
                        </DialogDescription>
                        {workerBalance && !isLoadingBalance && (
                            <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50/80 p-3">
                                <h4 className="mb-2 text-sm font-medium text-slate-800">Your Current Leave Balance</h4>
                                <div className="flex flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:gap-4">
                                    <span className="text-slate-700">
                                        <strong>Annual:</strong> {workerBalance.annual_leave_balance || 0} of {workerBalance.annual_leave_limit || 10}
                                    </span>
                                    <span className="text-slate-700">
                                        <strong>Medical:</strong> {workerBalance.medical_leave_balance || 0} of {workerBalance.medical_leave_limit || 14}
                                    </span>
                                    <span className="text-slate-700">
                                        <strong>Hospitalization:</strong> {workerBalance.hospitalization_leave_balance || 0} of {workerBalance.hospitalization_leave_limit || 60}
                                    </span>
                                </div>
                            </div>
                        )}
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Type of Leave</label>
                            <Select
                                value={leaveRequestData.leave_type}
                                onValueChange={(value) => setLeaveRequestData({ ...leaveRequestData, leave_type: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select leave type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectLabel className="text-green-600 font-medium">Paid Leave Types</SelectLabel>
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
                                    </SelectGroup>
                                    <SelectGroup>
                                        <SelectLabel className="text-red-600 font-medium">Unpaid Leave Types</SelectLabel>
                                        <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                        <SelectItem value="Unpaid Infant Care Leave">Unpaid Infant Care Leave</SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Leave Duration</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { value: 'full_day', label: 'Full day' },
                                    { value: 'half_day_morning', label: 'Morning half-day' },
                                    { value: 'half_day_afternoon', label: 'Afternoon half-day' },
                                ].map((opt) => {
                                    const selected = leaveRequestData.leave_duration === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => handleLeaveDurationChange(opt.value)}
                                            className={`rounded-xl border px-2 py-3 text-center text-xs font-medium transition-colors sm:text-sm ${
                                                selected
                                                    ? 'border-[#dc6b2f] bg-orange-50 text-[#c45d28] shadow-sm'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <Select
                                value={leaveRequestData.leave_duration}
                                onValueChange={handleLeaveDurationChange}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select duration" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="full_day">Full Day</SelectItem>
                                    <SelectItem value="half_day_morning">Half Day - Morning</SelectItem>
                                    <SelectItem value="half_day_afternoon">Half Day - Afternoon</SelectItem>
                                </SelectContent>
                            </Select>
                            {leaveRequestData.leave_duration?.includes('half_day') && (
                                <p className="text-xs text-slate-600">
                                    {halfDayWorkPolicyLabel(leavePolicy?.half_day_keeps_work !== false)}
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">From Date</label>
                                <Input
                                    type="date"
                                    value={leaveRequestData.from_date}
                                    onChange={(e) => handleLeaveFromDateChange(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">To Date</label>
                                <Input
                                    type="date"
                                    value={
                                        leaveRequestData.leave_duration?.includes('half_day')
                                            ? leaveRequestData.from_date
                                            : leaveRequestData.to_date
                                    }
                                    onChange={(e) =>
                                        setLeaveRequestData({ ...leaveRequestData, to_date: e.target.value })
                                    }
                                    disabled={leaveRequestData.leave_duration?.includes('half_day')}
                                />
                                {leaveRequestData.leave_duration?.includes('half_day') && (
                                    <p className="text-xs text-slate-500">Half-day leave is a single calendar day.</p>
                                )}
                            </div>
                        </div>
                        {leaveBalancePreview?.tracksBalance && (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                <p>
                                    Requesting <strong>{leaveBalancePreview.requestedDays}</strong> day(s)
                                    {pendingReservedDays > 0
                                        ? ` (${pendingReservedDays} already reserved by pending requests)`
                                        : ''}
                                    . Remaining after this request:{' '}
                                    <strong>{leaveBalancePreview.remainingAfter}</strong>
                                    {leaveBalancePreview.unpaidDays > 0
                                        ? ` (${leaveBalancePreview.unpaidDays} unpaid if balance runs out)`
                                        : ''}
                                    .
                                </p>
                            </div>
                        )}
                        {leaveConflictHard.length > 0 && (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                {leaveConflictHard.map((msg) => (
                                    <p key={msg}>{msg}</p>
                                ))}
                            </div>
                        )}
                        {leaveConflictSoft.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                {leaveConflictSoft.map((msg) => (
                                    <p key={msg}>{msg}</p>
                                ))}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Reason (Optional)</label>
                            <Textarea
                                placeholder="Please provide a reason for your leave request..."
                                value={leaveRequestData.reason}
                                onChange={(e) => setLeaveRequestData({ ...leaveRequestData, reason: e.target.value })}
                                rows={3}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">
                                Attachment {attachmentRequired ? '(required)' : '(optional)'}
                            </label>
                            <Input
                                type="file"
                                accept=".pdf,image/*"
                                onChange={async (e) => {
                                    const input = e.target;
                                    const picked = input.files?.[0] || null;
                                    if (!picked) {
                                        setLeaveAttachmentFile(null);
                                        return;
                                    }
                                    try {
                                        setLeaveAttachmentFile(await prepareLeaveAttachment(picked));
                                    } catch (err) {
                                        toast.error(err.message || 'This file cannot be attached');
                                        input.value = '';
                                        setLeaveAttachmentFile(null);
                                    }
                                }}
                            />
                            <p className="text-xs text-slate-500">
                                {attachmentRequired
                                    ? `MC/doctor note required for Medical/Hospitalization leave of ${leavePolicy?.mc_attachment_min_days ?? 1}+ day(s).`
                                    : 'Upload MC/supporting documents (PDF or image).'}
                            </p>
                        </div>
                        {leavePolicy && (
                            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                                {phLeaveRuleLabel(leavePolicy.ph_leave_rule)}
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowLeaveRequestDialog(false);
                                setLeaveRequestData({
                                    leave_type: '',
                                    leave_duration: 'full_day',
                                    from_date: '',
                                    to_date: '',
                                    reason: ''
                                });
                                setLeaveAttachmentFile(null);
                                setLeaveConflictHard([]);
                                setLeaveConflictSoft([]);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmitLeaveRequest}
                            disabled={submitLeaveRequestMutation.isPending || leaveConflictHard.length > 0}
                            className="bg-[#dc6b2f] hover:bg-[#c45d28]"
                        >
                            {submitLeaveRequestMutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Submitting...
                                </>
                            ) : 'Submit Request'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {showBiometricDialog ? (
                <Suspense fallback={<DeferredFeatureLoading label="Opening biometric settings…" />}>
                    <BiometricLoginSettings
                        open={showBiometricDialog}
                        onOpenChange={setShowBiometricDialog}
                        workerId={workerId}
                        workerType={workerType}
                        workerName={workerName}
                    />
                </Suspense>
            ) : null}

            {/* Change Password Dialog */}
            <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
                <DialogContent className="rounded-2xl border-slate-200/80 sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Change Password</DialogTitle>
                        <DialogDescription>
                            Update your account password. Make sure to remember your new password.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Current Password</label>
                            <Input
                                type="password"
                                placeholder="Enter current password"
                                value={passwordData.currentPassword}
                                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">New Password</label>
                            <Input
                                type="password"
                                placeholder="Enter new password"
                                value={passwordData.newPassword}
                                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Confirm New Password</label>
                            <Input
                                type="password"
                                placeholder="Confirm new password"
                                value={passwordData.confirmPassword}
                                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowPasswordDialog(false);
                                setPasswordData({
                                    currentPassword: '',
                                    newPassword: '',
                                    confirmPassword: ''
                                });
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handlePasswordChange}
                            disabled={isPasswordProcessing}
                            className="bg-[#dc6b2f] hover:bg-[#c45d28]"
                        >
                            {isPasswordProcessing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </>
                            ) : 'Update Password'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Download Payslip Dialog */}
            <Dialog open={showPayslipDownloadDialog} onOpenChange={(open) => {
                setShowPayslipDownloadDialog(open);
                if (open) markPayslipsSeen();
            }}>
                <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle className="text-xl">Your payslips</DialogTitle>
                        <DialogDescription>
                            {isNativeApp
                                ? 'Open View to read on screen. In the app, tap Save PDF in the full-screen view to export and share a PDF.'
                                : 'View shows the payslip on screen. In the full-screen view, use Print and choose “Save as PDF” to download.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {isLoadingPayslips ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                            </div>
                        ) : passedOutPayslips.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-slate-500">
                                <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                                <p className="text-sm">No payslips have been passed out to you yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {passedOutPayslips.map((payslip) => {
                                    const startDate = new Date(payslip.start_date).toLocaleDateString();
                                    const endDate = new Date(payslip.end_date).toLocaleDateString();
                                    const createdDate = new Date(payslip.created_at).toLocaleDateString();

                                    return (
                                        <Card key={payslip.id} className="overflow-hidden rounded-xl border border-slate-200/90 shadow-sm ring-1 ring-slate-900/5">
                                            <CardContent className="space-y-4 p-4 sm:p-5">
                                                <div>
                                                    <h4 className="font-semibold text-slate-900">Pay period</h4>
                                                    <p className="text-sm text-slate-600">
                                                        {startDate} – {endDate}
                                                    </p>
                                                    {payslip.salary_paid_date && (
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            Salary paid: {new Date(payslip.salary_paid_date).toLocaleDateString()}
                                                        </p>
                                                    )}
                                                    <p className="mt-1 text-xs text-slate-400">Passed out {createdDate}</p>
                                                </div>
                                                <div className="flex flex-col gap-2 sm:flex-row">
                                                    <Button
                                                        type="button"
                                                        onClick={() => handleViewPassedOutPayslip(payslip, 'payslip')}
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-10 flex-1 border-slate-200"
                                                    >
                                                        <FileText className="mr-2 h-4 w-4" />
                                                        View
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPayslipDownloadDialog(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!documentPreview} onOpenChange={(open) => !open && setDocumentPreview(null)}>
                <DialogContent className="akk-dialog--fullscreen flex h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] flex-col gap-0 rounded-none border-0 p-0 pt-[env(safe-area-inset-top,0px)] sm:h-[min(90vh,800px)] sm:max-h-[90vh] sm:max-w-4xl sm:rounded-lg sm:border sm:pt-0">
                    <DialogHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b px-3 py-3 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:px-4">
                        <DialogTitle className="truncate pr-2 text-left text-base font-semibold">
                            {documentPreview?.title || 'Document'}
                        </DialogTitle>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9"
                                onClick={handlePrintDocumentPreview}
                                disabled={!documentPreview?.html || isPreviewPdfExporting}
                            >
                                {isPreviewPdfExporting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Printer className="mr-2 h-4 w-4" />
                                )}
                                {isNativeApp ? 'Save PDF' : 'Print'}
                            </Button>
                            <Button type="button" variant="default" size="sm" className="h-9" onClick={() => setDocumentPreview(null)}>
                                Back
                            </Button>
                        </div>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 bg-white">
                        {documentPreview?.html ? (
                            <iframe
                                title={documentPreview.title}
                                srcDoc={documentPreview.html}
                                className="h-full w-full border-0"
                            />
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

        </div>
    );
}
