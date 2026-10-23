import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, CheckCheck, Loader2, Pencil, Search, XCircle } from 'lucide-react';
import CompanyFormPrintActions from '@/modules/timesheet/components/companyForms/CompanyFormPrintActions';
import CompanyFormFiller from '@/modules/timesheet/components/companyForms/CompanyFormFiller';
import { toast } from 'sonner';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/select';
import CompanyFormSubmissionView from '@/modules/timesheet/components/companyForms/CompanyFormSubmissionView';
import { glassPanel, glassInput } from '@/ui/glass';
import { cn } from '@/modules/timesheet/lib/utils';
import {
    getFormDefinition,
    listFormModules,
    listReviewSubmissions,
    reviewSubmission,
    updatePendingSubmission,
    getRecommendedResultOptions,
    SUBMISSION_STATUS,
} from '@/modules/timesheet/lib/companyForms';

export default function CompanyFormReviewPanel({
    reviewerName,
    reviewerRole,
    compact = false,
}) {
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState('pending');
    const [selected, setSelected] = useState(null);
    const [editing, setEditing] = useState(false);
    const [decisionOpen, setDecisionOpen] = useState(null); // 'approved' | 'rejected' | null
    const [recommendedResult, setRecommendedResult] = useState('');
    const [rejectNote, setRejectNote] = useState('');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [q, setQ] = useState('');
    const [formFilter, setFormFilter] = useState('');
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkResult, setBulkResult] = useState('');
    const [bulkNote, setBulkNote] = useState('');
    const [bulkProgress, setBulkProgress] = useState(null);

    const { data: rows = [], isLoading } = useQuery({
        queryKey: ['company-form-review', statusFilter],
        queryFn: () => listReviewSubmissions({ status: statusFilter, limit: 120 }),
        refetchInterval: 30_000,
    });

    const { data: modules = [] } = useQuery({
        queryKey: ['company-form-modules'],
        queryFn: listFormModules,
        staleTime: 60_000,
    });

    const { data: resultOptions = [] } = useQuery({
        queryKey: ['company-form-recommended-results'],
        queryFn: getRecommendedResultOptions,
        staleTime: 60_000,
    });

    const titleFor = (row) =>
        row.definition_snapshot?.title ||
        modules.find((m) => m.form_key === row.form_key)?.definition?.title ||
        getFormDefinition(row.form_key)?.title ||
        row.form_key;

    const editDefinition =
        selected?.definition_snapshot ||
        modules.find((m) => m.form_key === selected?.form_key)?.definition ||
        getFormDefinition(selected?.form_key);

    const formOptions = useMemo(() => {
        const m = new Map();
        for (const r of rows) if (!m.has(r.form_key)) m.set(r.form_key, titleFor(r));
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, modules]);
    const term = q.trim().toLowerCase();
    const visible = rows.filter(
        (r) =>
            (!formFilter || r.form_key === formFilter) &&
            (!flaggedOnly || r.is_flagged) &&
            (!term || `${r.worker_name} ${r.worker_id} ${titleFor(r)}`.toLowerCase().includes(term)),
    );
    const flaggedCount = rows.filter((r) => r.is_flagged && r.status === 'pending').length;
    const selectedRows = visible.filter((row) => selectedIds.has(row.id));
    const allSelected = visible.length > 0 && selectedRows.length === visible.length;
    const bulkRows = selectedRows.filter((r) => r.status === 'pending');

    const runBulkApprove = async () => {
        setBulkProgress({ done: 0, total: bulkRows.length, failed: 0 });
        let failed = 0;
        for (let i = 0; i < bulkRows.length; i += 1) {
            try {
                await reviewSubmission({
                    id: bulkRows[i].id,
                    status: SUBMISSION_STATUS.APPROVED,
                    reviewedBy: reviewerName || reviewerRole,
                    reviewedByRole: reviewerRole,
                    reviewNote: bulkNote.trim() || null,
                    recommendedResult: bulkResult,
                });
            } catch {
                failed += 1;
            }
            setBulkProgress({ done: i + 1, total: bulkRows.length, failed });
        }
        if (failed) toast.error(`${failed} could not be approved — open them one by one`);
        else toast.success(`Approved ${bulkRows.length} form${bulkRows.length === 1 ? '' : 's'}`);
        setBulkOpen(false);
        setBulkProgress(null);
        setBulkNote('');
        setSelectedIds(new Set());
        invalidate();
    };

    const toggleRow = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['company-form-review'] });
        queryClient.invalidateQueries({ queryKey: ['worker-company-forms'] });
        queryClient.invalidateQueries({ queryKey: ['company-form-pending-count'] });
    };

    const closeDecision = () => {
        setDecisionOpen(null);
        setRecommendedResult('');
        setRejectNote('');
    };

    const openDecision = (status) => {
        setRecommendedResult('');
        setRejectNote('');
        setDecisionOpen(status);
    };

    const openSelected = (row) => {
        setSelected(row);
        setEditing(false);
        closeDecision();
    };

    const reviewMut = useMutation({
        mutationFn: ({ id, status, reviewNote, recommendedResult: result }) =>
            reviewSubmission({
                id,
                status,
                reviewedBy: reviewerName || reviewerRole,
                reviewedByRole: reviewerRole,
                reviewNote,
                recommendedResult: result,
            }),
        onSuccess: (_data, vars) => {
            toast.success(vars.status === 'approved' ? 'Form approved' : 'Form rejected');
            setSelected(null);
            setEditing(false);
            closeDecision();
            invalidate();
        },
        onError: (e) => toast.error(e.message || 'Review failed'),
    });

    const editMut = useMutation({
        mutationFn: ({ id, payload }) => updatePendingSubmission({ id, payload }),
        onSuccess: (row) => {
            toast.success('Form updated');
            setSelected(row);
            setEditing(false);
            invalidate();
        },
        onError: (e) => toast.error(e.message || 'Could not save edits'),
    });

    const canConfirm =
        Boolean(recommendedResult) &&
        (decisionOpen !== SUBMISSION_STATUS.REJECTED || Boolean(rejectNote.trim()));

    return (
        <section className={cn(glassPanel, compact ? 'p-4' : 'p-4 sm:p-5')}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                        Company form review
                    </h2>
                    <p className="text-xs text-slate-500">
                        Flagged pending forms appear first. Edit pending forms before approving, then pick a
                        recommended result when you approve or reject.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {visible.length > 0 && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-xl"
                                onClick={() =>
                                    setSelectedIds(
                                        allSelected ? new Set() : new Set(visible.map((row) => row.id))
                                    )
                                }
                            >
                                {allSelected ? 'Clear selection' : `Select all (${visible.length})`}
                            </Button>
                            {bulkRows.length > 0 && (
                                <Button
                                    type="button"
                                    className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => {
                                        setBulkResult('');
                                        setBulkOpen(true);
                                    }}
                                >
                                    <CheckCheck className="mr-1.5 h-4 w-4" />
                                    Approve {bulkRows.length}
                                </Button>
                            )}
                            <CompanyFormPrintActions
                                submissions={selectedRows}
                                disabled={!selectedRows.length}
                            />
                        </>
                    )}
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className={cn(glassInput, 'w-[180px]')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                            <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search worker name, ID or form"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm"
                        aria-label="Search submissions"
                    />
                </div>
                <select
                    value={formFilter}
                    onChange={(e) => setFormFilter(e.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm sm:max-w-[240px]"
                    aria-label="Filter by form"
                >
                    <option value="">All forms</option>
                    {formOptions.map(([key, title]) => (
                        <option key={key} value={key}>
                            {title}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    aria-pressed={flaggedOnly}
                    onClick={() => setFlaggedOnly((v) => !v)}
                    className={cn(
                        'h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold',
                        flaggedOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600',
                    )}
                >
                    Flagged only{flaggedCount ? ` (${flaggedCount})` : ''}
                </button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                </div>
            ) : visible.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-500">
                    {rows.length ? 'Nothing matches your search or filters.' : 'No submissions in this filter.'}
                </div>
            ) : (
                <div className="space-y-2">
                    {visible.map((row) => (
                        <div
                            key={row.id}
                            className="flex w-full items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-3 hover:bg-white"
                        >
                            <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                                checked={selectedIds.has(row.id)}
                                onChange={() => toggleRow(row.id)}
                                aria-label={`Select ${titleFor(row)}`}
                            />
                            <button
                                type="button"
                                onClick={() => openSelected(row)}
                                className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                            >
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-900">{titleFor(row)}</p>
                                    <p className="text-xs text-slate-500">
                                        {row.worker_name} · {row.worker_id} ·{' '}
                                        {new Date(row.created_at).toLocaleString('en-SG', {
                                            timeZone: 'Asia/Singapore',
                                        })}
                                    </p>
                                    {row.recommended_result ? (
                                        <p className="mt-1 text-xs font-medium text-slate-700">
                                            Result: {row.recommended_result}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    {row.is_flagged && <Badge className="bg-red-600">Flagged</Badge>}
                                    <Badge
                                        className={
                                            row.status === 'approved'
                                                ? 'bg-emerald-600'
                                                : row.status === 'rejected'
                                                  ? 'bg-red-600'
                                                  : 'bg-amber-500'
                                        }
                                    >
                                        {row.status}
                                    </Badge>
                                </div>
                            </button>
                            <CompanyFormPrintActions submissions={[row]} compact />
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={bulkOpen} onOpenChange={(o) => !o && !bulkProgress && setBulkOpen(false)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Approve {bulkRows.length} form{bulkRows.length === 1 ? '' : 's'}</DialogTitle>
                        <DialogDescription>
                            The same recommended result is recorded on each one.
                            {bulkRows.some((r) => r.is_flagged) ? ' Some of these are flagged — make sure you have looked at them.' : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Select value={bulkResult || undefined} onValueChange={setBulkResult}>
                            <SelectTrigger className={glassInput}>
                                <SelectValue placeholder="Select result…" />
                            </SelectTrigger>
                            <SelectContent>
                                {resultOptions.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {opt}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="Comment (optional)" className={glassInput} />
                        {bulkProgress ? (
                            <p className="text-sm text-slate-600">
                                Approving {bulkProgress.done} of {bulkProgress.total}…
                            </p>
                        ) : null}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={Boolean(bulkProgress)}>
                            Cancel
                        </Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!bulkResult || Boolean(bulkProgress)} onClick={() => void runBulkApprove()}>
                            {bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
                            Approve all
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!selected}
                onOpenChange={(o) => {
                    if (!o) {
                        setSelected(null);
                        setEditing(false);
                        closeDecision();
                    }
                }}
            >
                <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? 'Edit pending submission' : 'Review submission'}
                        </DialogTitle>
                        {editing ? (
                            <DialogDescription>
                                Correct the submitted answers, then save. Approve or reject after you finish
                                editing.
                            </DialogDescription>
                        ) : null}
                    </DialogHeader>
                    {selected && editing && editDefinition ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs text-slate-500">
                                    Editing while pending — changes are locked after approve/reject.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-xl"
                                    disabled={editMut.isPending}
                                    onClick={() => setEditing(false)}
                                >
                                    Cancel edit
                                </Button>
                            </div>
                            <CompanyFormFiller
                                key={`${selected.id}-edit`}
                                definition={editDefinition}
                                workerName={selected.worker_name}
                                initialPayload={selected.payload || {}}
                                submitting={editMut.isPending}
                                submitLabel="Save changes"
                                reviewTitle="Review changes"
                                reviewHint="Confirm the corrected answers, then save. You can still approve or reject afterward."
                                onSubmit={(payload) =>
                                    editMut.mutateAsync({ id: selected.id, payload })
                                }
                            />
                        </div>
                    ) : selected ? (
                        <div className="space-y-4">
                            <CompanyFormPrintActions submissions={[selected]} />
                            <CompanyFormSubmissionView submission={selected} />
                        </div>
                    ) : null}
                    {selected?.status === 'pending' && !editing && (
                        <DialogFooter className="gap-2 sm:justify-between">
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                disabled={reviewMut.isPending || !editDefinition}
                                onClick={() => setEditing(true)}
                            >
                                <Pencil className="mr-1.5 h-4 w-4" />
                                Edit form
                            </Button>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="destructive"
                                    className="rounded-xl"
                                    disabled={reviewMut.isPending}
                                    onClick={() => openDecision(SUBMISSION_STATUS.REJECTED)}
                                >
                                    <XCircle className="mr-1.5 h-4 w-4" />
                                    Reject
                                </Button>
                                <Button
                                    type="button"
                                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                    disabled={reviewMut.isPending}
                                    onClick={() => openDecision(SUBMISSION_STATUS.APPROVED)}
                                >
                                    <CheckCircle className="mr-1.5 h-4 w-4" />
                                    Approve
                                </Button>
                            </div>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={!!decisionOpen} onOpenChange={(o) => !o && closeDecision()}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {decisionOpen === SUBMISSION_STATUS.REJECTED
                                ? 'Reject form'
                                : 'Approve form'}
                        </DialogTitle>
                        <DialogDescription>
                            Choose the recommended result for this submission.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                Recommended result <span className="text-red-500">*</span>
                            </label>
                            <Select value={recommendedResult || undefined} onValueChange={setRecommendedResult}>
                                <SelectTrigger className={glassInput}>
                                    <SelectValue placeholder="Select result…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {resultOptions.map((opt) => (
                                        <SelectItem key={opt} value={opt}>
                                            {opt}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {decisionOpen === SUBMISSION_STATUS.REJECTED && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Rejection reason <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    className={glassInput}
                                    placeholder="Why is this rejected?"
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                />
                            </div>
                        )}

                        {decisionOpen === SUBMISSION_STATUS.APPROVED && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Note (optional)
                                </label>
                                <Input
                                    className={glassInput}
                                    placeholder="Conditions or comments"
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                />
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeDecision}>
                            Cancel
                        </Button>
                        <Button
                            className={
                                decisionOpen === SUBMISSION_STATUS.REJECTED
                                    ? undefined
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                            }
                            variant={
                                decisionOpen === SUBMISSION_STATUS.REJECTED
                                    ? 'destructive'
                                    : 'default'
                            }
                            disabled={reviewMut.isPending || !canConfirm || !selected}
                            onClick={() =>
                                selected &&
                                reviewMut.mutate({
                                    id: selected.id,
                                    status: decisionOpen,
                                    reviewNote: rejectNote,
                                    recommendedResult,
                                })
                            }
                        >
                            {reviewMut.isPending ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : null}
                            Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
