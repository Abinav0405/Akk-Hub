// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useState } from 'react';
import { storageKey } from '@/core/storage';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Copy, History, Loader2, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { toast } from 'sonner';
import { WorkerPageShell } from '@/ui/PortalShell';
import CompanyFormFiller, { clearFormDraft } from '@/modules/timesheet/components/companyForms/CompanyFormFiller';
import { verifyRoleSession } from '@/core/auth/timesheetSession';

import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import {
    getDepartmentLabel,
    getResolvedFormDefinition,
    listWorkerSubmissions,
    submitCompanyForm,
} from '@/modules/timesheet/lib/companyForms';

/** Last answers → a starting point for today's form (dates go back to today, names stay). */
function reusablePayload(definition, payload) {
    if (!payload) return null;
    const dateKeys = new Set([...(definition.fields || []), ...(definition.extraFields || [])].filter((x) => x.type === 'date').map((x) => x.key));
    const fields = Object.fromEntries(Object.entries(payload.fields || {}).filter(([k]) => !dateKeys.has(k)));
    return { fields, checklist: { ...(payload.checklist || {}) }, tableRows: Array.isArray(payload.tableRows) ? payload.tableRows.map((r) => ({ ...r })) : [] };
}

export default function WorkerCompanyFormFill() {
    const [searchParams] = useSearchParams();
    const formKey = searchParams.get('key');
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim()
    );
    const [workerType, setWorkerType] = useState(() =>
        (typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerType'))) || 'foreign'
    );
    const [workerName, setWorkerName] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerName'))) || '').trim()
    );

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
            }
        });
        try {
            setWorkerType(localStorage.getItem(storageKey('timesheet', 'workerType')) || 'foreign');
            setWorkerName((localStorage.getItem(storageKey('timesheet', 'workerName')) || '').trim());
        } catch {
            /* ignore */
        }
    }, []);

    const defQuery = useQuery({
        queryKey: ['company-form-definition', formKey],
        enabled: !!formKey,
        queryFn: () => getResolvedFormDefinition(formKey),
    });

    const definition = defQuery.data;
    const [prefill, setPrefill] = useState(null);
    const [fillNonce, setFillNonce] = useState(0);
    const [sent, setSent] = useState(null);
    const draftKey = workerId && formKey ? `${workerId}:${formKey}` : null;

    const lastQuery = useQuery({
        queryKey: ['worker-company-forms', 'last', workerId, formKey],
        enabled: Boolean(workerId && formKey),
        queryFn: async () => (await listWorkerSubmissions(workerId, { limit: 30 })).find((r) => r.form_key === formKey) || null,
        staleTime: 60_000,
    });
    const last = lastQuery.data;

    const submitMutation = useMutation({
        mutationFn: (payload) =>
            submitCompanyForm({
                formKey,
                workerId,
                workerType,
                workerName: workerName || workerId,
                payload,
            }),
        onSuccess: (row) => {
            queryClient.invalidateQueries({ queryKey: ['worker-company-forms'] });
            queryClient.invalidateQueries({ queryKey: ['company-form-review'] });
            clearFormDraft(draftKey);
            setSent(row);
            window.scrollTo?.({ top: 0, behavior: 'smooth' });
        },
        onError: (e) => toast.error(e.message || 'Submit failed'),
    });

    const nativeApp = isNativeApp();

    if (!formKey) {
        return (
            <WorkerPageShell title="Form not found" subtitle="This form key is invalid or removed">
                {nativeApp ? (
                    <NativeEmptyState
                        icon={ClipboardList}
                        title="Form not found"
                        message="Go back and pick a form from the catalog."
                    />
                ) : (
                    <p className="text-sm text-slate-600">Go back and pick a form from the catalog.</p>
                )}
            </WorkerPageShell>
        );
    }

    if (defQuery.isLoading) {
        return (
            <WorkerPageShell title="Loading form…" subtitle="">
                {nativeApp ? (
                    <NativeListSkeleton rows={4} label="Loading form" />
                ) : (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                )}
            </WorkerPageShell>
        );
    }

    if (defQuery.isError) {
        return (
            <WorkerPageShell title="Form unavailable" subtitle="Could not load this form">
                {nativeApp ? (
                    <NativeErrorState
                        error={defQuery.error}
                        onRetry={() => defQuery.refetch()}
                        retrying={defQuery.isRefetching}
                    />
                ) : (
                    <p className="text-sm text-slate-600">Ask your manager or admin to enable it under Form Modules.</p>
                )}
            </WorkerPageShell>
        );
    }

    if (!definition || definition.enabled === false) {
        return (
            <WorkerPageShell title="Form unavailable" subtitle="This form is off or missing">
                {nativeApp ? (
                    <NativeEmptyState
                        icon={ClipboardList}
                        title="Form unavailable"
                        message="Ask your manager or admin to enable it under Form Modules."
                    />
                ) : (
                    <p className="text-sm text-slate-600">Ask your manager or admin to enable it under Form Modules.</p>
                )}
            </WorkerPageShell>
        );
    }

    if (sent) {
        return (
            <WorkerPageShell title={definition.title} subtitle={getDepartmentLabel(definition.department)}>
                <div className="mx-auto max-w-md rounded-2xl border border-[var(--g-hairline)] bg-white p-6 text-center shadow-sm" role="status">
                    <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
                    <h2 className="mt-3 text-lg font-semibold text-slate-900">Form sent for review</h2>
                    <p className="mt-1 text-sm text-slate-600">
                        {sent.is_flagged
                            ? 'Some answers need attention, so your manager has been alerted.'
                            : 'Your manager or admin will review it. You can follow it under My submissions.'}
                    </p>
                    <div className="mt-5 grid gap-2">
                        <Button
                            type="button"
                            className="h-11 rounded-xl"
                            onClick={() => {
                                setSent(null);
                                setPrefill(null);
                                setFillNonce((n) => n + 1);
                            }}
                        >
                            <Plus className="mr-2 h-4 w-4" /> Fill this form again
                        </Button>
                        <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => navigate('/timesheet/company-forms/history')}>
                            <History className="mr-2 h-4 w-4" /> My submissions
                        </Button>
                        <Link to="/timesheet/company-forms" className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline">
                            Back to all forms
                        </Link>
                    </div>
                </div>
            </WorkerPageShell>
        );
    }

    return (
        <WorkerPageShell
            title={definition.title}
            subtitle={getDepartmentLabel(definition.department)}
        >
            {last && !prefill ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--g-hairline)] bg-white px-3 py-2 text-sm">
                    <span className="text-slate-600">
                        Last sent {new Date(last.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short' })}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-lg"
                        onClick={() => {
                            clearFormDraft(draftKey);
                            setPrefill(reusablePayload(definition, last.payload));
                            setFillNonce((n) => n + 1);
                            toast.success('Answers copied from last time — check them before sending');
                        }}
                    >
                        <Copy className="mr-1.5 h-4 w-4" /> Copy my last answers
                    </Button>
                </div>
            ) : null}
            <CompanyFormFiller
                key={`${definition.key}-${definition.title}-${fillNonce}`}
                definition={definition}
                workerName={workerName || workerId}
                submitting={submitMutation.isPending}
                draftKey={draftKey}
                initialPayload={prefill}
                onSubmit={(payload) => submitMutation.mutateAsync(payload)}
            />
        </WorkerPageShell>
    );
}
