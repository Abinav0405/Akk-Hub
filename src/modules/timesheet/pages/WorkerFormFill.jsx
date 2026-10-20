// TODO(claude): ensure @/ui/native/* chrome/states/confirm exist (or remount Timesheet native chrome)
// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useState } from 'react';
import { storageKey } from '@/core/storage';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { ClipboardList, Loader2, Send } from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { toast } from 'sonner';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

export default function WorkerFormFill() {
    const [searchParams] = useSearchParams();
    const formId = searchParams.get('id');
    const isResubmit = searchParams.get('resubmit') === '1';
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim(),
    );

    const [answers, setAnswers] = useState({});

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
            }
        });
    }, []);

    const formQuery = useQuery({
        queryKey: ['worker-feedback-form-fill', formId, workerId, isResubmit],
        enabled: !!formId && !!workerId,
        queryFn: async () => {
            const { data: form, error: formError } = await supabase
                .from('feedback_forms')
                .select('*')
                .eq('id', formId)
                .eq('is_published', true)
                .single();
            if (formError) throw formError;

            const { data: questions, error: qError } = await supabase
                .from('feedback_form_questions')
                .select('*')
                .eq('form_id', formId)
                .order('sort_order', { ascending: true });
            if (qError) throw qError;

            const revision = form.publish_revision ?? 0;
            const { data: existingSubs, error: existingErr } = await supabase
                .from('feedback_form_submissions')
                .select('id, response_number')
                .eq('form_id', formId)
                .eq('worker_id', workerId)
                .eq('publish_revision', revision)
                .order('response_number', { ascending: false });
            if (existingErr) throw existingErr;

            const priorCount = existingSubs?.length ?? 0;
            const maxResponseNumber = existingSubs?.[0]?.response_number ?? 0;
            const responseNumberToSubmit = priorCount === 0 ? 1 : maxResponseNumber + 1;

            return {
                form,
                questions: questions || [],
                alreadySubmitted: priorCount > 0 && !isResubmit,
                responseNumberToSubmit,
                priorCount,
            };
        },
    });

    const questions = formQuery.data?.questions || [];
    const form = formQuery.data?.form;
    const responseNumberToSubmit = formQuery.data?.responseNumberToSubmit ?? 1;

    useEffect(() => {
        const init = {};
        questions.forEach((q) => {
            init[q.id] = '';
        });
        setAnswers(init);
    }, [questions]);

    const submitMutation = useMutation({
        mutationFn: async () => {
            if (!formId || !workerId || !form) throw new Error('Missing form or worker');
            if (formQuery.data?.alreadySubmitted) throw new Error('You already submitted this form.');

            const revision = form.publish_revision ?? 0;
            const responseNumber = formQuery.data?.responseNumberToSubmit ?? 1;
            for (const q of questions) {
                if (q.is_required !== false) {
                    const val = (answers[q.id] || '').trim();
                    if (!val) throw new Error(`Please answer: ${q.question_text}`);
                }
            }

            const { data: submission, error: subError } = await supabase
                .from('feedback_form_submissions')
                .insert([
                    {
                        form_id: formId,
                        worker_id: workerId,
                        publish_revision: revision,
                        response_number: responseNumber,
                    },
                ])
                .select('id')
                .single();
            if (subError) throw subError;

            const rows = questions
                .map((q) => ({
                    submission_id: submission.id,
                    question_id: q.id,
                    answer_text: String(answers[q.id] ?? '').trim(),
                }))
                .filter((r) => r.answer_text);

            if (rows.length > 0) {
                const { error: ansError } = await supabase.from('feedback_form_answers').insert(rows);
                if (ansError) throw ansError;
            }
        },
        onSuccess: async () => {
            const responseNum = formQuery.data?.responseNumberToSubmit ?? 1;
            toast.success(
                responseNum > 1
                    ? `Response ${responseNum} submitted. Thank you!`
                    : 'Form submitted. Thank you!'
            );
            await queryClient.invalidateQueries({ queryKey: ['worker-feedback-forms'] });
            await queryClient.invalidateQueries({ queryKey: ['worker-submitted-forms'] });
            navigate("/timesheet/clock");
        },
        onError: (e) => toast.error(e.message || 'Failed to submit'),
    });

    if (!workerId) {
        return (
            <WorkerPageShell title="Form" maxWidth="max-w-3xl">
                <div className={cn(glassPanel, 'px-6 py-12 text-center')}>
                    <p className="text-sm text-slate-600">Please log in as a worker.</p>
                </div>
            </WorkerPageShell>
        );
    }

    if (NATIVE_APP && formQuery.isLoading) {
        return (
            <WorkerPageShell title="Form" subtitle="Loading…" maxWidth="max-w-3xl">
                <NativeListSkeleton rows={3} label="Loading form" />
            </WorkerPageShell>
        );
    }

    if (NATIVE_APP && (formQuery.isError || !form)) {
        return (
            <WorkerPageShell title="Form" subtitle="Unavailable" maxWidth="max-w-3xl">
                {formQuery.isError ? (
                    <NativeErrorState
                        error={formQuery.error}
                        onRetry={() => formQuery.refetch()}
                        retrying={formQuery.isRefetching}
                    />
                ) : (
                    <NativeEmptyState
                        icon={ClipboardList}
                        title="Form not available"
                        message="This form was not found or is no longer published."
                    />
                )}
            </WorkerPageShell>
        );
    }

    if (formQuery.isLoading) {
        return (
            <WorkerPageShell title="Form" subtitle="Loading…" maxWidth="max-w-3xl">
                <div className="flex justify-center py-16">
                    <Loader2 className="h-7 w-7 animate-spin text-[#dc6b2f]" />
                </div>
            </WorkerPageShell>
        );
    }

    if (formQuery.isError || !form) {
        return (
            <WorkerPageShell title="Form" subtitle="Unavailable" maxWidth="max-w-3xl">
                <div className={cn(glassPanel, 'px-6 py-12 text-center')}>
                    <p className="text-sm font-medium text-slate-700">Form not found or not available.</p>
                    <Link
                        to={"/timesheet/clock"}
                        className="mt-3 inline-block text-sm font-medium text-[#dc6b2f] hover:underline"
                    >
                        Back to portal
                    </Link>
                </div>
            </WorkerPageShell>
        );
    }

    if (formQuery.data?.alreadySubmitted) {
        return (
            <WorkerPageShell title={form.title} subtitle="Already submitted" maxWidth="max-w-3xl">
                <div className={cn(glassPanel, 'space-y-4 px-6 py-10 text-center')}>
                    <p className="text-base font-semibold text-slate-900">Already submitted</p>
                    <p className="text-sm text-slate-600">
                        You have already completed this form. To change your answers, resubmit from submitted forms.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                        <Link to={"/timesheet/forms"}>
                            <Button className="h-10 w-full rounded-xl bg-[#dc6b2f] hover:bg-[#c45f28] sm:w-auto">
                                View submitted forms
                            </Button>
                        </Link>
                        <Link to={"/timesheet/clock"}>
                            <Button variant="outline" className="h-10 w-full rounded-xl sm:w-auto">
                                Back to portal
                            </Button>
                        </Link>
                    </div>
                </div>
            </WorkerPageShell>
        );
    }

    return (
        <WorkerPageShell
            title={form.title}
            subtitle={
                isResubmit && responseNumberToSubmit > 1
                    ? `Submitting response ${responseNumberToSubmit}${form.description ? ` · ${form.description}` : ''}`
                    : form.description || undefined
            }
            maxWidth="max-w-3xl"
        >
            <section className={cn(glassPanel, 'space-y-5 p-4 sm:p-6')}>
                        {questions.map((q, index) => (
                            <div key={q.id} className="space-y-2">
                                <label className="text-sm font-medium text-slate-900">
                                    {index + 1}. {q.question_text}
                                    {q.is_required !== false ? (
                                        <span className="text-red-500 ml-1">*</span>
                                    ) : null}
                                </label>
                                {q.question_type === 'long_text' ? (
                                    <Textarea
                                        value={answers[q.id] || ''}
                                        onChange={(e) =>
                                            setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                                        }
                                        rows={3}
                                        className="rounded-xl"
                                    />
                                ) : q.question_type === 'rating' ? (
                                    <div className="flex flex-wrap gap-2">
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <Button
                                                key={n}
                                                type="button"
                                                variant={answers[q.id] === String(n) ? 'default' : 'outline'}
                                                className={
                                                    answers[q.id] === String(n)
                                                        ? 'h-10 rounded-xl bg-[#dc6b2f] hover:bg-[#c45f28]'
                                                        : 'h-10 rounded-xl'
                                                }
                                                onClick={() =>
                                                    setAnswers((prev) => ({ ...prev, [q.id]: String(n) }))
                                                }
                                            >
                                                {n}
                                            </Button>
                                        ))}
                                    </div>
                                ) : q.question_type === 'yes_no' ? (
                                    <div className="flex gap-2">
                                        {['Yes', 'No'].map((opt) => (
                                            <Button
                                                key={opt}
                                                type="button"
                                                variant={answers[q.id] === opt ? 'default' : 'outline'}
                                                className={
                                                    answers[q.id] === opt
                                                        ? 'h-10 rounded-xl bg-[#dc6b2f] hover:bg-[#c45f28]'
                                                        : 'h-10 rounded-xl'
                                                }
                                                onClick={() =>
                                                    setAnswers((prev) => ({ ...prev, [q.id]: opt }))
                                                }
                                            >
                                                {opt}
                                            </Button>
                                        ))}
                                    </div>
                                ) : (
                                    <Input
                                        value={answers[q.id] || ''}
                                        onChange={(e) =>
                                            setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                                        }
                                        className="rounded-xl"
                                    />
                                )}
                            </div>
                        ))}

                        <Button
                            className="h-11 w-full rounded-xl bg-[#dc6b2f] hover:bg-[#c45f28]"
                            onClick={() => submitMutation.mutate()}
                            disabled={submitMutation.isPending || questions.length === 0}
                        >
                            {submitMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="mr-2 h-4 w-4" />
                            )}
                            Submit
                        </Button>
            </section>
        </WorkerPageShell>
    );
}
