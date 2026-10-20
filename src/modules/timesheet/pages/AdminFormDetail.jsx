// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
    PlusCircle,
    Trash2,
    ChevronDown,
    ChevronUp,
    Send,
    GripVertical,
    Users,
    Printer,
    Download,
    ClipboardList,
} from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassInput, glassPanel } from '@/ui/glass';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { fetchWorkerNameMap, getWorkerDisplayName } from '@/modules/timesheet/lib/workerNames';
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { toast } from 'sonner';

const QUESTION_TYPES = [
    { value: 'short_text', label: 'Short answer' },
    { value: 'long_text', label: 'Long answer' },
    { value: 'rating', label: 'Rating (1–5)' },
    { value: 'yes_no', label: 'Yes / No' },
];

function newLocalQuestion(sortOrder) {
    return {
        id: null,
        _key: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        question_text: '',
        question_type: 'short_text',
        sort_order: sortOrder,
        is_required: true,
    };
}

export default function AdminFormDetail() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const formId = searchParams.get('id');
    const queryClient = useQueryClient();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [questions, setQuestions] = useState([]);
    const [expandedWorker, setExpandedWorker] = useState(null);

    const formQuery = useQuery({
        queryKey: ['admin-feedback-form', formId],
        enabled: !!formId,
        queryFn: async () => {
            const { data: form, error: formError } = await supabase
                .from('feedback_forms')
                .select('*')
                .eq('id', formId)
                .single();
            if (formError) throw formError;

            const { data: qs, error: qError } = await supabase
                .from('feedback_form_questions')
                .select('*')
                .eq('form_id', formId)
                .order('sort_order', { ascending: true });
            if (qError) throw qError;

            return { form, questions: qs || [] };
        },
    });

    useEffect(() => {
        if (!formQuery.data) return;
        setTitle(formQuery.data.form.title || '');
        setDescription(formQuery.data.form.description || '');
        setQuestions(
            (formQuery.data.questions || []).map((q) => ({
                id: q.id,
                _key: q.id,
                question_text: q.question_text,
                question_type: q.question_type || 'short_text',
                sort_order: q.sort_order ?? 0,
                is_required: q.is_required !== false,
            }))
        );
    }, [formQuery.data]);

    const form = formQuery.data?.form;
    const revision = form?.publish_revision ?? 0;

    const submissionsQuery = useQuery({
        queryKey: ['admin-form-submissions', formId, revision],
        enabled: !!formId && !!form?.is_published,
        queryFn: async () => {
            const { data: submissions, error } = await supabase
                .from('feedback_form_submissions')
                .select('id, worker_id, submitted_at, publish_revision, response_number')
                .eq('form_id', formId)
                .eq('publish_revision', revision)
                .order('worker_id', { ascending: true })
                .order('response_number', { ascending: true });
            if (error) throw error;
            if (!submissions?.length) return [];

            const workerIds = [...new Set(submissions.map((s) => s.worker_id))];
            const nameById = await fetchWorkerNameMap(workerIds);

            const submissionIds = submissions.map((s) => s.id);
            const { data: answers } = await supabase
                .from('feedback_form_answers')
                .select('submission_id, question_id, answer_text')
                .in('submission_id', submissionIds);

            const { data: allQuestions } = await supabase
                .from('feedback_form_questions')
                .select('id, question_text, sort_order')
                .eq('form_id', formId)
                .order('sort_order', { ascending: true });

            const questionById = new Map((allQuestions || []).map((q) => [q.id, q]));

            return submissions.map((sub) => {
                const subAnswers = (answers || []).filter((a) => a.submission_id === sub.id);
                return {
                    ...sub,
                    employee_name: getWorkerDisplayName(nameById, sub.worker_id),
                    responses: subAnswers
                        .map((a) => ({
                            question_id: a.question_id,
                            question_text: questionById.get(a.question_id)?.question_text || 'Question',
                            answer_text: a.answer_text,
                            sort_order: questionById.get(a.question_id)?.sort_order ?? 0,
                        }))
                        .sort((a, b) => a.sort_order - b.sort_order),
                };
            });
        },
    });

    const persistForm = async ({ publish }) => {
        if (!formId) throw new Error('Missing form id');
        const t = title.trim();
        if (!t) throw new Error('Title is required');
        const validQuestions = questions.filter((q) => q.question_text.trim());
        if (publish && validQuestions.length === 0) {
            throw new Error('Add at least one question before publishing.');
        }

        const nextRevision = publish
            ? (form?.is_published ? (revision || 0) + 1 : Math.max(revision || 0, 1))
            : revision;

        const { error: formError } = await supabase
            .from('feedback_forms')
            .update({
                title: t,
                description: description.trim() || null,
                is_published: publish ? true : form?.is_published ?? false,
                publish_revision: publish ? nextRevision : revision,
                published_at: publish ? new Date().toISOString() : form?.published_at,
                updated_at: new Date().toISOString(),
            })
            .eq('id', formId);
        if (formError) throw formError;

        const { data: existing } = await supabase
            .from('feedback_form_questions')
            .select('id')
            .eq('form_id', formId);
        const existingIds = new Set((existing || []).map((r) => r.id));
        const keptIds = new Set();

        for (let i = 0; i < validQuestions.length; i++) {
            const q = validQuestions[i];
            const payload = {
                form_id: formId,
                question_text: q.question_text.trim(),
                question_type: q.question_type,
                sort_order: i,
                is_required: q.is_required,
            };
            if (q.id) {
                keptIds.add(q.id);
                const { error } = await supabase.from('feedback_form_questions').update(payload).eq('id', q.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('feedback_form_questions').insert([payload]);
                if (error) throw error;
            }
        }

        const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
        if (toDelete.length > 0) {
            const { error } = await supabase.from('feedback_form_questions').delete().in('id', toDelete);
            if (error) throw error;
        }

        return { published: publish, nextRevision };
    };

    const saveDraft = useMutation({
        mutationFn: () => persistForm({ publish: false }),
        onSuccess: async () => {
            toast.success('Form saved');
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-form', formId] });
        },
        onError: (e) => toast.error(e.message || 'Failed to save'),
    });

    const publishForm = useMutation({
        mutationFn: () => persistForm({ publish: true }),
        onSuccess: async (result) => {
            const wasPublished = form?.is_published;
            toast.success(
                wasPublished
                    ? `Republished (revision ${result.nextRevision}). Workers must submit again.`
                    : `Published (revision ${result.nextRevision}).`
            );
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-form', formId] });
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-forms'] });
            await queryClient.invalidateQueries({ queryKey: ['worker-feedback-forms'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to publish'),
    });

    const deleteForm = useMutation({
        mutationFn: async () => {
            if (!formId) throw new Error('Missing form id');
            const { error } = await supabase.from('feedback_forms').delete().eq('id', formId);
            if (error) throw error;
        },
        onSuccess: async () => {
            toast.success('Form deleted');
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-forms'] });
            await queryClient.invalidateQueries({ queryKey: ['worker-feedback-forms'] });
            navigate("/timesheet/admin/forms");
        },
        onError: (e) => toast.error(e.message || 'Failed to delete form'),
    });

    const handleDeleteForm = async () => {
        const label = title.trim() || 'this form';
        if (
            !(await confirmAction({
                title: 'Delete form?',
                message: `Delete "${label}"? All questions and worker responses will be permanently removed.`,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        ) {
            return;
        }
        deleteForm.mutate();
    };

    const submissions = submissionsQuery.data || [];

    const getResponseQuestionColumns = () => {
        const byText = new Map();
        for (const sub of submissions) {
            for (const r of sub.responses || []) {
                if (!byText.has(r.question_text)) {
                    byText.set(r.question_text, r.sort_order ?? 0);
                }
            }
        }
        return [...byText.entries()]
            .sort((a, b) => a[1] - b[1])
            .map(([text]) => text);
    };

    const exportResponsesExcel = async () => {
        if (!submissions.length) {
            toast.error('No responses to export');
            return;
        }
        const questionColumns = getResponseQuestionColumns();
        const rows = submissions.map((sub) => {
            const answerByQ = new Map((sub.responses || []).map((r) => [r.question_text, r.answer_text]));
            const row = {
                'Worker ID': sub.worker_id,
                Name: sub.employee_name,
                Response: sub.response_number ?? 1,
                Submitted: new Date(sub.submitted_at).toLocaleString(),
            };
            for (const qText of questionColumns) {
                row[qText] = answerByQ.get(qText) ?? '';
            }
            return row;
        });
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Responses');
        const safeTitle = (title || 'form').replace(/[^\w-]+/g, '_').slice(0, 40);
        XLSX.writeFile(wb, `${safeTitle}_rev${revision}_responses.xlsx`);
        toast.success('Responses exported');
    };

    const printResponses = async () => {
        if (!submissions.length) {
            toast.error('No responses to print');
            return;
        }
        const escapeHtml = (value) =>
            String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        const questionColumns = getResponseQuestionColumns();
        const headerCells = questionColumns.map((q) => `<th>${escapeHtml(q)}</th>`).join('');
        const bodyRows = submissions
            .map((sub) => {
                const answerByQ = new Map((sub.responses || []).map((r) => [r.question_text, r.answer_text]));
                const cells = questionColumns
                    .map((q) => `<td>${escapeHtml(answerByQ.get(q) ?? '')}</td>`)
                    .join('');
                return `<tr>
                    <td>${escapeHtml(sub.worker_id)}</td>
                    <td>${escapeHtml(sub.employee_name)}</td>
                    <td>${escapeHtml(sub.response_number ?? 1)}</td>
                    <td>${escapeHtml(new Date(sub.submitted_at).toLocaleString())}</td>
                    ${cells}
                </tr>`;
            })
            .join('');
        const formTitle = escapeHtml(title || 'Form');
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${formTitle} — Responses</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; color: #0f172a; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .meta { color: #64748b; font-size: 0.875rem; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  tr:nth-child(even) td { background: #f8fafc; }
  @media print { body { padding: 12px; } }
</style></head><body>
  <h1>${formTitle}</h1>
  <p class="meta">Revision ${revision} · ${submissions.length} response(s) · Printed ${new Date().toLocaleString()}</p>
  <table>
    <thead><tr><th>Worker ID</th><th>Name</th><th>Response</th><th>Submitted</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body></html>`;
        try {
            const result = await printOrShareHtmlDocument(html, {
                title: 'Print form responses',
                fileName: `Form_Responses_${formId || Date.now()}.pdf`,
                printDelayMs: 300,
            });
            toast.success(
                result?.mode === 'share'
                    ? 'Choose an app to save, print, or share the PDF'
                    : 'Print dialog opened'
            );
        } catch (error) {
            toast.error(error?.message || 'Failed to open print');
        }
    };

    const updateQuestion = (key, patch) => {
        setQuestions((prev) => prev.map((q) => (q._key === key ? { ...q, ...patch } : q)));
    };

    const moveQuestion = (index, dir) => {
        setQuestions((prev) => {
            const next = [...prev];
            const j = index + dir;
            if (j < 0 || j >= next.length) return prev;
            [next[index], next[j]] = [next[j], next[index]];
            return next;
        });
    };

    if (!formId) {
        return (
            <AdminPageShell
                title="Form"
                subtitle="Missing form id"
                icon={ClipboardList}
                tone="teal"
                backTo="AdminForms"
                backAriaLabel="Back to forms"
                maxWidth="max-w-5xl"
            >
                <div className={cn(glassPanel, 'p-6 text-sm text-slate-600')}>
                    This form link is missing an id.{' '}
                    <Link className="font-medium text-teal-700 underline" to={"/timesheet/admin/forms"}>
                        Back to forms
                    </Link>
                </div>
            </AdminPageShell>
        );
    }

    return (
        <AdminPageShell
            title={title || 'Edit form'}
            subtitle={form?.is_published ? `Published · revision ${revision}` : 'Draft'}
            icon={ClipboardList}
            tone="teal"
            backTo="AdminForms"
            backAriaLabel="Back to forms"
            maxWidth="max-w-5xl"
            actions={
                <>
                    <Button
                        variant="outline"
                        className="h-9 rounded-xl border-teal-200 bg-white text-teal-800 hover:bg-teal-50"
                        onClick={() => saveDraft.mutate()}
                        disabled={saveDraft.isPending || publishForm.isPending || deleteForm.isPending}
                    >
                        Save
                    </Button>
                    <Button
                        className="h-9 rounded-xl bg-teal-600 hover:bg-teal-700"
                        onClick={() => publishForm.mutate()}
                        disabled={saveDraft.isPending || publishForm.isPending || deleteForm.isPending}
                    >
                        <Send className="mr-2 h-4 w-4" />
                        {form?.is_published ? 'Republish' : 'Publish'}
                    </Button>
                    <Button
                        variant="outline"
                        className="h-9 rounded-xl border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100"
                        onClick={handleDeleteForm}
                        disabled={deleteForm.isPending || saveDraft.isPending || publishForm.isPending}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                    </Button>
                </>
            }
        >
                <div className={cn(glassPanel, 'space-y-4 p-5')}>
                        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Form details</h2>
                        <Input className={glassInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
                        <Textarea
                            className="rounded-xl border-slate-200"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Description (optional)"
                            rows={2}
                        />
                        {form?.is_published ? (
                            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                Republishing creates a new revision. Workers who already submitted will need to fill the form again.
                            </p>
                        ) : null}
                </div>

                <div className={cn(glassPanel, 'space-y-4 p-5')}>
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Questions</h2>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-xl border-teal-200 text-teal-800 hover:bg-teal-50"
                                onClick={() => setQuestions((prev) => [...prev, newLocalQuestion(prev.length)])}
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add question
                            </Button>
                        </div>
                        {questions.length === 0 ? (
                            <p className="text-sm text-slate-600">No questions yet. Add at least one before publishing.</p>
                        ) : (
                            questions.map((q, index) => (
                                <div key={q._key} className="space-y-3 rounded-2xl border border-teal-100 bg-white/80 p-4">
                                    <div className="flex items-center gap-2">
                                        <GripVertical className="h-4 w-4 text-slate-400" />
                                        <span className="text-xs font-semibold text-teal-700">Q{index + 1}</span>
                                        <div className="ml-auto flex gap-1">
                                            <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={() => moveQuestion(index, -1)} disabled={index === 0}>
                                                <ChevronUp className="h-4 w-4" />
                                            </Button>
                                            <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1}>
                                                <ChevronDown className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-11 w-11 text-red-600"
                                                onClick={() => setQuestions((prev) => prev.filter((x) => x._key !== q._key))}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <Input
                                        className={glassInput}
                                        value={q.question_text}
                                        onChange={(e) => updateQuestion(q._key, { question_text: e.target.value })}
                                        placeholder="Question text"
                                    />
                                    <Select
                                        value={q.question_type}
                                        onValueChange={(v) => updateQuestion(q._key, { question_type: v })}
                                    >
                                        <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {QUESTION_TYPES.map((t) => (
                                                <SelectItem key={t.value} value={t.value}>
                                                    {t.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <label className="flex items-center gap-2 text-sm text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={q.is_required}
                                            onChange={(e) => updateQuestion(q._key, { is_required: e.target.checked })}
                                        />
                                        Required
                                    </label>
                                </div>
                            ))
                        )}
                </div>

                {form?.is_published ? (
                    <div className={cn(glassPanel, 'p-5')}>
                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                <Users className="h-5 w-5 text-teal-600" />
                                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                                    Responses (revision {revision})
                                </h2>
                                <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100">{submissions.length} submitted</Badge>
                                {submissions.length > 0 ? (
                                    <div className="ml-auto flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="rounded-xl border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                                            onClick={exportResponsesExcel}
                                        >
                                            <Download className="mr-1.5 h-4 w-4" />
                                            Export Excel
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="rounded-xl border-sky-200 text-sky-800 hover:bg-sky-50"
                                            onClick={printResponses}
                                        >
                                            <Printer className="mr-1.5 h-4 w-4" />
                                            Print
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                            {submissionsQuery.isLoading ? (
                                <p className="text-sm text-slate-600">Loading responses…</p>
                            ) : submissions.length === 0 ? (
                                <p className="text-sm text-slate-600">No submissions yet for this revision.</p>
                            ) : (
                                <div className="space-y-2">
                                    {submissions.map((sub) => {
                                        const open = expandedWorker === sub.id;
                                        return (
                                            <div key={sub.id} className="overflow-hidden rounded-2xl border border-teal-100 bg-white/80">
                                                <button
                                                    type="button"
                                                    className="flex min-h-11 w-full flex-col gap-1 px-4 py-3 text-left hover:bg-teal-50/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                                                    onClick={() => setExpandedWorker(open ? null : sub.id)}
                                                >
                                                    <span className="min-w-0 font-medium text-slate-900">
                                                        {sub.employee_name}{' '}
                                                        <span className="font-normal text-slate-500">
                                                            (ID: {sub.worker_id}) · Response {sub.response_number ?? 1}
                                                        </span>
                                                    </span>
                                                    <span className="flex items-center gap-2 text-xs text-slate-500">
                                                        {new Date(sub.submitted_at).toLocaleString()}
                                                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                    </span>
                                                </button>
                                                {open ? (
                                                    <div className="space-y-3 border-t border-teal-50 bg-teal-50/40 px-4 py-3">
                                                        {sub.responses.map((r, i) => (
                                                            <div key={r.question_id || i}>
                                                                <p className="text-xs font-semibold text-slate-500">{r.question_text}</p>
                                                                <p className="mt-0.5 text-sm text-slate-800">{r.answer_text}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                    </div>
                ) : null}
        </AdminPageShell>
    );
}
