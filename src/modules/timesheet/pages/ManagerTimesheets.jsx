import React, { useState, useEffect, useCallback } from 'react';
import { storageKey } from '@/core/storage';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { ArrowLeft, FileText, Download, CheckCircle, XCircle, Loader2, RotateCcw, RefreshCw } from "lucide-react";
import { cn } from '@/modules/timesheet/lib/utils';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { toast } from "sonner";
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { registerPushForManager } from '@/modules/timesheet/lib/pushRegistration';
import { fetchManagerTimesheetHeadTs, useUpdatedAtHeartbeat } from '@/modules/timesheet/lib/smartPolling';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { PortalBackdrop } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeNavBar } from '@/ui/native/NativeChrome';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

export default function ManagerTimesheets({ embedded = false }) {
    const queryClient = useQueryClient();
    const [managerName, setManagerName] = useState(
        () => localStorage.getItem(storageKey('timesheet', 'managerName')) || 'Manager',
    );
    const [managerEmail, setManagerEmail] = useState(
        () => localStorage.getItem(storageKey('timesheet', 'managerEmail')) || '',
    );
    const [staffReady, setStaffReady] = useState(
        () => localStorage.getItem(storageKey('timesheet', 'managerLoggedIn')) === 'true'
            || localStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true'
            || sessionStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true',
    );

    useEffect(() => {
        verifyRoleSession({ keepOnNetworkError: true }).then((session) => {
            if (session?.networkError) {
                if (
                    localStorage.getItem(storageKey('timesheet', 'managerLoggedIn')) === 'true'
                    || localStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true'
                    || sessionStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true'
                ) {
                    setStaffReady(true);
                }
                return;
            }
            if (session?.role === 'manager' || session?.role === 'admin') {
                setStaffReady(true);
                if (session.session_data?.managerName) setManagerName(session.session_data.managerName);
                const email = session.session_data?.managerEmail || session.subject_id;
                if (email) setManagerEmail(String(email));
            } else if (
                localStorage.getItem(storageKey('timesheet', 'managerLoggedIn')) === 'true'
                || localStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true'
            ) {
                setStaffReady(true);
            }
        });
    }, []);

    useEffect(() => {
        if (!staffReady || !managerEmail) return undefined;
        void registerPushForManager(managerEmail);
        return undefined;
    }, [staffReady, managerEmail]);
    const [declineDialog, setDeclineDialog] = useState(null);
    const [declineReason, setDeclineReason] = useState('');

    const { data: timesheets = [], isLoading, isError: isTimesheetsError, error: timesheetsError, isRefetching: isRefetchingTimesheets, refetch } = useQuery({
        queryKey: ['managerPassedOutTimesheets'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('passed_out_timesheets')
                .select('*')
                .eq('worker_type', 'foreign')
                .in('status', ['awaiting_manager', 'declined_by_worker'])
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
        enabled: staffReady,
        refetchInterval: false,
        refetchIntervalInBackground: false,
    });

    const pollManagerTimesheets = useCallback(() => {
        void refetch();
    }, [refetch]);

    useUpdatedAtHeartbeat({
        enabled: staffReady,
        intervalMs: 3000,
        queryFn: fetchManagerTimesheetHeadTs,
        onChange: pollManagerTimesheets,
    });

    const workerIds = [...new Set(timesheets.map(t => t.worker_id))];
    const { data: workersMap = {} } = useQuery({
        queryKey: ['workersForTimesheets', workerIds],
        queryFn: async () => {
            if (workerIds.length === 0) return {};
            const [local, foreign] = await Promise.all([
                supabase.from('local_worker_details').select('employee_id, employee_name').in('employee_id', workerIds),
                supabase.from('worker_details').select('employee_id, employee_name').in('employee_id', workerIds)
            ]);
            const m = {};
            (local.data || []).forEach(w => { m[w.employee_id] = w.employee_name; });
            (foreign.data || []).forEach(w => { m[w.employee_id] = w.employee_name; });
            return m;
        },
        enabled: workerIds.length > 0
    });

    const approveTimesheet = useMutation({
        mutationFn: async (id) => {
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: 'approved',
                    manager_approved_at: new Date().toISOString(),
                    manager_name: managerName,
                    manager_declined_at: null,
                    manager_decline_reason: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet approved.');
            refetch();
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to approve');
            console.error(e);
        }
    });

    const declineTimesheet = useMutation({
        mutationFn: async ({ id, reason }) => {
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: 'declined_by_manager',
                    manager_declined_at: new Date().toISOString(),
                    manager_name: managerName,
                    manager_decline_reason: reason || '',
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet declined. Admin will be notified.');
            setDeclineDialog(null);
            setDeclineReason('');
            refetch();
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to decline');
            console.error(e);
        }
    });

    const resendToWorker = useMutation({
        mutationFn: async (record) => {
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: 'returned_to_worker',
                    manager_name: managerName,
                    worker_approved_at: null,
                    worker_declined_at: null,
                    worker_decline_reason: null,
                    manager_approved_at: null,
                    manager_declined_at: null,
                    manager_decline_reason: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', record.id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet resent to worker for re-approval.');
            refetch();
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to resend');
            console.error(e);
        }
    });

    const recreateAndResend = useMutation({
        mutationFn: async (record) => {
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: 'returned_to_worker',
                    manager_name: managerName,
                    worker_approved_at: null,
                    worker_declined_at: null,
                    worker_decline_reason: null,
                    manager_approved_at: null,
                    manager_declined_at: null,
                    manager_decline_reason: null,
                    // Flags it "Out of date" on the admin's timesheet report → "Update timesheet".
                    is_stale: true,
                    stale_since: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', record.id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Returned to worker and flagged for the admin to update with the latest shifts.');
            refetch();
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to resend');
            console.error(e);
        }
    });

    const getStatusFooter = (ts) => {
        const base = 'margin-top:24px;padding:12px;font-weight:600;text-align:center;border-radius:8px;';
        if (ts.status === 'declined_by_worker') {
            const text = ts.worker_decline_reason ? `Declined by worker: ${ts.worker_decline_reason}` : 'Declined by worker';
            return { style: base + 'background:#fee2e2;color:#991b1b;', text };
        }
        return { style: base + 'background:#dcfce7;color:#166534;', text: 'Submitted by employee - Awaiting your approval' };
    };

    const injectStatusFooter = (ts) => {
        let html = ts.timesheet_html || '';
        const { style, text } = getStatusFooter(ts);
        const footer = `<div style="${style}">${text}</div>`;
        return html.replace('</body>', footer + '</body>');
    };

    const handleViewTimesheet = (ts) => {
        const html = injectStatusFooter(ts);
        const win = window.open('', '', 'height=800,width=1000');
        if (!win) {
            toast.error('Unable to open preview window');
            return;
        }
        win.document.write(html);
        win.document.close();
    };

    const handleDownloadTimesheet = async (ts) => {
        try {
            const html = injectStatusFooter(ts);
            const result = await printOrShareHtmlDocument(html, {
                title: 'Print timesheet',
                fileName: `Timesheet_${ts.worker_id || 'worker'}_${Date.now()}.pdf`,
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

    const awaitingCount = timesheets.filter((t) => t.status === 'awaiting_manager').length;
    const declinedCount = timesheets.filter((t) => t.status === 'declined_by_worker').length;

    return (
        <div className={embedded ? undefined : cn('relative min-h-dvh-safe overflow-x-hidden bg-[#f8fafc]', NATIVE_APP && 'akk-screen')}>
            {embedded || NATIVE_APP ? null : <PortalBackdrop emerald />}
            {embedded ? null : NATIVE_APP ? (
                <NativeNavBar
                    backTo={"/timesheet/manage"}
                    backLabel="Back to dashboard"
                    eyebrow="Manager"
                    eyebrowTone="manage"
                    title="Timesheet approvals"
                />
            ) : (
            <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 px-safe pt-[max(0.75rem,env(safe-area-inset-top,0px))] backdrop-blur-xl">
                <div className="mx-auto flex max-w-4xl items-center gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <Link to={"/timesheet/manage"}>
                            <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-slate-600 hover:bg-slate-100">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-700">
                                Manager
                            </p>
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">
                                Timesheet approvals
                            </h1>
                        </div>
                    </div>
                </div>
            </header>
            )}

            <main className={embedded ? undefined : 'relative z-10 mx-auto max-w-4xl px-safe py-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]'}>
                <section className={cn(glassPanel, 'p-4 sm:p-5')}>
                    <div className="mb-4">
                        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                            <FileText className="h-5 w-5 text-emerald-600" />
                            Pending review
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            {isLoading
                                ? 'Loading…'
                                : timesheets.length === 0
                                    ? 'Nothing waiting right now'
                                    : `${timesheets.length} timesheet${timesheets.length === 1 ? '' : 's'}${awaitingCount ? ` · ${awaitingCount} to approve` : ''}${declinedCount ? ` · ${declinedCount} declined by worker` : ''}`}
                        </p>
                    </div>

                    {NATIVE_APP && isLoading ? (
                        <NativeListSkeleton rows={3} label="Loading timesheets" />
                    ) : NATIVE_APP && isTimesheetsError && !timesheets.length ? (
                        <NativeErrorState error={timesheetsError} onRetry={() => refetch()} retrying={isRefetchingTimesheets} className="shadow-none" />
                    ) : isLoading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
                        </div>
                    ) : timesheets.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
                            <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                            <h3 className="text-base font-semibold text-slate-700">No timesheets pending</h3>
                            <p className="mt-1 text-sm text-slate-500">Timesheets will show here when workers submit them.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {timesheets.map((ts) => {
                                const workerName = workersMap[ts.worker_id] || ts.worker_id;
                                const isApprovedByWorker = ts.status === 'awaiting_manager';
                                const isDeclinedByWorker = ts.status === 'declined_by_worker';
                                const monthLabel = `${String(ts.month).padStart(2, '0')}/${ts.year}`;
                                return (
                                    <div
                                        key={ts.id}
                                        className={cn(
                                            'rounded-2xl border bg-white/90 p-4',
                                            isDeclinedByWorker ? 'border-red-200 bg-red-50/70' : 'border-slate-200/80'
                                        )}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-slate-900">{workerName}</p>
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    ID {ts.worker_id} · {monthLabel}
                                                    {(ts.revision || 1) > 1 ? ` · Updated (Rev ${ts.revision})` : ''}
                                                    {ts.is_stale ? ' · Shifts changed since passed out' : ''}
                                                </p>
                                            </div>
                                            <span
                                                className={cn(
                                                    'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                                                    isDeclinedByWorker
                                                        ? 'bg-red-100 text-red-800'
                                                        : 'bg-emerald-50 text-emerald-800'
                                                )}
                                            >
                                                {isApprovedByWorker ? 'Submitted by employee' : 'Declined by worker'}
                                            </span>
                                        </div>
                                        {isDeclinedByWorker && ts.worker_decline_reason ? (
                                            <p className="mt-2 text-sm text-red-700">{ts.worker_decline_reason}</p>
                                        ) : null}

                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {isApprovedByWorker && (
                                                <Button
                                                    size="sm"
                                                    className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                                    onClick={() => approveTimesheet.mutate(ts.id)}
                                                    disabled={approveTimesheet.isPending}
                                                >
                                                    <CheckCircle className="mr-1 h-4 w-4" />
                                                    Approve
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                                                onClick={() => setDeclineDialog(ts)}
                                            >
                                                <XCircle className="mr-1 h-4 w-4" />
                                                Decline
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 rounded-xl border-slate-200 bg-white/70"
                                                onClick={() => handleViewTimesheet(ts)}
                                            >
                                                <FileText className="mr-1 h-4 w-4" />
                                                View
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 rounded-xl border-slate-200 bg-white/70"
                                                onClick={() => handleDownloadTimesheet(ts)}
                                            >
                                                <Download className="mr-1 h-4 w-4" />
                                                Download
                                            </Button>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 rounded-xl border-slate-200 bg-white/70"
                                                onClick={() => resendToWorker.mutate(ts)}
                                                disabled={resendToWorker.isPending}
                                            >
                                                <RotateCcw className="mr-1 h-4 w-4" />
                                                Resend to Worker (Same)
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-9 rounded-xl border-slate-200 bg-white/70"
                                                onClick={() => recreateAndResend.mutate(ts)}
                                                disabled={recreateAndResend.isPending}
                                            >
                                                <RefreshCw className="mr-1 h-4 w-4" />
                                                Return & ask admin to update
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            <Dialog open={!!declineDialog} onOpenChange={(open) => !open && setDeclineDialog(null)}>
                <DialogContent className="rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle>Decline Timesheet</DialogTitle>
                        <DialogDescription>Provide a reason for declining. Admin can resend or delete.</DialogDescription>
                    </DialogHeader>
                    <Textarea placeholder="Reason for declining..." value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} className="rounded-xl" />
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="min-h-11 w-full rounded-xl sm:w-auto" onClick={() => { setDeclineDialog(null); setDeclineReason(''); }}>Cancel</Button>
                        <Button variant="destructive" className="min-h-11 w-full rounded-xl sm:w-auto" onClick={() => declineTimesheet.mutate({ id: declineDialog?.id, reason: declineReason })} disabled={declineTimesheet.isPending}>
                            {declineTimesheet.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Decline'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
