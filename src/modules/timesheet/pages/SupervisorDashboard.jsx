import { supabaseTimesheet as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    ArrowLeft, Download, Search, Clock, Edit2, ChevronDown, ChevronUp,
    Calendar, FileSpreadsheet, Loader2, Trash2, Printer,
    CheckCircle, XCircle, AlertCircle, MapPin, Coffee, DollarSign, Receipt
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { cn, fromDateTimeLocalUtc, toDateTimeLocalUtc } from '@/modules/timesheet/lib/utils';
import { useLanguage } from '@/core-i18n';
import TopBar from '@/ui/hub/TopBar';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { format } from "date-fns";
import { toast } from "sonner";
import {
    applyApprovalOnShiftSave,
    approveShiftRecord,
    declineShiftRecord,
    getShiftApproverName,
    getShiftEditorName,
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
import { sendBrowserNotification } from '@/modules/timesheet/lib/emailNotification';
import { formatTime, formatDate, isSunday, isPublicHoliday, calculateShiftHours, getWorkDateFromDateTime, getTodaySingapore, addDaysToYmd } from '@/modules/timesheet/lib/timeUtils';
import { PortalBackdrop, glassPanel, ModuleSectionHead } from '@/ui/PortalShell';
import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

// Production logging system
const DEBUG_MODE = process.env.NODE_ENV === 'development';
const log = {
    info: (message, ...args) => DEBUG_MODE && console.log(message, ...args),
    error: (message, ...args) => console.error(message, ...args), // Always log errors
    warn: (message, ...args) => DEBUG_MODE && console.warn(message, ...args),
    debug: (message, ...args) => DEBUG_MODE && console.debug(message, ...args)
};

export default function SupervisorDashboard() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [workerIdFilter, setWorkerIdFilter] = useState('');
    const [expandedCards, setExpandedCards] = useState(new Set());
    const [statusFilter, setStatusFilter] = useState('all');
    const [showEditShiftDialog, setShowEditShiftDialog] = useState(false);
    const [editingShift, setEditingShift] = useState(null);
    const [approvingShiftId, setApprovingShiftId] = useState(null);
    const [editSaveAndApprove, setEditSaveAndApprove] = useState(false);
    const shiftPollHeadTsRef = useRef(null);
    const [shiftEditData, setShiftEditData] = useState({
        entry_time: '',
        leave_time: '',
        breaks: [{ lunch_start: '', lunch_end: '' }],
        leave_type: '__none__'
    });

    const queryClient = useQueryClient();

    // Get supervisor data from session-bound identity (SEC-11)
    const [supervisorSiteId, setSupervisorSiteId] = useState(() => localStorage.getItem(storageKey('timesheet', 'supervisorSiteId')) || '');
    const [supervisorName, setSupervisorName] = useState(() => localStorage.getItem(storageKey('timesheet', 'supervisorName')) || '');

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'supervisor') {
                if (session.session_data?.supervisorSiteId) {
                    setSupervisorSiteId(session.session_data.supervisorSiteId);
                }
                if (session.session_data?.supervisorName) {
                    setSupervisorName(session.session_data.supervisorName);
                }
            }
        });
    }, []);

    // Debounce search term for better performance
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Fetch shifts data - only for supervisor's site
    const { data: shifts = [], isLoading, isError: isShiftsError, error: shiftsError, isRefetching: isRefetchingShifts, refetch } = useQuery({
        queryKey: ['supervisor-shifts', supervisorSiteId],
        queryFn: async () => {
            log.info('Supervisor Dashboard: Fetching shifts data for site:', supervisorSiteId);
            
            // Calculate date limit for past 35 days (no future dates)
            const todayDateStr = getTodaySingapore();
            const dateLimit = addDaysToYmd(todayDateStr, -35);

            // Fetch total count first to ensure we get all shifts (past 35 days only, no future dates)
            const { count: totalCount, error: countError } = await supabase
                .from('shifts')
                .select('*', { count: 'exact', head: true })
                .eq('site_id', supervisorSiteId)
                .is('leave_type', null)
                .gte('work_date', dateLimit)
                .lte('work_date', todayDateStr);

            if (countError) {
                console.error('❌ Error fetching shift count:', countError);
                throw countError;
            }

            log.info(`Total shifts in database for this site (past 35 days): ${totalCount}`);

            // Fetch all local worker IDs to exclude them from supervisor dashboard
            const { data: localWorkers } = await supabase
                .from('local_worker_details')
                .select('employee_id');
            
            const localWorkerIds = localWorkers?.map(w => w.employee_id) || [];
            log.info(`Excluding ${localWorkerIds.length} local workers from supervisor dashboard`);

            // Fetch all shifts in batches to overcome Supabase's 1000 row default limit
            const allShifts = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;
            let batchCount = 0;
            
            while (hasMore) {
                batchCount++;
                log.debug(`Supervisor: Fetching batch ${batchCount}: offset ${offset}, batchSize ${batchSize}`);
                
                const { data, error } = await supabase
                    .from('shifts')
                    .select('*')
                    .eq('site_id', supervisorSiteId) // Only fetch shifts for supervisor's site
                    .is('leave_type', null) // Exclude leave shifts from time tracker
                    .gte('work_date', dateLimit) // Only past 35 days
                    .lte('work_date', todayDateStr) // No future dates
                    .order('work_date', { ascending: false })
                    .order('entry_time', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(offset, offset + batchSize - 1);

                if (error) {
                    console.error('❌ Supervisor Dashboard: Error fetching shifts:', error);
                    throw error;
                }

                log.debug(`Batch ${batchCount} returned ${data?.length || 0} records`);

                if (!data || data.length === 0) {
                    log.debug(`Batch ${batchCount} returned 0 records, stopping pagination`);
                    hasMore = false;
                } else {
                    // Filter out local workers
                    const filteredData = localWorkerIds.length > 0 
                        ? data.filter(shift => !localWorkerIds.includes(shift.worker_id))
                        : data;
                    
                    allShifts.push(...filteredData);
                    log.debug(`Total shifts collected so far: ${allShifts.length} (after filtering local workers)`);
                    
                    if (data.length < batchSize) {
                        log.debug(`Batch ${batchCount} returned fewer than ${batchSize} records, this is the last batch`);
                        hasMore = false;
                    }
                    offset += batchSize;
                }
            }

            log.info(`Supervisor Dashboard: Fetched all shifts: ${allShifts?.length || 0} shifts (Expected: ${totalCount})`);
            log.debug('Supervisor Dashboard: Raw shifts data:', allShifts);

            // Fetch related data
            if (allShifts && allShifts.length > 0) {
                const workerIds = [...new Set(allShifts.map(shift => shift.worker_id))];
                const siteIds = [...new Set(allShifts.map(shift => shift.site_id))];

                // Fetch workers from both tables
                const [localWorkersResult, foreignWorkersResult, sitesResult] = await Promise.all([
                    supabase
                        .from('local_worker_details')
                        .select('employee_id, employee_name')
                        .in('employee_id', workerIds),
                    supabase
                        .from('worker_details')
                        .select('employee_id, employee_name')
                        .in('employee_id', workerIds),
                    supabase
                        .from('sites')
                        .select('id, site_name')
                        .in('id', siteIds)
                ]);

                // Combine workers from both tables
                const workers = [
                    ...(localWorkersResult.data || []),
                    ...(foreignWorkersResult.data || [])
                ];

                const sites = sitesResult.data || [];

                // Fetch breaks for all shifts
                const allBreaks = [];
                const fetchBatchSize = 100; // Process 100 shift IDs at a time

                for (let i = 0; i < allShifts.length; i += fetchBatchSize) {
                    const batch = allShifts.slice(i, i + fetchBatchSize).map(shift => shift.id);
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
        refetchInterval: false, // Disabled - using smart polling instead
        enabled: !!supervisorSiteId
    });

    // Smart polling: newest shifts.created_at for this site; refetch when it changes
    useEffect(() => {
        if (!supervisorSiteId) return;

        shiftPollHeadTsRef.current = null;

        const smartHeartbeat = setInterval(async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const { data: latestShiftData, error } = await supabase
                    .from('shifts')
                    .select('created_at')
                    .eq('site_id', supervisorSiteId)
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
                    log.debug('Shift head timestamp changed — refetching shifts');
                    refetch();
                }
            } catch (error) {
                console.error('Smart heartbeat failed:', error);
            }
        }, 5000);

        return () => clearInterval(smartHeartbeat);
    }, [supervisorSiteId, refetch]);

    // Note: Removed 1-second heartbeat for performance. Smart polling handles data updates.
    /*
    // Add 1-second heartbeat to refresh page
    useEffect(() => {
        const interval = setInterval(() => {
            refetch().catch(error => {
                if (error) {
                    console.error('❌ Supervisor Dashboard: Refetch error in heartbeat:', error);
                } else {
                }
            });
        }, 1000); // Refresh every 1 second

        return () => clearInterval(interval);
    }, [refetch]);
    */


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
            leave_time: shift.leave_time ? toDateTimeLocalUtc(shift.leave_time) : '',
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
            await approveShiftRecord(supabase, shift.id, getShiftApproverName('supervisor'));
            toast.success('Shift approved');
            queryClient.invalidateQueries({ queryKey: ['supervisor-shifts'] });
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
            queryClient.invalidateQueries({ queryKey: ['supervisor-shifts'] });
        } catch (e) {
            toast.error(e?.message || 'Failed to decline shift');
        } finally {
            setApprovingShiftId(null);
        }
    };

    // Filter shifts - optimized with useMemo
    const filteredShifts = useMemo(() => {
        return shifts.filter(shift => {
            const matchesSearch = !debouncedSearchTerm ||
                shift.workers?.employee_name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                shift.worker_id?.toString().includes(debouncedSearchTerm.toLowerCase());

            const matchesFilter = filter === 'all' ||
                (filter === 'completed' && shift.has_left) ||
                (filter === 'in_progress' && !shift.has_left) ||
                (filter === 'unapproved' && matchesUnapprovedFilter(shift));

            const matchesStatus = statusFilter === 'all' ||
                (statusFilter === 'completed' && shift.has_left) ||
                (statusFilter === 'in_progress' && !shift.has_left) ||
                (statusFilter === 'unapproved' && matchesUnapprovedFilter(shift));

            const matchesWorkerId = !workerIdFilter || shift.worker_id?.toString().includes(workerIdFilter);

            // Date filtering
            const shiftDate = new Date(shift.work_date);
            const now = new Date();
            let matchesDate = true;

            if (dateFilter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                matchesDate = shiftDate >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                matchesDate = shiftDate >= monthAgo;
            } else if (dateFilter === 'year') {
                const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                matchesDate = shiftDate >= yearAgo;
            }

            return matchesSearch && matchesFilter && matchesStatus && matchesWorkerId && matchesDate;
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
    }, [shifts, debouncedSearchTerm, filter, statusFilter, workerIdFilter, dateFilter]);

    // Update shift mutation
    const updateShiftMutation = useMutation({
        mutationFn: async ({ shiftId, updateData }) => {
            log.debug('Supervisor Dashboard: Updating shift:', shiftId, 'with data:', updateData);
            let { data, error } = await supabase
                .from('shifts')
                .update(updateData)
                .eq('id', shiftId)
                .select()
                .single();

            // If error is due to missing edited_by column, retry without it
            if (error && error.message?.includes('edited_by')) {
                console.warn('edited_by column not found, retrying without it');
                const { edited_by, ...updateWithoutEditedBy } = updateData;
                const retryResult = await supabase
                    .from('shifts')
                    .update(updateWithoutEditedBy)
                    .eq('id', shiftId)
                    .select()
                    .single();
                error = retryResult.error;
                data = retryResult.data;
            }

            if (error) throw error;
            log.debug('Supervisor Dashboard: Shift updated successfully:', data);
            return data;
        },
        onSuccess: async (data, variables) => {
            log.debug('Supervisor Dashboard: Shift update success callback triggered');
            toast.success(editSaveAndApprove ? 'Shift saved and approved' : 'Shift updated successfully!');
            setShowEditShiftDialog(false);
            setEditingShift(null);
            setEditSaveAndApprove(false);
            
            // Invalidate supervisor shifts
            queryClient.invalidateQueries(['supervisor-shifts']);
            // Invalidate all shift-related queries
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
            console.error('❌ Supervisor Dashboard: Error updating shift:', error);
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
        XLSX.writeFile(wb, `supervisor_shifts_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
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

    const handleUpdateShift = async (approveAfterSaveOverride = null) => {
        if (!editingShift) return;

        // Convert times using the proper timezone-aware function
        const entryTimeIso = fromDateTimeLocalUtc(shiftEditData.entry_time);
        const leaveTimeIso = shiftEditData.leave_time ? fromDateTimeLocalUtc(shiftEditData.leave_time) : null;

        if (!entryTimeIso) {
            toast.error('Entry time is required');
            return;
        }

        // Automatically derive work_date from entry_time in Singapore timezone
        const workDateFromEntry = getWorkDateFromDateTime(entryTimeIso);
        const workDate = workDateFromEntry || editingShift.work_date;

        const rawBreaks = shiftEditData.breaks || [];

        for (let i = 0; i < rawBreaks.length; i++) {
            const b = rawBreaks[i];
            
            // Skip empty breaks
            if (!b.lunch_start || !b.lunch_end) {
                continue;
            }
            
            // For breaks, convert to ISO datetime (NOT just date)
            // Input format: "2026-01-19T12:00" - use this directly as ISO
            const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
            const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;

            if (!startIso || !endIso) {
                toast.error(`Break ${i + 1} has invalid start or end time`);
                console.error(`Break ${i + 1} conversion failed:`, { lunch_start: b.lunch_start, lunch_end: b.lunch_end, startIso, endIso });
                return;
            }

            const startDate = new Date(startIso);
            const endDate = new Date(endIso);
            
            log.debug(`Break ${i + 1} validation:`, {
                lunch_start: b.lunch_start,
                lunch_end: b.lunch_end,
                startIso,
                endIso,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                isValid: endDate > startDate
            });

            if (endDate <= startDate) {
                toast.error(`Break ${i + 1} end time must be after start time`);
                console.error(`Break ${i + 1} failed validation:`, { startIso, endIso, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
                return;
            }
        }

        const normalizedBreaks = rawBreaks
            .map((b) => {
                // For datetime-local inputs, convert directly to ISO
                const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
                const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;
                return {
                    break_start: startIso,
                    break_end: endIso,
                    shift_id: editingShift.id
                };
            })
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

        const shiftUpdateData = applyApprovalOnShiftSave({
            shiftUpdateData: { ...updateData, edited_by: getShiftEditorName('supervisor') },
            editingShift,
            isCompleted: !!leaveTimeIso,
            approveAfterSave: approveAfterSaveOverride ?? editSaveAndApprove,
            actorName: getShiftApproverName('supervisor'),
            role: 'supervisor',
        });

        updateShiftMutation.mutate({
            shiftId: editingShift.id,
            updateData: shiftUpdateData,
        });
    };

    if (!supervisorSiteId) {
        return (
            <div className="relative app-shell flex min-h-dvh-safe items-center justify-center bg-[var(--g-bg,#f3f4f6)]">
                {NATIVE_APP ? null : <PortalBackdrop />}
                <Card className={cn(glassPanel, 'relative z-10 p-8 text-center')}>
                    <h2 className="mb-4 text-xl font-semibold text-[var(--g-danger)]">Access Denied</h2>
                    <p className="text-[var(--g-muted)]">Supervisor site information not found. Please login again.</p>
                    <Button onClick={() => navigate("/login")} className="mt-4 rounded-xl bg-[var(--g-brand)] text-white hover:bg-[var(--g-brand-press)]">
                        Go to Login
                    </Button>
                </Card>
            </div>
        );
    }

    const unapprovedCount = shifts.filter((s) => matchesUnapprovedFilter(s)).length;
    const inProgressCount = shifts.filter((s) => !s.has_left).length;
    const siteLabel = shifts.find((s) => s.sites?.site_name)?.sites?.site_name;

    return (
        <div className={cn('manager-dash-ui relative isolate min-h-dvh-safe', NATIVE_APP ? 'akk-screen bg-[var(--g-bg)]' : 'bg-[var(--g-bg,#f3f4f6)]')}>
            {NATIVE_APP ? null : <PortalBackdrop />}
            <TopBar
                eyebrow={`${t('role.supervisor')}${siteLabel ? ` · ${siteLabel}` : ''}`}
                title={supervisorName || 'Supervisor'}
            />

            <main className="relative z-10 mx-auto max-w-7xl px-safe py-5 pb-[calc(var(--g-tabbar-space,5.5rem)+1rem)]">
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
                        <Button
                            onClick={exportToExcel}
                            className="h-10 rounded-xl bg-[var(--g-brand)] text-white hover:bg-[var(--g-brand-press)]"
                        >
                            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                            {t('ui.exportExcel')}
                        </Button>
                        }
                    />

                    <div className="mb-4 space-y-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                placeholder={t('ui.searchNameId')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="h-11 w-full rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-sm"
                            />
                        </div>
                        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                            <Tabs value={filter} onValueChange={setFilter} className="w-full lg:w-auto">
                                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1 sm:grid-cols-4 sm:inline-flex sm:w-auto">
                                    <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.all')}</TabsTrigger>
                                    <TabsTrigger value="unapproved" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">
                                        {t('ui.unapproved')}{unapprovedCount ? ` (${unapprovedCount})` : ''}
                                    </TabsTrigger>
                                    <TabsTrigger value="completed" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.done')}</TabsTrigger>
                                    <TabsTrigger value="in_progress" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.active')}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <Tabs value={dateFilter} onValueChange={setDateFilter} className="w-full lg:w-auto">
                                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1 sm:grid-cols-4 sm:inline-flex sm:w-auto">
                                    <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.all')}</TabsTrigger>
                                    <TabsTrigger value="week" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.week')}</TabsTrigger>
                                    <TabsTrigger value="month" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.month')}</TabsTrigger>
                                    <TabsTrigger value="year" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.year')}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <input
                                placeholder={t('ui.filterWorkerId')}
                                value={workerIdFilter}
                                onChange={(e) => setWorkerIdFilter(e.target.value)}
                                className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white/80 px-3 text-sm sm:max-w-xs"
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
                            message="Shifts will appear here when workers at your site clock in/out"
                        />
                    ) : (
                        <div className="space-y-2">
                            {filteredShifts.map((shift) => {
                                            const isSundayShift = isSunday(shift.work_date);
                                            const isHolidayShift = isPublicHoliday(shift.work_date);

                                            return (
                                                <div
                                                    key={shift.id}
                                                    className={cn(
                                                        'akk-list-card overflow-hidden rounded-2xl border bg-white/90',
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
                                                                        >
                                                                            <Edit2 className="mr-1 h-4 w-4" />
                                                                            Edit
                                                                        </Button>
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-2">
                                                                            <Badge variant="outline"
                                                                                className={shift.has_left ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-800'}
                                                                            >
                                                                                {shift.has_left ? 'Completed' : 'In Progress'}
                                                                            </Badge>
                                                                            <ShiftApprovalStatusBadge shift={shift} />
                                                                            {isSundayShift && (
                                                                                <Badge variant="destructive">Sunday</Badge>
                                                                            )}
                                                                            {isHolidayShift && (
                                                                                <Badge variant="destructive">Holiday</Badge>
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
                                                                                    Entry: {formatTime(shift.entry_time)}
                                                                                </span>
                                                                            )}
                                                                            {shift.breaks && shift.breaks.length > 0 && (
                                                                                <div className="space-y-1">
                                                                                    {shift.breaks.map((breakItem, breakIndex) => (
                                                                                        <div key={breakIndex} className="text-xs text-slate-600">
                                                                                            Break {breakIndex + 1}: {breakItem.break_start ? formatTime(breakItem.break_start) : 'Not set'} - {breakItem.break_end ? formatTime(breakItem.break_end) : 'Not set'}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                            {shift.leave_time && (
                                                                                <span className="text-slate-600">
                                                                                    Exit: {formatTime(shift.leave_time)}
                                                                                </span>
                                                                            )}
                                                                            <ShiftApprovalMeta shift={shift} />
                                                                        </div>
                                                                        {shift.has_left && (() => {
                                                                            const recalc = calculateShiftHours(
                                                                                shift.entry_time,
                                                                                shift.leave_time,
                                                                                shift.breaks || [],
                                                                                shift.work_date
                                                                            );
                                                                            const breakHours = recalc.breakHours || shift.break_hours || 0;

                                                                            return (
                                                                                <div className="flex items-center gap-4 text-sm">
                                                                                    <span className="text-green-600 font-medium">
                                                                                        Basic: {(shift.worked_hours || 0).toFixed(2)}h
                                                                                    </span>
                                                                                    <span className="text-slate-600 font-medium">
                                                                                        Break: {breakHours.toFixed(2)}h
                                                                                    </span>
                                                                                    {(shift.sunday_hours || 0) > 0 && (
                                                                                        <span className="text-slate-800 font-medium">
                                                                                            Sun/PH: {(shift.sunday_hours || 0).toFixed(2)}h
                                                                                        </span>
                                                                                    )}
                                                                                    {(shift.ot_hours || 0) > 0 && (
                                                                                        <span className="text-slate-800 font-medium">
                                                                                            OT: {(shift.ot_hours || 0).toFixed(2)}h
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
                                                                            </div>
                                                                        </div>
                                                                        {shift.has_left && (() => {
                                                                            const recalc = calculateShiftHours(
                                                                                shift.entry_time,
                                                                                shift.leave_time,
                                                                                shift.breaks || [],
                                                                                shift.work_date
                                                                            );
                                                                            const breakHours = recalc.breakHours || shift.break_hours || 0;

                                                                            return (
                                                                                <div>
                                                                                    <h4 className="font-medium text-slate-700 mb-2">Hours Breakdown</h4>
                                                                                    <div className="space-y-1">
                                                                                        <p>Basic Hours: {(shift.worked_hours || 0).toFixed(2)}</p>
                                                                                        <p>Sun/PH Hours: {(shift.sunday_hours || 0).toFixed(2)}</p>
                                                                                        <p>OT Hours: {(shift.ot_hours || 0).toFixed(2)}</p>
                                                                                        <p>Break Hours: {breakHours.toFixed(2)}</p>
                                                                                        <p>Total Hours: {((shift.worked_hours || 0) + (shift.sunday_hours || 0) + (shift.ot_hours || 0)).toFixed(2)}</p>
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
                        </div>
                    )}
                </section>
            </main>

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
                                <input
                                    type="datetime-local"
                                    value={shiftEditData.entry_time}
                                    onChange={(e) => setShiftEditData({ ...shiftEditData, entry_time: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Exit Time (Optional)</label>
                                <input
                                    type="datetime-local"
                                    value={shiftEditData.leave_time}
                                    onChange={(e) => setShiftEditData({ ...shiftEditData, leave_time: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
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
                                            <input
                                                type="datetime-local"
                                                value={breakItem.lunch_start}
                                                onChange={(e) => {
                                                    const newBreaks = [...shiftEditData.breaks];
                                                    newBreaks[index].lunch_start = e.target.value;
                                                    setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                                }}
                                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-600">Break End Time</label>
                                            <input
                                                type="datetime-local"
                                                value={breakItem.lunch_end}
                                                onChange={(e) => {
                                                    const newBreaks = [...shiftEditData.breaks];
                                                    newBreaks[index].lunch_end = e.target.value;
                                                    setShiftEditData({ ...shiftEditData, breaks: newBreaks });
                                                }}
                                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <div className="text-right text-xs text-slate-600">
                                Total Break Hours:{' '}
                                {(
                                    (shiftEditData.breaks || []).reduce((sum, b) => {
                                        const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
                                        const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;
                                        if (!startIso || !endIso) return sum;
                                        const diffMs = new Date(endIso) - new Date(startIso);
                                        if (!Number.isFinite(diffMs) || diffMs <= 0) return sum;
                                        return sum + diffMs / (1000 * 60 * 60);
                                    }, 0)
                                ).toFixed(2)}h
                            </div>
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
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={updateShiftMutation.isLoading}
                                onClick={() => {
                                    setEditSaveAndApprove(true);
                                    handleUpdateShift(true);
                                }}
                            >
                                {updateShiftMutation.isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Save and approve shift
                            </Button>
                        ) : null}
                        <Button
                            disabled={updateShiftMutation.isLoading}
                            onClick={() => {
                                setEditSaveAndApprove(false);
                                handleUpdateShift(false);
                            }}
                        >
                            {updateShiftMutation.isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Update Shift
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
