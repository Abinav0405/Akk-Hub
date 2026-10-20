// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useState } from 'react';
import { storageKey } from '@/core/storage';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import CompanyFormPrintActions from '@/modules/timesheet/components/companyForms/CompanyFormPrintActions';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import CompanyFormSubmissionView from '@/modules/timesheet/components/companyForms/CompanyFormSubmissionView';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { cn } from '@/modules/timesheet/lib/utils';
import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import { getFormDefinition, listFormModules, listWorkerSubmissions } from '@/modules/timesheet/lib/companyForms';

const NATIVE_APP = isNativeApp();

export default function WorkerCompanyFormHistory() {
    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim()
    );
    const [viewRow, setViewRow] = useState(null);
    const [selectedIds, setSelectedIds] = useState(() => new Set());

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
            }
        });
    }, []);

    const {
        data: rows = [],
        isLoading,
        isError,
        error,
        refetch,
        isRefetching,
    } = useQuery({
        queryKey: ['worker-company-forms', workerId],
        enabled: !!workerId,
        queryFn: () => listWorkerSubmissions(workerId),
    });

    const { data: modules = [] } = useQuery({
        queryKey: ['company-form-modules'],
        queryFn: listFormModules,
        staleTime: 60_000,
    });

    const titleFor = (row) =>
        row.definition_snapshot?.title ||
        modules.find((m) => m.form_key === row.form_key)?.definition?.title ||
        getFormDefinition(row.form_key)?.title ||
        row.form_key;

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

    const toggleAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
    };

    return (
        <WorkerPageShell title="My form submissions" subtitle="Status of forms you sent for review">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Link to={"/timesheet/company-forms"}>
                    <Button variant="outline" className="h-10 rounded-xl">
                        Fill a new form
                    </Button>
                </Link>
                {rows.length > 0 && (
                    <>
                        <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={toggleAll}>
                            {allSelected ? 'Clear selection' : 'Select all'}
                        </Button>
                        <CompanyFormPrintActions submissions={selectedRows} disabled={!selectedRows.length} />
                    </>
                )}
            </div>

            {NATIVE_APP && isLoading ? (
                <NativeListSkeleton rows={3} label="Loading submissions" />
            ) : NATIVE_APP && isError && !rows.length ? (
                <NativeErrorState
                    error={error}
                    onRetry={() => refetch()}
                    retrying={isRefetching}
                />
            ) : NATIVE_APP && !isLoading && rows.length === 0 ? (
                <NativeEmptyState
                    icon={ClipboardList}
                    title="No submissions yet"
                    message="Fill a company form and it will show up here."
                />
            ) : isLoading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : rows.length === 0 ? (
                <div className={cn(glassPanel, 'p-8 text-center text-sm text-slate-500')}>
                    No submissions yet.
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map((row) => {
                        return (
                            <div
                                key={row.id}
                                className={cn(
                                    glassPanel,
                                    'flex w-full items-start gap-3 p-4 hover:bg-white/80'
                                )}
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
                                    onClick={() => setViewRow(row)}
                                    className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                                >
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-900">{titleFor(row)}</p>
                                        <p className="text-xs text-slate-500">
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
                        );
                    })}
                </div>
            )}

            <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
                <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Submission detail</DialogTitle>
                    </DialogHeader>
                    {viewRow && (
                        <div className="space-y-4">
                            <CompanyFormPrintActions submissions={[viewRow]} />
                            <CompanyFormSubmissionView submission={viewRow} />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </WorkerPageShell>
    );
}
