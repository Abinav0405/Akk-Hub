// TODO(claude): ensure @/ui/native/* chrome/states/confirm exist (or remount Timesheet native chrome)
// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useState } from 'react';
import { storageKey } from '@/core/storage';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import {
    Calendar,
    CheckCircle, XCircle, AlertCircle, Printer, Undo2, Loader2
} from "lucide-react";
import { cn } from '@/modules/timesheet/lib/utils';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { formatDate, countLeaveDaysForDisplay } from '@/modules/timesheet/lib/timeUtils';
import { format } from "date-fns";
import {
    canWorkerWithdrawLeave,
    fetchLeavePolicy,
    getLeaveStatusLabel,
    resolveWorkerWithTable,
    withdrawLeaveRequest,
} from '@/modules/timesheet/lib/leaveService';
import { printLeaveForms } from '@/modules/timesheet/lib/leaveFormPrint';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { toast } from "sonner";
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton, NativeSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

export default function LeaveHistory() {
    const queryClient = useQueryClient();
    const [workerId, setWorkerId] = React.useState(() => localStorage.getItem(storageKey('timesheet', 'workerId')) || '');
    const [workerName, setWorkerName] = React.useState(() => localStorage.getItem(storageKey('timesheet', 'workerName')) || '');
    const [printingId, setPrintingId] = useState(null);

    React.useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker') {
                if (session.subject_id) setWorkerId(session.subject_id);
                if (session.session_data?.workerName) setWorkerName(session.session_data.workerName);
            }
        });
    }, []);

    // Fetch worker's leave history
    const {
        data: leaveHistory = [],
        isLoading: isLoadingLeaveHistory,
        isError: isLeaveHistoryError,
        error: leaveHistoryError,
        refetch: refetchLeaveHistory,
        isRefetching: isRefetchingLeaveHistory,
    } = useQuery({
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

    const { data: leavePolicy } = useQuery({
        queryKey: ['leavePolicy'],
        queryFn: () => fetchLeavePolicy(supabase),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch worker's leave balances
    const { data: workerData, isLoading: isLoadingWorkerData } = useQuery({
        queryKey: ['workerData', workerId],
        queryFn: async () => {
            if (!workerId) return null;

            const { worker } = await resolveWorkerWithTable(
                supabase,
                workerId,
                'annual_leave_balance, medical_leave_balance, hospitalization_leave_balance, annual_leave_limit, medical_leave_limit, hospitalization_leave_limit'
            );

            return worker || {
                annual_leave_balance: 0,
                medical_leave_balance: 0,
                hospitalization_leave_balance: 0,
                annual_leave_limit: 10,
                medical_leave_limit: 14,
                hospitalization_leave_limit: 60,
            };
        },
        enabled: !!workerId
    });

    const withdrawMutation = useMutation({
        mutationFn: async (request) => {
            await withdrawLeaveRequest(supabase, request, { cancelledBy: 'worker' });
        },
        onSuccess: () => {
            toast.success('Leave request withdrawn');
            queryClient.invalidateQueries(['workerLeaveHistory', workerId]);
            queryClient.invalidateQueries(['workerData', workerId]);
            queryClient.invalidateQueries(['workerBalance', workerId]);
        },
        onError: (error) => {
            toast.error(error.message || 'Failed to withdraw leave');
        },
    });

    const annualBalance = Number(workerData?.annual_leave_balance ?? 0);
    const medicalBalance = Number(workerData?.medical_leave_balance ?? 0);
    const hospitalizationBalance = Number(workerData?.hospitalization_leave_balance ?? 0);
    const annualLimit = Number(workerData?.annual_leave_limit ?? 10);
    const medicalLimit = Number(workerData?.medical_leave_limit ?? 14);
    const hospitalizationLimit = Number(workerData?.hospitalization_leave_limit ?? 60);

    const getLeaveTypeDisplay = (leaveType) => {
        const paidLeaves = [
            'Annual Leave', 'Maternity Leave', 'Paternity Leave', 'Shared Parental Leave',
            'Childcare Leave', 'Medical Leave', 'Hospitalization Leave', 'National Service (NS) Leave',
            'Adoption Leave', 'Non-Statutory Leave (Employer Provided)', 'Compassionate / Bereavement Leave',
            'Marriage Leave', 'Study / Exam Leave', 'Birthday Leave', 'Mental Health Day',
            'Volunteer Leave'
        ];

        return paidLeaves.includes(leaveType) ? 'Paid' : 'Unpaid';
    };

    const getDurationDisplay = (duration) => {
        if (duration === 'full_day') return 'Full Day';
        if (duration === 'half_day_morning') return 'Half Day (Morning)';
        if (duration === 'half_day_afternoon') return 'Half Day (Afternoon)';
        return 'Full Day';
    };

    const getStatusBadgeClass = (status) => {
        if (status === 'approved') return 'bg-green-100 text-green-800';
        if (status === 'rejected') return 'bg-red-100 text-red-800';
        if (status === 'cancelled') return 'bg-slate-200 text-slate-700';
        if (status === 'pending_admin') return 'bg-orange-100 text-orange-800';
        return 'bg-yellow-100 text-yellow-800';
    };

    const getDaysDisplay = (request) => {
        const days = countLeaveDaysForDisplay({
            from_date: request.from_date,
            to_date: request.to_date,
            leave_type: request.leave_type,
            leave_duration: request.leave_duration,
            days_requested: request.days_requested,
        });
        const label = days === 1 ? 'day' : 'days';
        return `${days} ${label}`;
    };

    const handleWithdraw = async (request) => {
        const gate = canWorkerWithdrawLeave(request, leavePolicy);
        if (!gate.ok) {
            toast.error(gate.reason || 'Cannot withdraw this request');
            return;
        }
        const label = request.status === 'approved' ? 'approved leave' : 'leave request';
        const confirmed = await confirmAction({
            title: `Withdraw ${label}?`,
            message: `Withdraw this ${label}? This cannot be undone.`,
            detail: 'This cannot be undone.',
            confirmLabel: 'Withdraw',
            destructive: true,
        });
        if (!confirmed) return;
        withdrawMutation.mutate(request);
    };

    const balanceValue = (value) =>
        isLoadingWorkerData ? (NATIVE_APP ? <NativeSkeleton className="ml-auto h-7 w-10" /> : '...') : value;

    const handlePrint = async (request) => {
        setPrintingId(request.id);
        try {
            await printLeaveForms({
                requests: [request],
                logoUrl: '/Akk-logo.jpg',
                rangeLabel: `${request.from_date}_${request.to_date}`,
            });
            toast.success('Print dialog opened');
        } catch (error) {
            toast.error(error.message || 'Failed to print leave form');
        } finally {
            setPrintingId(null);
        }
    };

    return (
        <WorkerPageShell
            title="Leave history"
            subtitle={`${workerName || 'Worker'} · ID ${workerId || '—'}`}
        >
            {NATIVE_APP ? (
                <div className="akk-stats mb-2" role="group" aria-label="Leave balances">
                    {[
                        { label: 'Annual (AL)', value: annualBalance, limit: annualLimit, tone: 'success' },
                        { label: 'Medical (MC)', value: medicalBalance, limit: medicalLimit, tone: 'info' },
                        { label: 'Hospital', value: hospitalizationBalance, limit: hospitalizationLimit, tone: 'teal' },
                    ].map((item) => (
                        <div key={item.label} className="akk-stat" data-tone={item.tone}>
                            <p className="akk-stat__value">{balanceValue(item.value)}</p>
                            <p className="akk-stat__label">{item.label}</p>
                            <p className="akk-stat__hint">
                                {isLoadingWorkerData ? 'days left' : `days left of ${item.limit}`}
                            </p>
                        </div>
                    ))}
                </div>
            ) : (
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className={cn(glassPanel, 'px-4 py-4')}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-emerald-800">Annual Leave (AL)</h3>
                                    <p className="mt-0.5 text-xs text-emerald-600">Available balance</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-semibold tracking-tight text-emerald-800">
                                        {balanceValue(annualBalance)}
                                    </div>
                                    <p className="text-[11px] text-emerald-600">days remaining</p>
                                </div>
                            </div>
                            <div className="mt-3 text-xs text-emerald-700">
                                {annualBalance} of {annualLimit} limit
                            </div>
                    </div>

                    <div className={cn(glassPanel, 'px-4 py-4')}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-sky-800">Medical Leave (MC)</h3>
                                    <p className="mt-0.5 text-xs text-sky-600">Available balance</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-semibold tracking-tight text-sky-800">
                                        {balanceValue(medicalBalance)}
                                    </div>
                                    <p className="text-[11px] text-sky-600">days remaining</p>
                                </div>
                            </div>
                            <div className="mt-3 text-xs text-sky-700">
                                {medicalBalance} of {medicalLimit} limit
                            </div>
                    </div>

                    <div className={cn(glassPanel, 'px-4 py-4')}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-teal-800">Hospitalization</h3>
                                    <p className="mt-0.5 text-xs text-teal-600">Available balance</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-semibold tracking-tight text-teal-800">
                                        {balanceValue(hospitalizationBalance)}
                                    </div>
                                    <p className="text-[11px] text-teal-600">days remaining</p>
                                </div>
                            </div>
                            <div className="mt-3 text-xs text-teal-700">
                                {hospitalizationBalance} of {hospitalizationLimit} limit
                            </div>
                    </div>
            </div>
            )}

            <section className={cn(glassPanel, 'p-4 sm:p-5', NATIVE_APP && 'akk-flat')}>
                    <h2 className={cn('mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900', NATIVE_APP && 'akk-section-title')}>
                            <Calendar className="h-5 w-5 text-[#dc6b2f]" />
                            Leave requests
                    </h2>
                        {NATIVE_APP && isLoadingLeaveHistory ? (
                            <NativeListSkeleton rows={3} label="Loading leave history" />
                        ) : NATIVE_APP && isLeaveHistoryError && !leaveHistory.length ? (
                            <NativeErrorState
                                error={leaveHistoryError}
                                onRetry={() => refetchLeaveHistory()}
                                retrying={isRefetchingLeaveHistory}
                            />
                        ) : NATIVE_APP && leaveHistory.length === 0 ? (
                            <NativeEmptyState
                                icon={Calendar}
                                title="No leave history"
                                message="You haven't submitted any leave requests yet."
                            />
                        ) : isLoadingLeaveHistory ? (
                            <div className="flex items-center justify-center py-10">
                                <div className="w-8 h-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600"></div>
                            </div>
                        ) : leaveHistory.length === 0 ? (
                            <div className="text-center py-10">
                                <Calendar className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                                <h4 className="text-lg font-medium text-slate-700 mb-2">No Leave History</h4>
                                <p className="text-slate-500">You haven't submitted any leave requests yet</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {leaveHistory.map((request) => {
                                    const withdrawGate = canWorkerWithdrawLeave(request, leavePolicy);
                                    const isWithdrawing =
                                        withdrawMutation.isPending &&
                                        withdrawMutation.variables?.id === request.id;
                                    const isPrinting = printingId === request.id;

                                    return (
                                        <Card key={request.id} className="akk-list-card rounded-2xl border border-slate-200/80 bg-white/90">
                                            <CardContent className="p-4">
                                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="flex items-center gap-3 flex-wrap">
                                                        <Badge
                                                            variant={request.status === 'approved' ? 'default' : request.status === 'rejected' ? 'destructive' : 'secondary'}
                                                            className={getStatusBadgeClass(request.status)}
                                                        >
                                                            {request.status === 'approved' && <CheckCircle className="w-3 h-3 mr-1" />}
                                                            {request.status === 'rejected' && <XCircle className="w-3 h-3 mr-1" />}
                                                            {(request.status === 'pending' || request.status === 'pending_manager' || request.status === 'pending_admin') && <AlertCircle className="w-3 h-3 mr-1" />}
                                                            {getLeaveStatusLabel(request.status)}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-xs">
                                                            {getLeaveTypeDisplay(request.leave_type)}
                                                        </Badge>
                                                    </div>
                                                    <div className="text-xs text-slate-500 sm:text-right">
                                                        {format(new Date(request.created_at), 'MMM dd, yyyy HH:mm')}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                                                    <div>
                                                        <h4 className="font-medium text-slate-800 text-sm mb-2">Leave Details</h4>
                                                        <div className="space-y-1 text-sm">
                                                            <p><strong>Type:</strong> {request.leave_type}</p>
                                                            <p><strong>Duration:</strong> {getDurationDisplay(request.leave_duration)}</p>
                                                            <p><strong>Period:</strong> {formatDate(request.from_date)} - {formatDate(request.to_date)}</p>
                                                            <p><strong>Total Days:</strong> {getDaysDisplay(request)}</p>
                                                        </div>
                                                    </div>

                                                    {request.reason && (
                                                        <div>
                                                            <h4 className="font-medium text-slate-800 text-sm mb-2">Reason</h4>
                                                            <p className="text-sm text-slate-600">{request.reason}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {request.status === 'rejected' && request.rejection_reason && (
                                                    <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-md">
                                                        <h4 className="font-medium text-red-800 text-sm mb-1">Rejection Reason</h4>
                                                        <p className="text-sm text-red-700">{request.rejection_reason}</p>
                                                    </div>
                                                )}

                                                {request.admin_notes && (
                                                    <div className="mt-3 p-3 bg-slate-50 rounded-md">
                                                        <h4 className="font-medium text-slate-800 text-sm mb-1">Admin Notes</h4>
                                                        <p className="text-sm text-slate-600">{request.admin_notes}</p>
                                                    </div>
                                                )}

                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="min-h-11"
                                                        onClick={() => handlePrint(request)}
                                                        disabled={isPrinting}
                                                    >
                                                        {isPrinting ? (
                                                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                                        ) : (
                                                            <Printer className="w-4 h-4 mr-1.5" />
                                                        )}
                                                        Print
                                                    </Button>
                                                    {withdrawGate.ok && (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="min-h-11 text-red-700 border-red-200 hover:bg-red-50"
                                                            onClick={() => handleWithdraw(request)}
                                                            disabled={isWithdrawing}
                                                        >
                                                            {isWithdrawing ? (
                                                                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                                            ) : (
                                                                <Undo2 className="w-4 h-4 mr-1.5" />
                                                            )}
                                                            Withdraw
                                                        </Button>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
            </section>
        </WorkerPageShell>
    );
}
