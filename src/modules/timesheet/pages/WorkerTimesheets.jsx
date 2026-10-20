// TODO(claude): ensure @/ui/native/* chrome/states/confirm exist (or remount Timesheet native chrome)
// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageKey } from '@/core/storage';
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
import { FileText, Printer, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { cn } from '@/modules/timesheet/lib/utils';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { shareHtmlAsPdf } from '@/modules/timesheet/lib/pdfDownload';
import { printHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { fetchWorkerTimesheetHeadTs, useUpdatedAtHeartbeat } from '@/modules/timesheet/lib/smartPolling';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

export default function WorkerTimesheets() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [workerId, setWorkerId] = useState(() => (localStorage.getItem(storageKey('timesheet', 'workerId')) || '').trim());
    const [authChecked, setAuthChecked] = useState(false);
    const [declineDialog, setDeclineDialog] = useState(null);
    const [declineReason, setDeclineReason] = useState('');
    const [documentPreview, setDocumentPreview] = useState(null);
    const [isPreviewPdfExporting, setIsPreviewPdfExporting] = useState(false);
    const isNativeApp = Capacitor.isNativePlatform();

    useEffect(() => {
        verifyRoleSession({ keepOnNetworkError: true }).then((session) => {
            if (session?.networkError) {
                // Hub guard keeps the session; use stored worker id if present.
                if (localStorage.getItem(storageKey('timesheet', 'workerId'))) setAuthChecked(true);
                return;
            }
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
                setAuthChecked(true);
            } else if (!localStorage.getItem(storageKey('timesheet', 'workerId'))) {
                navigate('/login', { replace: true });
            } else {
                setAuthChecked(true);
            }
        });
    }, [navigate]);

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

    const LIST_COLS =
        'id, worker_id, worker_type, month, year, status, manager_name, revision, created_at, updated_at';

    const { data: timesheets, isLoading, isError, error: timesheetsError, isRefetching, refetch } = useQuery({
        queryKey: ['passedOutTimesheets', workerId],
        queryFn: async () => {
            if (!workerId) return [];
            // List without timesheet_html (large HTML) — fetch HTML only when opening a preview.
            const { data, error } = await supabase
                .from('passed_out_timesheets')
                .select(LIST_COLS)
                .eq('worker_id', workerId)
                .in('status', ['pending_worker', 'returned_to_worker', 'awaiting_manager', 'awaiting_admin', 'approved'])
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
        enabled: !!workerId,
        /** Lightweight heartbeat below refetches when updated_at changes; Realtime also invalidates. */
        refetchInterval: false,
        refetchIntervalInBackground: false,
    });

    const pollWorkerTimesheets = useCallback(() => {
        void refetch();
    }, [refetch]);

    const fetchWorkerHead = useCallback(
        () => fetchWorkerTimesheetHeadTs(workerId),
        [workerId]
    );

    useUpdatedAtHeartbeat({
        enabled: !!workerId,
        intervalMs: 3000,
        queryFn: fetchWorkerHead,
        onChange: pollWorkerTimesheets,
    });

    const timesheetsList = timesheets ?? [];

    /** `null` = not initialized (next snapshot seeds without notifying). */
    const timesheetStatusByIdRef = useRef(null);

    useEffect(() => {
        timesheetStatusByIdRef.current = null;
    }, [workerId]);

    useEffect(() => {
        if (!workerId) return;
        if (timesheets === undefined) return;

        const list = timesheets;
        if (timesheetStatusByIdRef.current === null) {
            timesheetStatusByIdRef.current = new Map(list.map((ts) => [ts.id, ts.status]));
            return;
        }
        const byId = timesheetStatusByIdRef.current;
        const newRows = [];
        const statusChanges = [];
        for (const ts of list) {
            const prev = byId.get(ts.id);
            if (prev === undefined) newRows.push(ts);
            else if (prev !== ts.status) statusChanges.push(ts);
            byId.set(ts.id, ts.status);
        }
        void newRows;
        void statusChanges;
    }, [timesheets, workerId]);

    const submitTimesheet = useMutation({
        mutationFn: async ({ id, workerType }) => {
            const nextStatus = workerType === 'local' ? 'awaiting_admin' : 'awaiting_manager';
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: nextStatus,
                    worker_approved_at: new Date().toISOString(),
                    worker_declined_at: null,
                    worker_decline_reason: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: (_, { workerType }) => {
            toast.success(workerType === 'local' ? 'Timesheet submitted. Awaiting admin approval.' : 'Timesheet submitted. Awaiting manager approval.');
            refetch();
            queryClient.invalidateQueries({ queryKey: ['passedOutTimesheets'] });
        },
        onError: (e) => {
            toast.error('Failed to submit');
            console.error(e);
        }
    });

    const declineTimesheet = useMutation({
        mutationFn: async ({ id, reason }) => {
            const { error } = await supabase
                .from('passed_out_timesheets')
                .update({
                    status: 'declined_by_worker',
                    worker_declined_at: new Date().toISOString(),
                    worker_decline_reason: reason || '',
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('Timesheet declined.');
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

    const getStatusFooter = (ts) => {
        const base = 'margin-top:24px;padding:12px;font-weight:600;text-align:center;border-radius:8px;';
        switch (ts.status) {
            case 'approved': {
                const baseSig = 'margin-top:24px;padding:12px;';
                const approverName = ts.manager_name || 'manager/admin';
                const sigHtml = `<div style="border-bottom:1px solid #333;width:220px;height:24px;margin-bottom:12px;"></div><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;"><span>Employee signature</span><span>Approved by ${approverName}</span></div>`;
                return { style: baseSig, text: sigHtml };
            }
            case 'awaiting_manager':
                return { style: base + 'background:#dcfce7;color:#166534;', text: 'Submitted by employee - Awaiting manager approval' };
            case 'awaiting_admin':
                return { style: base + 'background:#dcfce7;color:#166534;', text: 'Submitted by employee - Awaiting admin approval' };
            case 'returned_to_worker':
                return { style: base + 'background:#dbeafe;color:#1e40af;', text: ts.manager_name ? `Returned back to worker for re-approval by ${ts.manager_name}` : 'Returned back to worker for re-approval' };
            case 'pending_worker':
            default:
                return { style: base + 'background:#fef3c7;color:#92400e;', text: 'Not approved yet' };
        }
    };

    const handleViewTimesheet = async (ts) => {
        const title = `Timesheet ${String(ts.month).padStart(2, '0')}/${ts.year}`;
        setDocumentPreview({ html: '', title, loading: true });
        try {
            const { data, error } = await supabase
                .from('passed_out_timesheets')
                .select('timesheet_html, status, manager_name')
                .eq('id', ts.id)
                .maybeSingle();
            if (error) throw error;
            const html = injectStatusFooter({ ...ts, ...data });
            setDocumentPreview({ html, title, loading: false });
        } catch (e) {
            console.error(e);
            toast.error('Could not load timesheet preview');
            setDocumentPreview(null);
        }
    };

    const injectStatusFooter = (ts) => {
        let html = ts.timesheet_html || '';
        const row = getStatusFooter(ts);
        const footer = row.text ? `<div style="${row.style || ''}">${row.text}</div>` : `<div style="${row.style}"></div>`;
        html = html.replace('</body>', footer + '</body>');
        return html;
    };

    /** Native APK: window.print is unreliable; export PDF + Share like Worker Portal. */
    const handlePrintDocumentPreview = async () => {
        const html = documentPreview?.html || '';
        if (!html.trim()) {
            toast.error('Timesheet preview not available');
            return;
        }

        if (isNativeApp) {
            setIsPreviewPdfExporting(true);
            const safeTitle = (documentPreview?.title || 'Timesheet')
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '_')
                .slice(0, 48);
            const fileName = `${safeTitle || 'Timesheet'}_${workerId}_${Date.now()}.pdf`;
            const loadingToast = toast.loading('Creating PDF…');
            try {
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
            printHtmlDocument(html, {
                title: 'Print timesheet',
                printDelayMs: 350,
            });
            toast.success('Print dialog opened — use "Save as PDF" to download');
        } catch (e) {
            toast.error('Failed to open print');
            console.error(e);
        }
    };

    if (!workerId) {
        navigate('/login', { replace: true });
        return null;
    }

    const pendingOrReturned = timesheetsList.filter(t => t.status === 'pending_worker' || t.status === 'returned_to_worker');
    const awaitingManager = timesheetsList.filter(t => t.status === 'awaiting_manager');
    const awaitingAdmin = timesheetsList.filter(t => t.status === 'awaiting_admin');
    const approved = timesheetsList.filter(t => t.status === 'approved');

    return (
        <WorkerPageShell title="Timesheets" subtitle="Review and submit your timesheets">
            {isNativeApp && isLoading ? (
                <NativeListSkeleton rows={3} label="Loading timesheets" />
            ) : isNativeApp && isError && !timesheetsList.length ? (
                <NativeErrorState error={timesheetsError} onRetry={() => refetch()} retrying={isRefetching} />
            ) : isNativeApp && timesheetsList.length === 0 ? (
                <NativeEmptyState
                    icon={FileText}
                    title="No timesheets"
                    message="No timesheets have been sent to you for submission yet."
                />
            ) : isLoading ? (
                    <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#dc6b2f]" /></div>
                ) : timesheetsList.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
                            <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                            <h3 className="text-base font-semibold text-slate-700">No timesheets</h3>
                            <p className="mt-1 text-sm text-slate-500">No timesheets have been sent to you for submission yet.</p>
                    </div>
                ) : (
                    <>
                        {pendingOrReturned.length > 0 && (
                            <section className="mb-5">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">Pending your submission</h2>
                                <div className="space-y-2">
                                    {pendingOrReturned.map((ts) => (
                                        <div key={ts.id} className={cn(glassPanel, 'p-4')}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-900">Month: {String(ts.month).padStart(2, '0')}/{ts.year}</p>
                                                    <p className="text-sm text-slate-600">{ts.status === 'returned_to_worker' ? 'Returned back for re-submission' : 'Awaiting your submission'}</p>
                                                    {(ts.revision || 1) > 1 && (
                                                        <p className="text-xs text-slate-500">Updated with the latest hours (Rev {ts.revision})</p>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap gap-2 items-center">
                                                    <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => handleViewTimesheet(ts)}>
                                                        <FileText className="w-4 h-4 mr-1" /> View
                                                    </Button>
                                                    <Button size="sm" className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={() => submitTimesheet.mutate({ id: ts.id, workerType: ts.worker_type })} disabled={submitTimesheet.isPending}>
                                                        <CheckCircle className="w-4 h-4 mr-1" /> Submit
                                                    </Button>
                                                    <Button size="sm" variant="destructive" className="h-9 rounded-xl" onClick={() => setDeclineDialog(ts)}>
                                                        <XCircle className="w-4 h-4 mr-1" /> Decline
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {awaitingManager.length > 0 && (
                            <section className="mb-5">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">Awaiting manager approval</h2>
                                <div className="space-y-2">
                                    {awaitingManager.map((ts) => (
                                        <div key={ts.id} className={cn(glassPanel, 'p-4')}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-900">Month: {String(ts.month).padStart(2, '0')}/{ts.year}</p>
                                                    <p className="text-sm text-slate-600">Submitted by you. Waiting for manager.</p>
                                                </div>
                                                <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => handleViewTimesheet(ts)}>
                                                    <FileText className="w-4 h-4 mr-1" /> View
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {awaitingAdmin.length > 0 && (
                            <section className="mb-5">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">Awaiting admin approval</h2>
                                <div className="space-y-2">
                                    {awaitingAdmin.map((ts) => (
                                        <div key={ts.id} className={cn(glassPanel, 'p-4')}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-900">Month: {String(ts.month).padStart(2, '0')}/{ts.year}</p>
                                                    <p className="text-sm text-slate-600">Submitted by you. Waiting for admin.</p>
                                                </div>
                                                <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => handleViewTimesheet(ts)}>
                                                    <FileText className="w-4 h-4 mr-1" /> View
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {approved.length > 0 && (
                            <section className="mb-5">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">Approved timesheets</h2>
                                <div className="space-y-2">
                                    {approved.map((ts) => (
                                        <div key={ts.id} className={cn(glassPanel, 'p-4')}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-900">Month: {String(ts.month).padStart(2, '0')}/{ts.year}</p>
                                                    <p className="text-sm text-emerald-700">Approved by {ts.manager_name || 'manager/admin'}</p>
                                                </div>
                                                <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => handleViewTimesheet(ts)}>
                                                    <FileText className="w-4 h-4 mr-1" /> View
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}

            <Dialog open={!!documentPreview} onOpenChange={(open) => !open && setDocumentPreview(null)}>
                <DialogContent className="akk-dialog--fullscreen flex h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] flex-col gap-0 rounded-none border-0 p-0 pt-[env(safe-area-inset-top,0px)] sm:h-[min(90vh,800px)] sm:max-h-[90vh] sm:max-w-4xl sm:rounded-lg sm:border sm:pt-0">
                    <DialogHeader className="flex shrink-0 flex-col gap-2 space-y-0 border-b px-3 py-3 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <DialogTitle className="truncate pr-2 text-left text-base font-semibold">
                            {documentPreview?.title || 'Timesheet'}
                        </DialogTitle>
                        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-11 flex-1 sm:flex-none"
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
                            <Button type="button" size="sm" className="min-h-11 flex-1 sm:flex-none" onClick={() => setDocumentPreview(null)}>
                                Back
                            </Button>
                        </div>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 bg-white">
                        {documentPreview?.loading ? (
                            <div className="flex h-full items-center justify-center gap-2 text-slate-500">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Loading preview…
                            </div>
                        ) : documentPreview?.html ? (
                            <iframe
                                title={documentPreview.title}
                                srcDoc={documentPreview.html}
                                className="h-full w-full border-0"
                            />
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!declineDialog} onOpenChange={(open) => !open && setDeclineDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Decline Timesheet</DialogTitle>
                        <DialogDescription>Please provide a reason for declining. This will be sent to the manager.</DialogDescription>
                    </DialogHeader>
                    <Textarea placeholder="Reason for declining..." value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} />
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => { setDeclineDialog(null); setDeclineReason(''); }}>Cancel</Button>
                        <Button variant="destructive" className="min-h-11 w-full sm:w-auto" onClick={() => declineTimesheet.mutate({ id: declineDialog?.id, reason: declineReason })} disabled={declineTimesheet.isPending}>
                            {declineTimesheet.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Decline'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </WorkerPageShell>
    );
}
