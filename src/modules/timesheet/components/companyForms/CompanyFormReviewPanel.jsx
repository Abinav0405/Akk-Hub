import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2, Pencil, XCircle } from 'lucide-react';
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

    const selectedRows = rows.filter((row) => selectedIds.has(row.id));
    const allSelected = rows.length > 0 && selectedRows.length === rows.length;

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
                    {rows.length > 0 && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-xl"
                                onClick={() =>
                                    setSelectedIds(
                                        allSelected ? new Set() : new Set(rows.map((row) => row.id))
                                    )
                                }
                            >
                                {allSelected ? 'Clear selection' : 'Select all'}
                            </Button>
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

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-500">
                    No submissions in this filter.
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map((row) => (
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
