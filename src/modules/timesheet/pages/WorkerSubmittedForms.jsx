// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React from 'react';
import { storageKey } from '@/core/storage';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { ClipboardList, RotateCcw, Loader2 } from 'lucide-react';
import { createPageUrl, cn } from '@/modules/timesheet/lib/utils';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

export default function WorkerSubmittedForms() {
    const navigate = useNavigate();
    const workerId = ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim();

    const submittedQuery = useQuery({
        queryKey: ['worker-submitted-forms', workerId],
        enabled: !!workerId,
        queryFn: async () => {
            const { data: forms, error } = await supabase
                .from('feedback_forms')
                .select('id, title, description, publish_revision, published_at')
                .eq('is_published', true)
                .order('published_at', { ascending: false });
            if (error) throw error;
            if (!forms?.length) return [];

            const { data: subs, error: subErr } = await supabase
                .from('feedback_form_submissions')
                .select('id, form_id, publish_revision, response_number, submitted_at')
                .eq('worker_id', workerId)
                .order('response_number', { ascending: true });
            if (subErr) throw subErr;

            return forms
                .map((f) => {
                    const revision = f.publish_revision ?? 0;
                    const responses = (subs || [])
                        .filter((s) => s.form_id === f.id && s.publish_revision === revision)
                        .map((s) => ({
                            id: s.id,
                            response_number: s.response_number ?? 1,
                            submitted_at: s.submitted_at,
                        }));
                    if (!responses.length) return null;
                    return { ...f, revision, responses };
                })
                .filter(Boolean);
        },
    });

    const handleResubmit = async (form) => {
        const nextNum = (form.responses?.length ?? 0) + 1;
        const confirmed = await confirmAction({
            title: 'Submit another response?',
            message: `Submit another response for "${form.title}"? Your previous answers stay as Response 1, Response 2, etc. This will be Response ${nextNum}.`,
            confirmLabel: `Start response ${nextNum}`,
        });
        if (!confirmed) {
            return;
        }
        navigate(createPageUrl(`WorkerFormFill?id=${form.id}&resubmit=1`));
    };

    if (!workerId) {
        return (
            <WorkerPageShell title="Submitted forms" maxWidth="max-w-3xl">
                <div className={cn(glassPanel, 'px-6 py-12 text-center')}>
                    <p className="text-sm text-slate-600">Please log in as a worker.</p>
                </div>
            </WorkerPageShell>
        );
    }

    const submitted = submittedQuery.data || [];

    return (
        <WorkerPageShell
            title="Submitted forms"
            subtitle="All your responses are kept (Response 1, 2, …)"
            maxWidth="max-w-3xl"
        >
            <section className={cn(glassPanel, 'p-4 sm:p-6')}>
                {NATIVE_APP && submittedQuery.isLoading ? (
                    <NativeListSkeleton rows={2} label="Loading submitted forms" />
                ) : NATIVE_APP && submittedQuery.isError && !submitted.length ? (
                    <NativeErrorState
                        className="shadow-none"
                        error={submittedQuery.error}
                        onRetry={() => submittedQuery.refetch()}
                        retrying={submittedQuery.isRefetching}
                    />
                ) : submittedQuery.isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-7 w-7 animate-spin text-[#dc6b2f]" />
                    </div>
                ) : submitted.length === 0 ? (
                    <div className="py-10 text-center">
                        <ClipboardList className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                        <p className="text-sm font-medium text-slate-700">No submitted forms yet.</p>
                        <p className="mt-1 text-xs text-slate-500">Completed forms will show up here.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {submitted.map((form) => (
                            <div
                                key={form.id}
                                className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-900">{form.title}</p>
                                        {form.description ? (
                                            <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                                                {form.description}
                                            </p>
                                        ) : null}
                                    </div>
                                    <Badge variant="secondary" className="shrink-0 rounded-full text-xs">
                                        {form.responses.length} response{form.responses.length === 1 ? '' : 's'}
                                    </Badge>
                                </div>
                                <ul className="space-y-2 border-t border-slate-100 pt-3">
                                    {form.responses.map((r) => (
                                        <li
                                            key={r.id}
                                            className="flex flex-col gap-0.5 rounded-xl bg-slate-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                                        >
                                            <span className="font-medium text-slate-800">
                                                Response {r.response_number}
                                            </span>
                                            <span className="text-xs text-slate-500">
                                                {new Date(r.submitted_at).toLocaleString()}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 w-full rounded-xl border-[#dc6b2f]/40 text-[#dc6b2f] hover:bg-[#dc6b2f]/10 sm:w-auto"
                                    onClick={() => handleResubmit(form)}
                                >
                                    <RotateCcw className="mr-1.5 h-4 w-4" />
                                    Submit response {(form.responses?.length ?? 0) + 1}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </WorkerPageShell>
    );
}
