import { supabaseTimesheet as supabase } from '@/core/supabase';
import { getLocalWorkerIds } from '@/core/localWorkers';
import { storageKey } from '@/core/storage';
import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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
    Calendar, FileSpreadsheet, FileText, Loader2, Printer,
    CheckCircle, XCircle, AlertCircle, Edit2, ChevronDown, ChevronUp,
    MapPin, Coffee, DollarSign, Users, Eye, EyeOff, Receipt, HelpCircle
} from "lucide-react";
import { fromDateTimeLocalUtc, toDateTimeLocalUtc, cn } from '@/modules/timesheet/lib/utils';
import { useLanguage } from '@/core-i18n';
import TopBar from '@/ui/hub/TopBar';
import { Link } from "react-router-dom";
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { useHubSection } from '@/app/useHubSection';
import { format } from "date-fns";
import QRCode from "qrcode";
import { toast } from "sonner";
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { sendBrowserNotification } from '@/modules/timesheet/lib/emailNotification';
import { formatTime, formatDate, isSunday, isPublicHoliday, shouldCreditUnworkedPublicHoliday, calculateShiftHours, getWorkDateFromDateTime, parseDateOnly, getTodaySingapore, addDaysToYmd, ymdEndOfMonth } from '@/modules/timesheet/lib/timeUtils';
import { isPaidLeaveTypeName, isUnpaidLeaveTypeName, isHalfDayLeaveType } from '@/modules/timesheet/lib/contributionCalculations';
import AppTour from '@/modules/timesheet/components/AppTour';
import DashboardAnalyticsWidget from '@/modules/timesheet/components/DashboardAnalyticsWidget';
import { registerPushForManager } from '@/modules/timesheet/lib/pushRegistration';
import {
    applyApprovalOnShiftSave,
    approveShiftRecord,
    declineShiftRecord,
    filterShiftsForPayroll,
    getShiftApproverName,
    getShiftEditorName,
    getShiftActorName,
    isShiftApproved,
    matchesUnapprovedFilter,
    pendingOnCompleteFields,
    shiftNeedsApprovalActions,
} from '@/modules/timesheet/lib/shiftApproval';
import {
    ShiftApprovalButtons,
    ShiftApprovalMeta,
    ShiftApprovalStatusBadge,
} from '@/modules/timesheet/components/ShiftApprovalActions';
import ManagerLeavePanel from '@/modules/timesheet/components/ManagerLeavePanel';
import CompanyFormReviewPanel from '@/modules/timesheet/components/companyForms/CompanyFormReviewPanel';
import CompanyFormQuestionsEditor from '@/modules/timesheet/components/companyForms/CompanyFormQuestionsEditor';
import RecommendedResultsEditor from '@/modules/timesheet/components/companyForms/RecommendedResultsEditor';
import ManagerTimesheets from '@/modules/timesheet/pages/ManagerTimesheets';
import { PortalBackdrop, glassPanel, ModuleSectionHead } from '@/ui/PortalShell';
import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import {
    ManagerMobileSectionStrip,
    MANAGER_TAB_TITLES,
} from '@/modules/timesheet/components/admin/AdminNavChrome';


const SHIFT_PAGE = 50;

const MANAGER_DASHBOARD_SECTIONS = ['time-tracker', 'leaves', 'company-forms', 'timesheets'];
const NATIVE_APP = isNativeApp();

// Production logging system
const DEBUG_MODE = process.env.NODE_ENV === 'development';
const log = {
    info: (message, ...args) => DEBUG_MODE && console.log(message, ...args),
    error: (message, ...args) => console.error(message, ...args), // Always log errors
    warn: (message, ...args) => DEBUG_MODE && console.warn(message, ...args),
    debug: (message, ...args) => DEBUG_MODE && console.debug(message, ...args)
};

export default function ManagerDashboard() {
    const { t } = useLanguage();
    const [managerTab, setManagerTab] = useHubSection('time-tracker', MANAGER_DASHBOARD_SECTIONS);
    // Long lists render in pages: ~1,000 shift cards at once made the screen crawl.
    const [shiftLimit, setShiftLimit] = useState(SHIFT_PAGE);
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
    const [workerIdFilter, setWorkerIdFilter] = useState('');
    const [expandedCards, setExpandedCards] = useState(new Set());
    const [siteFilter, setSiteFilter] = useState('all');
    const [showCreateShiftDialog, setShowCreateShiftDialog] = useState(false);
    const [isCreatingShift, setIsCreatingShift] = useState(false);
    const [approvingShiftId, setApprovingShiftId] = useState(null);
    const [editSaveAndApprove, setEditSaveAndApprove] = useState(false);
    const [showEditShiftDialog, setShowEditShiftDialog] = useState(false);
    const [showPrintDialog, setShowPrintDialog] = useState(false);
    const [printWorkerId, setPrintWorkerId] = useState('');
    const [printStartDate, setPrintStartDate] = useState('');
    const [printEndDate, setPrintEndDate] = useState('');
    const [editingShift, setEditingShift] = useState(null);
    const shiftPollHeadTsRef = useRef(null);
    const [shiftEditData, setShiftEditData] = useState({
        entry_time: '',
        leave_time: '',
        breaks: [{ lunch_start: '', lunch_end: '' }],
        leave_type: '__none__'
    });
    const [createShiftData, setCreateShiftData] = useState({
        worker_id: '',
        site_id: '',
        work_date: '',
        entry_time: '',
        leave_time: '',
        breaks: [{ lunch_start: '', lunch_end: '' }],
        leave_type: '__none__'
    });
    const [isTutorialRunning, setIsTutorialRunning] = useState(false);
    const managerTutorialSteps = [
        {
            id: 'manager-header',
            target: '[data-tour="manager-header"]',
            content: "This is the Manager Dashboard where you monitor team attendance and shift status in real time.",
            disableBeacon: true
        },
        {
            id: 'manager-export',
            target: '[data-tour="manager-export"]',
            content: "Export Excel downloads the filtered shift view so managers can share reports quickly.",
        },
        {
            id: 'manager-create-shift',
            target: '[data-tour="manager-create-shift"]',
            content: "Create Shift lets you add manual shifts for workers, including date, site, times, and breaks.",
        },
        {
            id: 'manager-filters-prompt',
            target: '[data-tour="manager-filters"]',
            title: "Filter system overview",
            content: "This is the filter system. Would you like a deeper walkthrough for each filter button and field?",
            data: {
                prompt: {
                    yesLabel: "Yes, go deeper",
                    noLabel: "No, next section",
                    noGoToId: "manager-edit-shift"
                }
            }
        },
        {
            target: '[data-tour="manager-filter-search"]',
            content: "Search filter: type worker name, ID, or site text to quickly narrow the shift list.",
        },
        {
            target: '[data-tour="manager-filter-status"]',
            content: "Status filter tabs: switch between all shifts, completed shifts, or in-progress shifts.",
        },
        {
            target: '[data-tour="manager-filter-date"]',
            content: "Date filter tabs: switch between all/month/year modes and pick the required month or year.",
        },
        {
            target: '[data-tour="manager-filter-site"]',
            content: "Site filter: show shifts for one site only when investigating site-level attendance.",
        },
        {
            target: '[data-tour="manager-filter-worker-id"]',
            content: "Worker ID filter: enter a worker ID to isolate a specific person quickly.",
        },
        {
            id: 'manager-edit-shift',
            target: '[data-tour="manager-edit-shift"]',
            content: "Edit button: open a shift for manual corrections such as entry/exit time, breaks, or leave type.",
        },
        {
            id: 'manager-shifts-list',
            target: '[data-tour="manager-shifts-list"]',
            content: "This section lists all matching shifts. Expand any card to inspect full details and update it.",
        },
    ];

    const queryClient = useQueryClient();
    const [managerEmail, setManagerEmail] = useState(() => localStorage.getItem(storageKey('timesheet', 'managerEmail')) || '');

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'manager') {
                const email = session.session_data?.managerEmail || session.subject_id;
                if (email) setManagerEmail(email);
            }
        });
    }, []);

    useEffect(() => {
        if (!managerEmail) return undefined;
        void registerPushForManager(managerEmail);
        return undefined;
    }, [managerEmail]);

    // Debounce search term for better performance
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Fetch shifts data (date range follows active filter — full month/year when selected)
    const { data: shifts = [], isLoading, isError: isShiftsError, error: shiftsError, isRefetching: isRefetchingShifts, refetch } = useQuery({
        queryKey: ['shifts', 'manager', dateFilter, selectedMonth, selectedYear],
        queryFn: async () => {
            const todayDateStr = getTodaySingapore();

            let baseQuery = supabase
                .from('shifts')
                .select('*')
                .is('leave_type', null);

            if (dateFilter === 'month') {
                let year;
                let month;
                if (selectedMonth) {
                    [year, month] = selectedMonth.split('-');
                } else {
                    year = todayDateStr.slice(0, 4);
                    month = todayDateStr.slice(5, 7);
                }
                const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const endDate = ymdEndOfMonth(year, month);
                baseQuery = baseQuery.gte('work_date', startDate).lte('work_date', endDate);
            } else if (dateFilter === 'year') {
                const year = selectedYear || todayDateStr.slice(0, 4);
                baseQuery = baseQuery
                    .gte('work_date', `${year}-01-01`)
                    .lte('work_date', `${year}-12-31`);
            } else {
                const dateLimit = addDaysToYmd(todayDateStr, -35);
                baseQuery = baseQuery.gte('work_date', dateLimit).lte('work_date', todayDateStr);
            }

            // Fetch all local worker IDs to exclude them from manager dashboard
            const localWorkerIds = [...(await getLocalWorkerIds())];
            // Fetch all shifts in batches to overcome Supabase's 1000 row default limit
            const allShifts = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;
            let batchCount = 0;
            
            while (hasMore) {
                batchCount++;
                const { data, error } = await baseQuery
                    .order('work_date', { ascending: false })
                    .order('entry_time', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(offset, offset + batchSize - 1);

                if (error) {
                    console.error('❌ Manager Dashboard: Error fetching shifts:', error);
                    throw error;
                }

                if (!data || data.length === 0) {
                    hasMore = false;
                } else {
                    // Filter out local workers
                    const filteredData = localWorkerIds.length > 0 
                        ? data.filter(shift => !localWorkerIds.includes(shift.worker_id))
                        : data;
                    
                    allShifts.push(...filteredData);
                    if (data.length < batchSize) {
                        hasMore = false;
                    }
                    offset += batchSize;
                }
            }

            // Fetch related data
            if (allShifts && allShifts.length > 0) {
                const siteIds = [...new Set(allShifts.map(shift => shift.site_id))];
                const workerIds = [...new Set(allShifts.map(shift => shift.worker_id))];
                const shiftIds = allShifts.map(shift => shift.id);

                // Fetch sites
                const { data: sites } = await supabase
                    .from('sites')
                    .select('id, site_name')
                    .in('id', siteIds);

                // Fetch workers
                const { data: workers } = await supabase
                    .from('worker_details')
                    .select('employee_id, employee_name')
                    .in('employee_id', workerIds);

                // Fetch breaks for all shifts (same as AdminDashboard)
                const allBreaks = [];
                const fetchBatchSize = 100; // Process 100 shift IDs at a time

                for (let i = 0; i < shiftIds.length; i += fetchBatchSize) {
                    const batch = shiftIds.slice(i, i + fetchBatchSize);
                    const { data: batchBreaks, error: batchError } = await supabase
                        .from('breaks')
                        .select('*')
                        .in('shift_id', batch.length > 0 ? batch : [''])
                        .order('break_start', { ascending: true });

                    if (batchError) {
                        console.error('❌ Breaks batch fetch error:', batchError);
                        continue; // Continue with next batch even if one fails
                    }

                    if (batchBreaks) {
                        allBreaks.push(...batchBreaks);
                    }
                }

                // Group breaks by shift_id
                const breaksByShiftId = {};
                if (allBreaks) {
                    allBreaks.forEach(breakItem => {
                        if (!breaksByShiftId[breakItem.shift_id]) breaksByShiftId[breakItem.shift_id] = [];
                        breaksByShiftId[breakItem.shift_id].push(breakItem);
                    });
                }

                // Merge data into shifts
                const shiftsWithData = allShifts.map(shift => ({
                    ...shift,
                    workers: workers?.find(w => w.employee_id === shift.worker_id) || null,
                    sites: sites?.find(s => s.id === shift.site_id) || null,
                    breaks: breaksByShiftId[shift.id] || []
                }));

                return shiftsWithData;
            }

            return allShifts || [];
        },
        refetchInterval: false // Disabled - using smart polling instead
    });

    // Smart polling: refetch when global newest shifts.created_at changes (fixes null-baseline = never refetch)
    useEffect(() => {
        const smartHeartbeat = setInterval(async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const { data: latestShiftData, error } = await supabase
                    .from('shifts')
                    .select('created_at')
                    .is('leave_type', null)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (error) {
                    console.error('❌ Smart heartbeat error:', error);
                    return;
                }

                const headTs = latestShiftData?.[0]?.created_at;
                if (!headTs) return;

                if (shiftPollHeadTsRef.current !== headTs) {
                    shiftPollHeadTsRef.current = headTs;
                    refetch();
                }
            } catch (error) {
                console.error('Smart heartbeat failed:', error);
            }
        }, 5000);

        return () => clearInterval(smartHeartbeat);
    }, [refetch]);

    // Note: Removed 1-second heartbeat for performance. Smart polling handles data updates.
    /*
    // Add 1-second heartbeat to refresh page
    useEffect(() => {
        const interval = setInterval(() => {
            refetch().catch(error => {
                if (error) {
                    console.error('❌ Manager Dashboard: Refetch error in heartbeat:', error);
                } else {
                }
            });
        }, 1000); // Refresh every 1 second

        return () => clearInterval(interval);
    }, [refetch]);
    */

    // Fetch sites for dropdown
    const { data: sites = [] } = useQuery({
        queryKey: ['sites'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('sites')
                .select('id, site_name')
                .eq('is_active', true)
                .order('site_name');

            if (error) throw error;
            return data || [];
        }
    });

    // Helper function for card expansion
    const toggleCardExpansion = (shiftId) => {
        const newExpanded = new Set(expandedCards);
        if (newExpanded.has(shiftId)) {
            newExpanded.delete(shiftId);
        } else {
            newExpanded.add(shiftId);
        }
        setExpandedCards(newExpanded);
    };


    // Filter shifts - optimized with useMemo
    const filteredShifts = useMemo(() => {
        return shifts.filter(shift => {
            let matchesSearch = false;
            if (debouncedSearchTerm.startsWith('/')) {
                // Keep Admin-style "/workerId" quick filter behavior
                const searchWorkerId = debouncedSearchTerm.slice(1).toLowerCase().trim();
                matchesSearch = String(shift.worker_id || '').toLowerCase().includes(searchWorkerId);
            } else {
                matchesSearch = !debouncedSearchTerm ||
                    shift.workers?.employee_name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    String(shift.worker_id || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    shift.sites?.site_name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
            }

            const matchesFilter = filter === 'all' ||
                (filter === 'completed' && shift.has_left) ||
                (filter === 'in_progress' && !shift.has_left) ||
                (filter === 'unapproved' && matchesUnapprovedFilter(shift));

            const matchesSite = siteFilter === 'all' || shift.sites?.site_name === siteFilter;
            const matchesWorkerId = !workerIdFilter || String(shift.worker_id || '').toLowerCase().includes(workerIdFilter.toLowerCase());

            // Date filtering (same behavior as Admin)
            let matchesDate = true;
            if (dateFilter !== 'all' && shift.work_date) {
                const shiftDate = new Date(shift.work_date + 'T00:00:00');

                if (dateFilter === 'month') {
                    if (selectedMonth) {
                        const [year, month] = selectedMonth.split('-');
                        const targetYear = parseInt(year);
                        const targetMonth = parseInt(month) - 1;
                        matchesDate = shiftDate.getMonth() === targetMonth &&
                                     shiftDate.getFullYear() === targetYear;
                    } else {
                        const now = new Date();
                        matchesDate = shiftDate.getMonth() === now.getMonth() &&
                                     shiftDate.getFullYear() === now.getFullYear();
                    }
                } else if (dateFilter === 'year') {
                    const targetYear = parseInt(selectedYear || new Date().getFullYear());
                    matchesDate = shiftDate.getFullYear() === targetYear;
                }
            }

            return matchesSearch && matchesFilter && matchesSite && matchesWorkerId && matchesDate;
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
    }, [shifts, debouncedSearchTerm, filter, siteFilter, workerIdFilter, dateFilter, selectedMonth, selectedYear]);

    // Unique sites - optimized with useMemo
    const uniqueSites = useMemo(() => {
        return [...new Set(shifts.map(shift => shift.sites?.site_name).filter(Boolean))];
    }, [shifts]);

    const resetCreateShiftForm = () => {
        setCreateShiftData({
            worker_id: '',
            site_id: '',
            work_date: '',
            entry_time: '',
            leave_time: '',
            breaks: [{ lunch_start: '', lunch_end: '' }],
            leave_type: '__none__'
        });
    };

    const openEditShiftDialog = async (shift, saveAndApprove = false) => {
        const { data: breaksData } = await supabase
            .from('breaks')
            .select('*')
            .eq('shift_id', shift.id)
            .order('break_start', { ascending: true });

        const formBreaksData = (breaksData || []).map((breakItem) => ({
            lunch_start: toDateTimeLocalUtc(breakItem.break_start),
            lunch_end: toDateTimeLocalUtc(breakItem.break_end),
            id: breakItem.id,
            break_number: breakItem.break_number,
        }));

        setEditingShift(shift);
        setEditSaveAndApprove(saveAndApprove);
        setShiftEditData({
            entry_time: toDateTimeLocalUtc(shift.entry_time),
            leave_time: toDateTimeLocalUtc(shift.leave_time),
            breaks: formBreaksData,
            leave_type: shift.leave_type || '__none__',
            originalBreaks: breaksData || [],
        });
        setShowEditShiftDialog(true);
    };

    const handleApproveShift = async (shift) => {
        if (!shift?.id || isShiftApproved(shift)) return;
        setApprovingShiftId(shift.id);
        try {
            await approveShiftRecord(supabase, shift.id, getShiftApproverName('manager'));
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

    const handleCreateShiftSubmit = async () => {
        if (isCreatingShift) return;
        setIsCreatingShift(true);
        const workerId = (createShiftData.worker_id || '').trim();

        if (!workerId || !createShiftData.work_date || !createShiftData.entry_time) {
            toast.error('Worker ID, work date, and entry time are required');
            setIsCreatingShift(false);
            return;
        }

        const entryTimeIso = fromDateTimeLocalUtc(createShiftData.entry_time);
        const leaveTimeIso = fromDateTimeLocalUtc(createShiftData.leave_time);

        if (!entryTimeIso) {
            toast.error('Entry time is invalid');
            setIsCreatingShift(false);
            return;
        }

        if (leaveTimeIso && new Date(leaveTimeIso).getTime() <= new Date(entryTimeIso).getTime()) {
            toast.error('Exit time must be after entry time');
            setIsCreatingShift(false);
            return;
        }

        const workDateFromEntry = getWorkDateFromDateTime(entryTimeIso);
        const workDate = workDateFromEntry || createShiftData.work_date;

        const rawBreaks = createShiftData.breaks || [];
        for (let i = 0; i < rawBreaks.length; i++) {
            const b = rawBreaks[i];
            const hasStart = !!b.lunch_start;
            const hasEnd = !!b.lunch_end;
            if (hasStart !== hasEnd) {
                toast.error('Each break must have both start and end time');
                setIsCreatingShift(false);
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
                    setIsCreatingShift(false);
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
            : { basicHours: 0, sundayHours: 0, otHours: 0, breakHours: 0 };

        try {
            const { data: localWorker, error: localError } = await supabase
                .from('local_worker_details')
                .select('employee_id')
                .eq('employee_id', workerId)
                .maybeSingle();

            let workerExists = !localError && !!localWorker;

            if (!workerExists) {
                const { data: foreignWorker, error: foreignError } = await supabase
                    .from('worker_details')
                    .select('employee_id')
                    .eq('employee_id', workerId)
                    .maybeSingle();

                workerExists = !foreignError && !!foreignWorker;
            }

            if (!workerExists) {
                toast.error('Worker ID not found in worker tables');
                setIsCreatingShift(false);
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
                if (insertShiftError.code === '23505') {
                    toast.error('Shift already exists for this worker and date');
                } else if (insertShiftError.code === '23503') {
                    toast.error('Invalid worker or site information');
                } else {
                    toast.error('Failed to create shift');
                }
                setIsCreatingShift(false);
                return;
            }

            if (normalizedBreaks.length > 0 && insertedShift?.id) {
                const { error: insertBreaksError } = await supabase.from('breaks').insert(
                    normalizedBreaks.map((b) => ({
                        shift_id: insertedShift.id,
                        break_start: b.break_start,
                        break_end: b.break_end
                    }))
                );

                if (insertBreaksError) {
                    toast.error('Shift created but failed to save breaks');
                    setIsCreatingShift(false);
                    return;
                }
            }

            toast.success('Shift created successfully');
            setShowCreateShiftDialog(false);
            resetCreateShiftForm();
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
        } catch (error) {
            console.error('Unexpected error creating shift:', error);
            toast.error('Failed to create shift');
        } finally {
            setIsCreatingShift(false);
        }
    };

    // Update shift mutation
    const updateShiftMutation = useMutation({
        mutationFn: async ({ shiftId, updateData }) => {
            const { data, error } = await supabase
                .from('shifts')
                .update(updateData)
                .eq('id', shiftId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: async (data, variables) => {
            toast.success('Shift updated successfully!');
            setShowEditShiftDialog(false);
            setEditingShift(null);
            
            // Invalidate all shift-related queries to ensure updates reflect everywhere
            queryClient.invalidateQueries(['shifts']);
            
            // Get worker_id from the updated shift data
            let workerId = data?.worker_id;
            if (!workerId && variables?.shiftId) {
                const { data: shiftData } = await supabase
                    .from('shifts')
                    .select('worker_id')
                    .eq('id', variables.shiftId)
                    .single();
                workerId = shiftData?.worker_id;
            }
            
            // Invalidate WorkerPortal's currentShift query for this worker
            if (workerId) {
                queryClient.invalidateQueries(['currentShift', workerId]);
            }
            // Also invalidate all currentShift queries (pattern match)
            queryClient.invalidateQueries(['currentShift']);
        },
        onError: (error) => {
            console.error('❌ Manager Dashboard: Error updating shift:', error);
            console.error('Error details:', {
                message: error?.message,
                code: error?.code,
                status: error?.status,
                hint: error?.hint,
                details: error?.details
            });
            const errorMsg = error?.message || 'Failed to update shift';
            const detailMsg = error?.hint ? ` (${error.hint})` : '';
            toast.error(`Failed to update shift${detailMsg}`);
        }
    });


    const exportToExcel = async () => {
        const exportData = filteredShifts.map(shift => ({
            'Worker ID': shift.worker_id,
            'Worker Name': shift.workers?.employee_name || 'Unknown',
            'Site': shift.sites?.site_name || 'Unknown',
            'Work Date': formatDate(shift.work_date),
            'Entry Time': formatTime(shift.entry_time),
            'Leave Time': formatTime(shift.leave_time),
            'Status': shift.has_left ? 'Completed' : 'In Progress',
            'Worked Hours': shift.worked_hours || 0,
            'OT Hours': shift.ot_hours || 0,
            'Sunday Hours': shift.sunday_hours || 0
        }));

        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Shifts");
        XLSX.writeFile(wb, `shifts_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    const printTimesheetOnly = async (workerId, startDate, endDate) => {
        try {
            const selectedWorkerId = String(workerId || '').trim();
            if (!selectedWorkerId || !startDate || !endDate) {
                toast.error('Please select worker ID and date range');
                return;
            }
            const to4SF = (value) => {
                if (value === 0 || value === null || value === undefined || isNaN(value)) return '0.00';
                const num = parseFloat(value);
                if (isNaN(num) || Math.abs(num) < 0.0001) return '0.00';
                const magnitude = Math.floor(Math.log10(Math.abs(num)));
                const factor = Math.pow(10, 3 - magnitude);
                const rounded = Math.round(num * factor) / factor;
                if (magnitude >= 2) return rounded.toFixed(0);
                if (magnitude >= 1) return rounded.toFixed(1);
                if (magnitude >= 0) return rounded.toFixed(2);
                if (magnitude >= -1) return rounded.toFixed(3);
                return rounded.toFixed(4);
            };

            const { data: shiftsData, error: shiftsError } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', selectedWorkerId)
                .gte('work_date', startDate)
                .lte('work_date', endDate)
                .order('work_date', { ascending: true })
                .order('entry_time', { ascending: true });

            if (shiftsError) throw shiftsError;

            const workerShifts = filterShiftsForPayroll(shiftsData || []);

            if (workerShifts.length === 0) {
                toast.error('No shifts found for this worker in the selected range');
                return;
            }

            let workerName = 'Unknown Worker';
            const { data: workerDetails } = await supabase
                .from('worker_details')
                .select('employee_name')
                .eq('employee_id', selectedWorkerId)
                .maybeSingle();
            if (workerDetails?.employee_name) {
                workerName = workerDetails.employee_name;
            }

            const siteIds = [...new Set(workerShifts.map(shift => shift.site_id).filter(Boolean))];
            const shiftIds = workerShifts.map(shift => shift.id);

            const { data: sites } = await supabase
                .from('sites')
                .select('id, site_name')
                .in('id', siteIds.length > 0 ? siteIds : ['']);
            const siteNameById = new Map((sites || []).map(site => [site.id, site.site_name]));

            const allBreaks = [];
            const breakBatchSize = 100;
            for (let i = 0; i < shiftIds.length; i += breakBatchSize) {
                const batch = shiftIds.slice(i, i + breakBatchSize);
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
            allBreaks.forEach(breakItem => {
                if (!breaksByShiftId[breakItem.shift_id]) {
                    breaksByShiftId[breakItem.shift_id] = [];
                }
                breaksByShiftId[breakItem.shift_id].push(breakItem);
            });

            // Group shifts by date and calculate daily totals (same logic as Admin)
            const shiftsByDate = {};
            workerShifts.forEach(shift => {
                const dateKey = shift.work_date;
                if (!shiftsByDate[dateKey]) {
                    shiftsByDate[dateKey] = [];
                }
                shiftsByDate[dateKey].push(shift);
            });

            // Reset monthly totals and accumulate them from the SAME daily logic used to build the table.
            let monthlyBasicHours = 0;
            let monthlySundayHours = 0;
            let monthlyOtHours = 0;
            let monthlyWorkedHours = 0; // actual worked only (exclude PH credit-only + leave)
            let monthlyPayableOtHours = 0;   // OT column total (min 2h per day)
            let monthlyIncentiveHours = 0;   // Incentive column total (OT beyond 2h per day)

            // Generate all days in the date range (calendar dates via parseDateOnly, not UTC ISO)
            const startObj = parseDateOnly(startDate);
            const endObj = parseDateOnly(endDate);
            const rows = [];
            if (!startObj || !endObj || endObj < startObj) {
                toast.error('Invalid date range');
                return;
            }

            for (let d = new Date(startObj.getTime()); d <= endObj; d.setDate(d.getDate() + 1)) {
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const dayShifts = shiftsByDate[dateStr] || [];
                const isSundayDay = isSunday(dateStr);
                const isHolidayDay = isPublicHoliday(dateStr);

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
                        const shiftBreaks = breaksByShiftId[shift.id] || [];
                        const normalizedBreaks = shiftBreaks.map(b => ({
                            break_start: b.break_start,
                            break_end: b.break_end
                        }));
                        const recalc = calculateShiftHours(
                            shift.entry_time,
                            shift.leave_time,
                            normalizedBreaks,
                            shift.work_date
                        );
                        totalBasicHours += recalc.basicHours;
                        totalSundayHours += recalc.sundayHours;
                        totalOtHours += recalc.otHours;

                        shiftDetails.push({
                            entry: shift.entry_time ? formatTime(shift.entry_time) : '',
                            leave: shift.leave_time ? formatTime(shift.leave_time) : '',
                            lunch: '',
                            site: siteNameById.get(shift.site_id) || '',
                            basicHours: recalc.basicHours,
                            sundayHours: recalc.sundayHours,
                            otHours: recalc.otHours,
                            breakHours: recalc.breakHours,
                            isLeave: false
                        });
                    } else if (shift.leave_type) {
                        // This is a leave shift
                        hasLeaveShift = true;
                        leaveType = shift.leave_type;

                        // Paid leave (incl. Annual Leave_HALF_MORNING) → 8h full / 4h half-day
                        let leaveHours = 0;
                        if (isPaidLeaveTypeName(shift.leave_type)) {
                            leaveHours = isHalfDayLeaveType(shift.leave_type) ? 4 : 8;
                        } else if (isUnpaidLeaveTypeName(shift.leave_type)) {
                            leaveHours = 0;
                        }
                        totalBasicHours += leaveHours;
                        shiftDetails.push({
                            entry: '',
                            leave: '',
                            lunch: '',
                            site: '',
                            basicHours: leaveHours,
                            sundayHours: 0,
                            otHours: 0,
                            breakHours: 0,
                            isLeave: true
                        });
                    }
                });

                // Weekday PH with no shifts: credit 8 basic hours. Sunday PH is rest day (Monday in lieu).
                if (dayShifts.length === 0 && shouldCreditUnworkedPublicHoliday(dateStr)) {
                    totalBasicHours = 8;
                    totalSundayHours = 0;
                    totalOtHours = 0;
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

                const rowHighlightClass = incentiveHoursForDay > 0 ? 'incentive-row' : ((isSundayDay || isHolidayDay) ? 'sunday-row' : '');
                rows.push({
                    rawDate: dateStr,
                    date: formatDate(dateStr),
                    site: siteNames,
                    entry: entryTimes || '-',
                    breaksText: to4SF(totalBreakHours),
                    exit: leaveTimes || '-',
                    basicHours: totalBasicHours,
                    otHours: otForColumn,
                    incentiveHours: incentiveHoursForDay,
                    sundayHours: totalSundayHours,
                    breakHours: totalBreakHours,
                    totalHours: totalWorkedHours,
                    basicDays: basicDays,
                    sundayDays: sundayDays,
                    leaveType: leaveType || '',
                    highlightClass: rowHighlightClass,
                });
            }

            const totals = {
                basic: monthlyBasicHours,
                ot: monthlyPayableOtHours,
                sunday: monthlySundayHours,
                break: 0, // Not tracked monthly
                totalWorked: monthlyWorkedHours,
                incentive: monthlyIncentiveHours
            };

            const tableRowsHTML = rows.map((row, index) => `
                <tr class="${row.highlightClass}" style="background:${index % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                    <td>${row.date}</td>
                    <td>${row.entry}</td>
                    <td>${row.exit}</td>
                    <td style="text-align:right;">${row.breaksText}</td>
                    <td style="text-align:right;">${to4SF(row.otHours)}</td>
                    <td style="text-align:right;">${to4SF(row.incentiveHours)}</td>
                    <td style="text-align:right;">${to4SF(row.basicHours)}</td>
                    <td style="text-align:right;">${to4SF(row.sundayHours)}</td>
                    <td style="text-align:right;">${to4SF(row.totalHours)}</td>
                    <td style="text-align:right;">${to4SF(row.basicDays)}</td>
                    <td style="text-align:right;">${to4SF(row.sundayDays)}</td>
                    <td>${row.leaveType}</td>
                    <td>${row.site}</td>
                </tr>
            `).join('');

            const html = `
                <html>
                    <head>
                        <title>Timesheet - ${workerName} (${selectedWorkerId})</title>
                        <style>
                            body {
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                padding: 20px;
                                background: white;
                                color: #333;
                                line-height: 1.4;
                                font-size: 14px;
                            }
                            .header {
                                text-align: center;
                                margin-bottom: 20px;
                                border-bottom: 3px solid #333;
                                padding-bottom: 15px;
                            }
                            .company-name {
                                font-family: 'Calibri', 'Segoe UI', sans-serif;
                                font-weight: 700;
                                font-size: 24px;
                                margin: 0;
                                color: #b22222;
                            }
                            .company-address {
                                font-family: 'Aptos Narrow', 'Segoe UI', sans-serif;
                                font-size: 12px;
                                margin: 8px 0 0 0;
                                color: #666;
                            }
                            .report-title {
                                margin-top: 10px;
                                font-size: 16px;
                                font-weight: 700;
                                color: #333;
                            }
                            .worker-info {
                                margin: 15px 0;
                                padding: 15px;
                                background: #f8f9fa;
                                border: 2px solid #dee2e6;
                                border-radius: 8px;
                                font-size: 12px;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            }
                            .worker-info-grid {
                                display: grid;
                                grid-template-columns: 1fr 1fr;
                                gap: 15px;
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
                                display: grid;
                                grid-template-columns: repeat(3, 1fr);
                                gap: 5px;
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
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1 class="company-name">AKK ENGINEERING PTE. LTD.</h1>
                            <p class="company-address">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
                            <h2 class="report-title">Manager Timesheet</h2>
                        </div>
                        <div class="worker-info">
                            <div class="worker-info-grid">
                                <div><strong>Employee Name:</strong> ${workerName}</div>
                                <div><strong>Employee ID:</strong> ${selectedWorkerId}</div>
                                <div><strong>Start Date:</strong> ${formatDate(startDate)}</div>
                                <div><strong>End Date:</strong> ${formatDate(endDate)}</div>
                            </div>
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
                                    <th>B.Days</th>
                                    <th>S.Days</th>
                                    <th>Leave Type</th>
                                    <th>Site</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRowsHTML}
                            </tbody>
                        </table>
                        <div class="totals">
                            <div><strong>Basic Hours:</strong> ${to4SF(totals.basic)}</div>
                            <div><strong>OT Hours:</strong> ${to4SF(totals.ot)}</div>
                            <div><strong>Worked Hours:</strong> ${to4SF(totals.totalWorked)}</div>
                            <div><strong>Sun/PH Hours:</strong> ${to4SF(totals.sunday)}</div>
                            <div><strong>Basic Days:</strong> ${to4SF(totals.basic / 8)}</div>
                            <div><strong>Sun/PH Days:</strong> ${to4SF(totals.sunday / 8)}</div>
                            ${totals.incentive > 0 ? `<div><strong>Incentive Hours:</strong> ${to4SF(totals.incentive)}</div>` : ''}
                        </div>
                    </body>
                </html>
            `;
            const result = await printOrShareHtmlDocument(html, {
                title: 'Print manager timesheet',
                fileName: `Manager_Timesheet_${Date.now()}.pdf`,
                printDelayMs: 350,
            });
            toast.success(
                result?.mode === 'share'
                    ? 'Choose an app to save, print, or share the PDF'
                    : 'Print dialog opened — use "Save as PDF" to download'
            );
        } catch (error) {
            console.error('Error printing timesheet:', error);
            toast.error(error.message || 'Failed to print timesheet');
        }
    };

    const handleUpdateShift = async (approveAfterSaveOverride = null) => {
        if (!editingShift) return;

        const entryTimeIso = fromDateTimeLocalUtc(shiftEditData.entry_time);
        const leaveTimeIso = fromDateTimeLocalUtc(shiftEditData.leave_time);

        if (!entryTimeIso) {
            toast.error('Entry time is required');
            return;
        }

        if (leaveTimeIso && new Date(leaveTimeIso).getTime() <= new Date(entryTimeIso).getTime()) {
            toast.error('Exit time must be after entry time');
            return;
        }

        // Automatically derive work_date from entry_time in Singapore timezone
        // This fixes the issue where shifts starting at 00:24 are marked as previous day
        const workDateFromEntry = getWorkDateFromDateTime(entryTimeIso);
        const workDate = workDateFromEntry || editingShift.work_date;

        const rawBreaks = shiftEditData.breaks || [];
        const originalBreaks = shiftEditData.originalBreaks || [];

        // Function to compare breaks arrays
        const breaksEqual = (formBreaks, dbBreaks) => {
            if (formBreaks.length !== dbBreaks.length) {
                return false;
            }

            const equal = formBreaks.every((formBreak, index) => {
                const dbBreak = dbBreaks[index];

                const formStart = new Date(fromDateTimeLocalUtc(formBreak.lunch_start));
                const formEnd = new Date(fromDateTimeLocalUtc(formBreak.lunch_end));
                const dbStart = new Date(dbBreak.break_start);
                const dbEnd = new Date(dbBreak.break_end);

                // Handle invalid dates - check if it's a valid Date object
                if (!formStart || isNaN(formStart.getTime()) || !formEnd || isNaN(formEnd.getTime())) {
                    return false;
                }

                const startDiff = Math.abs(formStart - dbStart);
                const endDiff = Math.abs(formEnd - dbEnd);

                // Allow 1 minute tolerance for time differences
                return startDiff <= (1000 * 60) && endDiff <= (1000 * 60);
            });

            return equal;
        };

        const breaksChanged = !breaksEqual(rawBreaks, originalBreaks);
        if (!breaksChanged) {
        } else {
        }

        for (let i = 0; i < rawBreaks.length; i++) {
            const b = rawBreaks[i];
            
            // Skip empty breaks
            if (!b.lunch_start || !b.lunch_end) {
                continue;
            }
            
            // For breaks, convert to ISO datetime (preserve full datetime)
            // Input format: "2026-01-19T12:00" (datetime-local) - convert directly to ISO
            const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
            const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;

            if (!startIso || !endIso) {
                toast.error(`Break ${i + 1} has invalid start or end time`);
                console.error(`Break ${i + 1} conversion failed:`, { lunch_start: b.lunch_start, lunch_end: b.lunch_end, startIso, endIso });
                return;
            }

            const startDate = new Date(startIso);
            const endDate = new Date(endIso);
            
            if (endDate <= startDate) {
                toast.error(`Break ${i + 1} end time must be after start time`);
                console.error(`Break ${i + 1} failed validation:`, { startIso, endIso, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
                return;
            }
        }

        const normalizedBreaks = rawBreaks
            .map((b) => ({
                break_start: b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null,
                break_end: b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null,
                shift_id: editingShift.id
            }))
            .filter((b) => b.break_start && b.break_end);

        // Update the shift record
        const updateData = {
            entry_time: entryTimeIso,
            leave_time: leaveTimeIso,
            has_left: !!leaveTimeIso,
            leave_type: shiftEditData.leave_type === '__none__' ? null : shiftEditData.leave_type,
            work_date: workDate
        };

        // Calculate hours if leave time is provided
        if (leaveTimeIso) {
            const calculations = calculateShiftHours(
                entryTimeIso,
                leaveTimeIso,
                normalizedBreaks,
                workDate
            );

            updateData.worked_hours = calculations.basicHours;
            updateData.ot_hours = calculations.otHours;
            updateData.sunday_hours = calculations.sundayHours;
            updateData.break_hours = calculations.breakHours;
        }

        try {
            const shiftUpdateData = applyApprovalOnShiftSave({
                shiftUpdateData: {
                    ...updateData,
                    edited_by: getShiftEditorName('manager'),
                },
                editingShift,
                isCompleted: !!leaveTimeIso,
                approveAfterSave: approveAfterSaveOverride ?? editSaveAndApprove,
                actorName: getShiftApproverName('manager'),
                role: 'manager',
            });

            // Update shift first
            let { data: updatedShift, error: shiftError } = await supabase
                .from('shifts')
                .update(shiftUpdateData)
                .eq('id', editingShift.id)
                .select()
                .single();

            // If error is due to missing edited_by column, retry without it
            if (shiftError && shiftError.message?.includes('edited_by')) {
                console.warn('edited_by column not found, retrying without it');
                const { edited_by, ...updateWithoutEditedBy } = shiftUpdateData;
                const retryResult = await supabase
                    .from('shifts')
                    .update(updateWithoutEditedBy)
                    .eq('id', editingShift.id)
                    .select()
                    .single();
                shiftError = retryResult.error;
                updatedShift = retryResult.data;
            }

            if (shiftError) {
                console.error('🚨 Shift update RLS error:', {
                    code: shiftError.code,
                    message: shiftError.message,
                    hint: shiftError.hint,
                    status: shiftError.status
                });
                throw shiftError;
            }

            if (breaksChanged) {
                // Get current breaks from database
                const { data: currentBreaks, error: verifyError } = await supabase
                    .from('breaks')
                    .select('*')
                    .eq('shift_id', editingShift.id)
                    .order('break_start', { ascending: true });

                if (verifyError) {
                    console.error('🚨 Error fetching current breaks:', verifyError);
                }

                // Delete existing breaks
                const { error: deleteBreaksError, count: deleteCount } = await supabase
                    .from('breaks')
                    .delete()
                    .eq('shift_id', editingShift.id);

                if (deleteBreaksError) {
                    console.error('🚨 Delete error:', {
                        code: deleteBreaksError.code,
                        message: deleteBreaksError.message,
                        hint: deleteBreaksError.hint,
                        status: deleteBreaksError.status
                    });
                    throw deleteBreaksError;
                } else {
                }

                // Verify deletion
                const { data: deletedCheck, error: checkError } = await supabase
                    .from('breaks')
                    .select('*')
                    .eq('shift_id', editingShift.id);

                if (checkError) {
                    console.error('🚨 Error checking after delete:', checkError);
                } else {
                }

                // Insert new breaks if any
                if (normalizedBreaks.length > 0) {
                    const { data: insertedBreaks, error: insertBreaksError } = await supabase
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
                        console.error('🚨 Insert breaks error:', {
                            code: insertBreaksError.code,
                            message: insertBreaksError.message,
                            hint: insertBreaksError.hint,
                            status: insertBreaksError.status
                        });
                        throw insertBreaksError;
                    } else {
                    }
                } else {
                }
            } else {
            }

            toast.success(editSaveAndApprove ? 'Shift saved and approved' : 'Shift updated successfully!');
            setShowEditShiftDialog(false);
            setEditingShift(null);
            setEditSaveAndApprove(false);
            queryClient.invalidateQueries(['shifts']);
        } catch (error) {
            console.error('Error updating shift:', error);
            toast.error('Failed to update shift');
        }
    };


    const managerDisplayName = getShiftActorName('manager') || localStorage.getItem(storageKey('timesheet', 'managerName')) || 'Manager';
    const unapprovedCount = shifts.filter((s) => matchesUnapprovedFilter(s)).length;
    const inProgressCount = shifts.filter((s) => !s.has_left).length;
    // Observe LeavePanel cache so the strip badge updates without a second fetch.
    const { data: pendingLeavesCache } = useQuery({
        queryKey: ['managerPendingLeaves'],
        queryFn: async () => [],
        enabled: false,
    });
    const leaveCount = Array.isArray(pendingLeavesCache) ? pendingLeavesCache.length : 0;

    return (
        <div className={cn('manager-dash-ui admin-dash-ui relative isolate min-h-dvh-safe overflow-x-hidden', NATIVE_APP ? 'akk-screen bg-[var(--g-bg)]' : 'bg-[var(--g-bg,#f3f4f6)]')}>
            {NATIVE_APP ? null : <PortalBackdrop />}
            <AppTour
                run={isTutorialRunning}
                steps={managerTutorialSteps}
                onClose={() => setIsTutorialRunning(false)}
            />
            <TopBar
                eyebrow={t('role.manager')}
                title={MANAGER_TAB_TITLES[managerTab] || managerDisplayName}
                subtitle={managerDisplayName}
                trailing={
                    <div className="flex items-center gap-1.5" data-tour="manager-header">
                        <Button
                            onClick={() => setIsTutorialRunning(true)}
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-full border-[var(--g-hairline)]"
                        >
                            <HelpCircle className="mr-1.5 h-4 w-4" />
                            {t('common.tutorial')}
                        </Button>
                    </div>
                }
            >
                <ManagerMobileSectionStrip
                    activeTab={managerTab}
                    onTabChange={setManagerTab}
                    leaveCount={leaveCount}
                />
            </TopBar>

            <main className="app-page-content relative z-10 mx-auto max-w-7xl px-safe py-5 pb-[calc(var(--g-tabbar-space,5.5rem)+1rem)]">
                <DashboardAnalyticsWidget shifts={shifts} variant={NATIVE_APP ? 'app' : 'glass'} accent="brand" />

                <Tabs value={managerTab} onValueChange={setManagerTab} className="mt-4 w-full">
                    <TabsList
                        data-section-nav
                        className={cn(
                            'h-auto w-full grid-cols-4 gap-1 rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] p-1 shadow-[0_1px_2px_rgb(15_29_51/0.04)]',
                            'hidden lg:grid'
                        )}
                        data-tour="manager-tabs"
                    >
                        <TabsTrigger value="time-tracker" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm">
                            <Clock className="mr-1.5 h-4 w-4" />
                            {t('admin.timeTracker')}
                        </TabsTrigger>
                        <TabsTrigger value="leaves" className="relative rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm">
                            <Calendar className="mr-1.5 h-4 w-4" />
                            {t('admin.leaves')}
                            {leaveCount > 0 ? (
                                <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1.5 text-xs">
                                    {leaveCount}
                                </Badge>
                            ) : null}
                        </TabsTrigger>
                        <TabsTrigger value="company-forms" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm">
                            <FileText className="mr-1.5 h-4 w-4" />
                            {t('admin.companyForms')}
                        </TabsTrigger>
                        <TabsTrigger value="timesheets" className="rounded-xl text-xs data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white lg:text-sm">
                            <Receipt className="mr-1.5 h-4 w-4" />
                            {t('admin.timesheet')}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="leaves" className="mt-4">
                        <ManagerLeavePanel managerName={managerDisplayName} />
                    </TabsContent>

                    <TabsContent value="company-forms" className="mt-4 space-y-4">
                        <CompanyFormReviewPanel
                            reviewerName={managerDisplayName}
                            reviewerRole="manager"
                            compact
                        />
                        <CompanyFormQuestionsEditor />
                        <RecommendedResultsEditor />
                    </TabsContent>

                    <TabsContent value="timesheets" className="mt-4">
                        <ManagerTimesheets embedded />
                    </TabsContent>

                    <TabsContent value="time-tracker" className="mt-4">
                <section className={cn(glassPanel, 'p-4 sm:p-5')}>
                    <ModuleSectionHead
                        icon={Clock}
                        title={t('admin.timeTracker')}
                        lede={[
                            t('ui.shown', { count: filteredShifts.length }),
                            shifts.length ? t('ui.loaded', { count: shifts.length }) : null,
                            inProgressCount ? t('ui.activeCount', { count: inProgressCount }) : null,
                            unapprovedCount ? t('ui.unapprovedCount', { count: unapprovedCount }) : null,
                        ].filter(Boolean).join(' · ')}
                        actions={
                        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                            <Button
                                onClick={() => {
                                    resetCreateShiftForm();
                                    setShowCreateShiftDialog(true);
                                }}
                                className="h-10 rounded-xl bg-[var(--g-brand)] text-white hover:bg-[var(--g-brand-press)]"
                                data-tour="manager-create-shift"
                            >
                                <PlusCircle className="mr-1.5 h-4 w-4" />
                                {t('ui.createShift')}
                            </Button>
                            <Button
                                onClick={exportToExcel}
                                variant="outline"
                                className="h-10 rounded-xl border-[var(--g-hairline)] bg-[var(--g-surface)]"
                                data-tour="manager-export"
                            >
                                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                                {t('ui.exportExcel')}
                            </Button>
                            <Button
                                onClick={() => setShowPrintDialog(true)}
                                variant="outline"
                                className="h-10 rounded-xl border-[var(--g-hairline)] bg-[var(--g-surface)]"
                            >
                                <Printer className="mr-1.5 h-4 w-4" />
                                {t('ui.printTimesheet')}
                            </Button>
                            <Button
                                variant="outline"
                                className="h-10 w-full rounded-xl border-[var(--g-hairline)] bg-[var(--g-surface)]"
                                onClick={() => setManagerTab('timesheets')}
                            >
                                <FileText className="mr-1.5 h-4 w-4" />
                                {t('ui.timesheets')}
                            </Button>
                        </div>
                        }
                    />

                    <div className="mb-4 space-y-3" data-tour="manager-filters">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                placeholder={t('ui.searchShifts')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                                data-tour="manager-filter-search"
                            />
                        </div>
                        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                            <Tabs value={filter} onValueChange={setFilter} data-tour="manager-filter-status" className="w-full lg:w-auto">
                                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1 sm:grid-cols-4 sm:inline-flex sm:w-auto">
                                    <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.all')}</TabsTrigger>
                                    <TabsTrigger value="unapproved" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">
                                        {t('ui.unapproved')}{unapprovedCount ? ` (${unapprovedCount})` : ''}
                                    </TabsTrigger>
                                    <TabsTrigger value="completed" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.done')}</TabsTrigger>
                                    <TabsTrigger value="in_progress" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.active')}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <Tabs value={dateFilter} onValueChange={(value) => {
                                setDateFilter(value);
                                if (value !== 'month') setSelectedMonth('');
                                if (value !== 'year') setSelectedYear(new Date().getFullYear().toString());
                            }} data-tour="manager-filter-date" className="w-full lg:w-auto">
                                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-slate-100/80 p-1 sm:inline-flex sm:w-auto">
                                    <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.allDates')}</TabsTrigger>
                                    <TabsTrigger value="month" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.month')}</TabsTrigger>
                                    <TabsTrigger value="year" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.year')}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            {dateFilter === 'month' && (
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm sm:w-auto"
                                >
                                    <option value="">Current Month</option>
                                    {Array.from({ length: 12 }, (_, i) => {
                                        const date = new Date();
                                        date.setMonth(date.getMonth() - i);
                                        const year = date.getFullYear();
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const monthName = date.toLocaleString('default', { month: 'long' });
                                        return (
                                            <option key={`${year}-${month}`} value={`${year}-${month}`}>
                                                {monthName} {year}
                                            </option>
                                        );
                                    })}
                                </select>
                            )}
                            {dateFilter === 'year' && (
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(e.target.value)}
                                    className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm sm:w-auto"
                                >
                                    {Array.from({ length: 5 }, (_, i) => {
                                        const year = new Date().getFullYear() - i;
                                        return (
                                            <option key={year} value={year.toString()}>
                                                {year}
                                            </option>
                                        );
                                    })}
                                </select>
                            )}
                            <select
                                value={siteFilter}
                                onChange={(e) => setSiteFilter(e.target.value)}
                                className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm lg:max-w-xs"
                                data-tour="manager-filter-site"
                            >
                                <option value="all">{t('ui.allSites')}</option>
                                {uniqueSites.map(site => (
                                    <option key={site} value={site}>{site}</option>
                                ))}
                            </select>
                            <Input
                                placeholder={t('ui.filterWorkerId')}
                                value={workerIdFilter}
                                onChange={(e) => setWorkerIdFilter(e.target.value)}
                                className="h-10 w-full min-w-0 rounded-xl border-slate-200 bg-white sm:max-w-xs"
                                data-tour="manager-filter-worker-id"
                            />
                        </div>
                    </div>

                    {NATIVE_APP && isLoading ? (
                        <NativeListSkeleton rows={3} label="Loading shifts" />
                    ) : NATIVE_APP && isShiftsError && !shifts.length ? (
                        <NativeErrorState error={shiftsError} onRetry={() => refetch()} retrying={isRefetchingShifts} className="shadow-none" />
                    ) : isLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-7 w-7 animate-spin text-[var(--g-brand)]" />
                        </div>
                    ) : filteredShifts.length === 0 ? (
                        <NativeEmptyState
                            icon={Clock}
                            title="No shifts found"
                            message="Shifts will appear here when workers clock in/out"
                        />
                    ) : (
                        <div className="space-y-2" data-tour="manager-shifts-list">
                            {filteredShifts.slice(0, shiftLimit).map((shift) => {
                                            const isSundayShift = isSunday(shift.work_date);
                                            const isHolidayShift = isPublicHoliday(shift.work_date);

                                            return (
                                                <div
                                                    key={shift.id}
                                                    className={cn(
                                                        'akk-list-card overflow-hidden rounded-[var(--g-r-lg)] border border-[var(--g-hairline)] bg-[var(--g-surface)]',
                                                        isSundayShift || isHolidayShift
                                                            ? 'border-red-200 bg-red-50/70'
                                                            : 'border-slate-200/80'
                                                    )}
                                                >
                                                    <div className="p-4">
                                                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleCardExpansion(shift.id)}
                                                                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                                                >
                                                                    <span className={cn(
                                                                        'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                                                        shift.has_left ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-800'
                                                                    )}>
                                                                        <Clock className="h-5 w-5" />
                                                                    </span>
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="flex items-center gap-2">
                                                                            <span className="truncate font-semibold text-slate-900">
                                                                                {shift.workers?.employee_name}
                                                                            </span>
                                                                            {expandedCards.has(shift.id) ? (
                                                                                <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                                                                            ) : (
                                                                                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                                                                            )}
                                                                        </span>
                                                                        <span className="mt-0.5 block text-xs text-slate-500">
                                                                            ID {shift.worker_id}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                                <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                                                                    <ShiftApprovalButtons
                                                                        shift={shift}
                                                                        onApprove={handleApproveShift}
                                                                        onDecline={handleDeclineShift}
                                                                        busy={approvingShiftId === shift.id}
                                                                    />
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="h-9 flex-1 rounded-xl border-slate-200 text-xs sm:flex-initial sm:text-sm"
                                                                        onClick={() => openEditShiftDialog(shift)}
                                                                        data-tour="manager-edit-shift"
                                                                    >
                                                                        <Edit2 className="mr-1 h-4 w-4" />
                                                                        {t('ui.edit')}
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-2">
                                                                            <Badge variant="outline"
                                                                                className={shift.has_left ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-800'}
                                                                            >
                                                                                {shift.has_left ? t('ui.completed') : t('ui.inProgress')}
                                                                            </Badge>
                                                                            <ShiftApprovalStatusBadge shift={shift} />
                                                                            {isSundayShift && (
                                                                                <Badge variant="destructive">{t('ui.sunday')}</Badge>
                                                                            )}
                                                                            {isHolidayShift && (
                                                                                <Badge variant="destructive">{t('ui.holiday')}</Badge>
                                                                            )}
                                                                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                                                                <Calendar className="w-3 h-3" />
                                                                                {formatDate(shift.work_date)}
                                                                            </span>
                                                                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                                                                <MapPin className="w-3 h-3" />
                                                                                {shift.sites?.site_name}
                                                                            </span>
                                                                        </div>
                                                                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                                                                            {shift.entry_time && (
                                                                                <span className="text-slate-600">
                                                                                    {t('ui.entry')}: {formatTime(shift.entry_time)}
                                                                                </span>
                                                                            )}
                                                                            {shift.breaks && shift.breaks.length > 0 && (
                                                                                <div className="space-y-1">
                                                                                    {shift.breaks.map((breakItem, breakIndex) => (
                                                                                        <div key={breakIndex} className="text-xs text-slate-600">
                                                                                            {t('ui.breakN', { n: breakIndex + 1 })}: {breakItem.break_start ? formatTime(breakItem.break_start) : t('ui.notSet')} - {breakItem.break_end ? formatTime(breakItem.break_end) : t('ui.notSet')}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                            {shift.leave_time && (
                                                                                <span className="text-slate-600">
                                                                                    {t('ui.exit')}: {formatTime(shift.leave_time)}
                                                                                </span>
                                                                            )}
                                                                            <ShiftApprovalMeta shift={shift} />
                                                                        </div>
                                                                        {shift.has_left && (() => {
                                                                            // Recalculate hours using new logic for display
                                                                            const recalc = calculateShiftHours(
                                                                                shift.entry_time,
                                                                                shift.leave_time,
                                                                                shift.breaks || [],
                                                                                shift.work_date
                                                                            );
                                                                            // Calculate break hours from breaks table - prioritize recalc over stored break_hours
                                                                            const breakHours = recalc.breakHours || shift.break_hours || 0;
                                                                            const basicH = recalc.basicHours;
                                                                            const sunPhH = recalc.sundayHours;
                                                                            const otH = recalc.otHours;

                                                                            return (
                                                                                <div className="flex items-center gap-4 text-sm">
                                                                                {basicH > 0 && (
                                                                                    <span className="text-green-600 font-medium">
                                                                                        {t('ui.basic')}: {basicH.toFixed(2)}h
                                                                                    </span>
                                                                                )}
                                                                                    <span className="text-slate-600 font-medium">
                                                                                        {t('ui.break')}: {breakHours.toFixed(2)}h
                                                                                    </span>
                                                                                {sunPhH > 0 && (
                                                                                    <span className="text-slate-800 font-medium">
                                                                                        Sun/PH: {sunPhH.toFixed(2)}h
                                                                                    </span>
                                                                                )}
                                                                                {otH > 0 && (
                                                                                    <span className="text-slate-800 font-medium">
                                                                                        OT: {otH.toFixed(2)}h
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            );
                                                                        })()}

                                                            {expandedCards.has(shift.id) && (
                                                                <div className="mt-4 pt-4 border-t border-slate-200">
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                                        <div>
                                                                            <h4 className="font-medium text-slate-700 mb-2">Time Details</h4>
                                                                            <div className="space-y-1">
                                                                                <p>Entry: {shift.entry_time ? formatTime(shift.entry_time) : 'Not recorded'}</p>
                                                                                {shift.breaks && shift.breaks.length > 0 ? (
                                                                                    shift.breaks.map((breakItem, index) => (
                                                                                        <p key={breakItem.id || `${shift.id}-break-${index}`} className="flex items-center gap-1">
                                                                                            <Coffee className="w-3 h-3" />
                                                                                            Break {index + 1}: {formatTime(breakItem.break_start)}
                                                                                            {breakItem.break_end ? ` - ${formatTime(breakItem.break_end)}` : ' (Ongoing)'}
                                                                                        </p>
                                                                                    ))
                                                                                ) : (
                                                                                    shift.break_hours && shift.break_hours > 0 && (
                                                                                        <p className="flex items-center gap-1">
                                                                                            <Coffee className="w-3 h-3" />
                                                                                            Break Hours: {shift.break_hours.toFixed(1)} hrs
                                                                                        </p>
                                                                                    )
                                                                                )}
                                                                                <p>Exit: {shift.leave_time ? formatTime(shift.leave_time) : 'Not recorded'}</p>
                                                                                {shift.edited_by && (
                                                                                    <p className="text-xs text-slate-500 mt-2 italic">
                                                                                        Edited By: {shift.edited_by}
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        {shift.has_left && (() => {
                                                                            // Recalculate hours using new logic for display
                                                                            const recalc = calculateShiftHours(
                                                                                shift.entry_time,
                                                                                shift.leave_time,
                                                                                shift.breaks || [],
                                                                                shift.work_date
                                                                            );
                                                                            // Calculate break hours from breaks table - prioritize recalc over stored break_hours
                                                                            const breakHours = recalc.breakHours || shift.break_hours || 0;
                                                                            const totalH = recalc.basicHours + recalc.sundayHours + recalc.otHours;

                                                                            return (
                                                                            <div>
                                                                                <h4 className="font-medium text-slate-700 mb-2">Hours Breakdown</h4>
                                                                                <div className="space-y-1">
                                                                                        <p>Basic Hours: {recalc.basicHours.toFixed(2)}</p>
                                                                                        <p>Sun/PH Hours: {recalc.sundayHours.toFixed(2)}</p>
                                                                                        <p>OT Hours: {recalc.otHours.toFixed(2)}</p>
                                                                                        <p>Break Hours: {breakHours.toFixed(2)}</p>
                                                                                        <p>Total Hours: {totalH.toFixed(2)}</p>
                                                                                </div>
                                                                            </div>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {filteredShifts.length > shiftLimit ? (
                                            <button
                                                type="button"
                                                className="g-btn g-btn--secondary g-btn--block"
                                                onClick={() => setShiftLimit((n) => n + SHIFT_PAGE)}
                                            >
                                                Show more ({filteredShifts.length - shiftLimit} more)
                                            </button>
                                        ) : null}
                        </div>
                    )}
                </section>
                    </TabsContent>
                </Tabs>
            </main>

            {/* Create Shift Dialog */}
            <Dialog open={showCreateShiftDialog} onOpenChange={setShowCreateShiftDialog}>
                <DialogContent className="max-w-2xl rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle>Create Shift</DialogTitle>
                        <DialogDescription>
                            Manually create a shift with entry, exit, breaks, and optional leave.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Worker ID</label>
                                <Input
                                    value={createShiftData.worker_id}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, worker_id: e.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Work Date</label>
                                <Input
                                    type="date"
                                    value={createShiftData.work_date}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, work_date: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Site (Optional)</label>
                            <Select
                                value={createShiftData.site_id || ''}
                                onValueChange={(value) =>
                                    setCreateShiftData({
                                        ...createShiftData,
                                        site_id: value === '__none__' ? '' : value
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select site" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No Site</SelectItem>
                                    {sites.map((site) => (
                                        <SelectItem key={site.id} value={String(site.id)}>
                                            {site.site_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Entry Time</label>
                                <Input
                                    type="datetime-local"
                                    value={createShiftData.entry_time}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, entry_time: e.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Exit Time (Optional)</label>
                                <Input
                                    type="datetime-local"
                                    value={createShiftData.leave_time}
                                    onChange={(e) =>
                                        setCreateShiftData({ ...createShiftData, leave_time: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">Breaks</label>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const currentBreaks = createShiftData.breaks || [];
                                    if (currentBreaks.length > 0) {
                                        const lastBreak = currentBreaks[currentBreaks.length - 1];
                                        if (!lastBreak.lunch_start || !lastBreak.lunch_end) {
                                            toast.error('Please fill start and end time for the last break before adding a new one');
                                            return;
                                        }
                                    }
                                    const newBreaks = [...currentBreaks, { lunch_start: '', lunch_end: '' }];
                                    setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                }}
                                className="text-xs"
                            >
                                + Add Break
                            </Button>
                        </div>
                        {createShiftData.breaks.map((breakItem, index) => (
                            <div key={index} className="border border-slate-200 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium">Break {index + 1}</h4>
                                    {createShiftData.breaks.length > 1 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                const newBreaks = createShiftData.breaks.filter((_, i) => i !== index);
                                                setCreateShiftData({ ...createShiftData, breaks: newBreaks });
                                            }}
                                            className="text-red-600 hover:text-red-700 h-11 w-11 p-0"
                                        >
                                            ×
                                        </Button>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                                            className="text-xs"
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
                                            className="text-xs"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div className="text-right text-xs text-slate-600">
                            Total Break Hours:{' '}
                            {(
                                (createShiftData.breaks || []).reduce((sum, b) => {
                                    try {
                                        if (!b.lunch_start || !b.lunch_end) return sum;
                                        
                                        // Parse datetime-local format (YYYY-MM-DDTHH:mm)
                                        const startDate = new Date(fromDateTimeLocalUtc(b.lunch_start));
                                        const endDate = new Date(fromDateTimeLocalUtc(b.lunch_end));
                                        
                                        // Validate dates
                                        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                            console.warn('Invalid break times:', { start: b.lunch_start, end: b.lunch_end });
                                            return sum;
                                        }
                                        
                                        const diffMs = endDate - startDate;
                                        if (!Number.isFinite(diffMs) || diffMs <= 0) return sum;
                                        return sum + diffMs / (1000 * 60 * 60);
                                    } catch (err) {
                                        console.error('Error calculating break hours:', err);
                                        return sum;
                                    }
                                }, 0)
                            ).toFixed(2)}h
                        </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Leave Type (Optional)</label>
                            <Select
                                value={createShiftData.leave_type}
                                onValueChange={(value) =>
                                    setCreateShiftData({ ...createShiftData, leave_type: value })
                                }
                            >
                                <SelectTrigger>
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
                    </div>

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setShowCreateShiftDialog(false)}>
                            Cancel
                        </Button>
                        <Button className="bg-brand hover:bg-brand-hover w-full sm:w-auto"
                            onClick={handleCreateShiftSubmit} disabled={isCreatingShift}>
                            {isCreatingShift ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Create Shift
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Print Timesheet Dialog */}
            <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
                <DialogContent className="max-w-2xl rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle>Print Timesheet</DialogTitle>
                        <DialogDescription>
                            Generate and print timesheet data for a worker within a date range.
                            This manager flow prints timesheet only (no payslip).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Worker ID</label>
                            <Input
                                placeholder="Enter Worker ID"
                                value={printWorkerId}
                                onChange={(e) => setPrintWorkerId(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Start Date</label>
                                <Input
                                    type="date"
                                    value={printStartDate}
                                    onChange={(e) => setPrintStartDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">End Date</label>
                                <Input
                                    type="date"
                                    value={printEndDate}
                                    onChange={(e) => setPrintEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto"
                            variant="outline"
                            onClick={() => {
                                setShowPrintDialog(false);
                                setPrintWorkerId('');
                                setPrintStartDate('');
                                setPrintEndDate('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={() => {
                                if (printWorkerId && printStartDate && printEndDate) {
                                    printTimesheetOnly(printWorkerId, printStartDate, printEndDate);
                                    setShowPrintDialog(false);
                                    setPrintWorkerId('');
                                    setPrintStartDate('');
                                    setPrintEndDate('');
                                } else {
                                    toast.error('Please fill worker ID, start date, and end date');
                                }
                            }} className="w-full sm:w-auto bg-slate-700 hover:bg-slate-800">
                            <Printer className="w-4 h-4 mr-2" />
                            Print Timesheet
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Shift Dialog */}
            <Dialog open={showEditShiftDialog} onOpenChange={setShowEditShiftDialog}>
                <DialogContent className="max-w-2xl rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle>Edit Shift</DialogTitle>
                        <DialogDescription>
                            Edit the shift details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                            <label className="text-sm font-medium">Entry Time</label>
                            <Input
                                type="datetime-local"
                                value={shiftEditData.entry_time}
                                    onChange={(e) => setShiftEditData({ ...shiftEditData, entry_time: e.target.value })}
                            />
                        </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Exit Time (Optional)</label>
                            <Input
                                type="datetime-local"
                                value={shiftEditData.leave_time}
                                    onChange={(e) => setShiftEditData({ ...shiftEditData, leave_time: e.target.value })}
                            />
                            </div>
                        </div>

                        {/* Breaks Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">Breaks</label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const currentBreaks = shiftEditData.breaks || [];
                                                if (currentBreaks.length > 0) {
                                                    const lastBreak = currentBreaks[currentBreaks.length - 1];
                                                    if (!lastBreak.lunch_start || !lastBreak.lunch_end) {
                                                        toast.error('Please fill start and end time for the last break before adding a new one');
                                                        return;
                                                    }
                                                }
                                                const newBreaks = [...currentBreaks, { lunch_start: '', lunch_end: '' }];
                                                setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                            }}
                                            className="text-xs"
                                        >
                                            + Add Break
                                        </Button>
                            </div>
                            {shiftEditData.breaks.map((breakItem, index) => (
                                <div key={index} className="border border-slate-200 rounded-lg p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium">Break {index + 1}</h4>
                                                {shiftEditData.breaks.length > 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            const newBreaks = shiftEditData.breaks.filter((_, i) => i !== index);
                                                            setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                                        }}
                                                        className="text-red-600 hover:text-red-700 h-11 w-11 p-0"
                                                    >
                                                        ×
                                                    </Button>
                                                )}
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-600">Break Start Time</label>
                                            <Input
                                                type="datetime-local"
                                                value={breakItem.lunch_start}
                                                onChange={(e) => {
                                                    const newBreaks = [...shiftEditData.breaks];
                                                    newBreaks[index].lunch_start = e.target.value;
                                                    setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                                }}
                                                className="text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-600">Break End Time</label>
                                            <Input
                                                type="datetime-local"
                                                value={breakItem.lunch_end}
                                                onChange={(e) => {
                                                    const newBreaks = [...shiftEditData.breaks];
                                                    newBreaks[index].lunch_end = e.target.value;
                                                    setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                                }}
                                                className="text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <div className="text-right text-xs text-slate-600">
                                Total Break Hours:{' '}
                                {(
                                    (shiftEditData.breaks || []).reduce((sum, b) => {
                                        try {
                                            if (!b.lunch_start || !b.lunch_end) return sum;
                                            
                                            // Parse datetime-local format (YYYY-MM-DDTHH:mm)
                                            const startDate = new Date(fromDateTimeLocalUtc(b.lunch_start));
                                            const endDate = new Date(fromDateTimeLocalUtc(b.lunch_end));
                                            
                                            // Validate dates
                                            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                                console.warn('Invalid break times:', { start: b.lunch_start, end: b.lunch_end });
                                                return sum;
                                            }
                                            
                                            const diffMs = endDate - startDate;
                                            if (!Number.isFinite(diffMs) || diffMs <= 0) return sum;
                                            return sum + diffMs / (1000 * 60 * 60);
                                        } catch (err) {
                                            console.error('Error calculating break hours:', err);
                                            return sum;
                                        }
                                    }, 0)
                                ).toFixed(2)}h
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Leave Type (Optional)</label>
                            <Select
                                value={shiftEditData.leave_type}
                                onValueChange={(value) => setShiftEditData({ ...shiftEditData, leave_type: value })}
                            >
                                <SelectTrigger>
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
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => {
                            setShowEditShiftDialog(false);
                            setEditSaveAndApprove(false);
                        }}>
                            Cancel
                        </Button>
                        {editingShift && shiftNeedsApprovalActions(editingShift) ? (
                            <Button
                                className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto"
                                onClick={() => {
                                    setEditSaveAndApprove(true);
                                    handleUpdateShift(true);
                                }}
                            >
                                Save and approve shift
                            </Button>
                        ) : null}
                        <Button onClick={() => {
                            setEditSaveAndApprove(false);
                            handleUpdateShift(false);
                        }}>
                            Update Shift
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Tutorial: top-bar / native nav only — no phone FAB (it covered hub Site/Account). */}

        </div>
    );
}
