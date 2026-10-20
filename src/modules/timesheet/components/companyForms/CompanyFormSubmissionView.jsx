import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/ui/badge';
import {
    getFormDefinition,
    getResolvedFormDefinition,
    getDepartmentLabel,
    riskBand,
} from '@/modules/timesheet/lib/companyForms';
import { glassPanel } from '@/ui/glass';
import { cn } from '@/modules/timesheet/lib/utils';

function StatusBadge({ status }) {
    if (status === 'approved') return <Badge className="bg-emerald-600">Approved</Badge>;
    if (status === 'rejected') return <Badge variant="destructive">Rejected</Badge>;
    return <Badge className="bg-amber-500">Pending</Badge>;
}

export default function CompanyFormSubmissionView({ submission }) {
    if (!submission) return null;

    const hasSnapshot = Boolean(submission.definition_snapshot);
    const { data: resolved } = useQuery({
        queryKey: ['company-form-definition', submission.form_key],
        queryFn: () => getResolvedFormDefinition(submission.form_key),
        enabled: !hasSnapshot,
        staleTime: 60_000,
    });
    const def = submission.definition_snapshot || resolved || getFormDefinition(submission.form_key);
    const fields = submission.payload?.fields || {};
    const checklist = submission.payload?.checklist || {};
    const tableRows = submission.payload?.tableRows || [];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">
                    {def?.title || submission.form_key}
                </h2>
                <StatusBadge status={submission.status} />
                {submission.is_flagged && <Badge className="bg-red-600">Flagged</Badge>}
                {submission.recommended_result ? (
                    <Badge variant="secondary" className="max-w-full truncate">
                        {submission.recommended_result}
                    </Badge>
                ) : null}
            </div>
            <p className="text-sm text-slate-500">
                {getDepartmentLabel(submission.department)} · {submission.worker_name} ({submission.worker_id})
            </p>
            {submission.recommended_result ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <span className="font-semibold">Recommended result: </span>
                    {submission.recommended_result}
                </div>
            ) : null}

            {submission.is_flagged && submission.flag_reasons?.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-semibold">Flag reasons</p>
                    <ul className="mt-1 list-disc pl-5">
                        {submission.flag_reasons.map((r) => (
                            <li key={r}>{r}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className={cn(glassPanel, 'p-4 space-y-2')}>
                <h3 className="text-sm font-semibold text-slate-800">Fields</h3>
                {(def?.fields || Object.keys(fields).map((k) => ({ key: k, label: k }))).map((field) => (
                    <p key={field.key} className="text-sm text-slate-700">
                        <span className="text-slate-500">{field.label}: </span>
                        {String(fields[field.key] ?? '—')}
                    </p>
                ))}
                {(def?.extraFields || []).map((field) => (
                    <p key={field.key} className="text-sm text-slate-700">
                        <span className="text-slate-500">{field.label}: </span>
                        {String(fields[field.key] ?? '—')}
                    </p>
                ))}
            </div>

            {def?.sections?.length > 0 && (
                <div className={cn(glassPanel, 'p-4 space-y-3')}>
                    <h3 className="text-sm font-semibold text-slate-800">Checklist</h3>
                    {def.sections.map((sec) => (
                        <div key={sec.key}>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {sec.title}
                            </p>
                            <ul className="space-y-1">
                                {sec.items.map((item) => {
                                    const ans = checklist[item.key];
                                    const bad = ans === 'not_ok' || ans === 'pending';
                                    return (
                                        <li
                                            key={item.key}
                                            className={cn(
                                                'flex justify-between gap-2 rounded-lg px-2 py-1 text-sm',
                                                bad && 'bg-red-50 text-red-800'
                                            )}
                                        >
                                            <span>{item.label}</span>
                                            <span className="font-semibold uppercase">
                                                {ans === 'ok'
                                                    ? 'OK'
                                                    : ans === 'not_ok'
                                                      ? 'NOT OK'
                                                      : ans === 'done'
                                                        ? 'Done'
                                                        : ans === 'pending'
                                                          ? 'Pending'
                                                          : '—'}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {def?.table && tableRows.length > 0 && (
                <div className={cn(glassPanel, 'p-4 space-y-3')}>
                    <h3 className="text-sm font-semibold text-slate-800">{def.table.label}</h3>
                    {tableRows.map((row, i) => {
                        const rating =
                            def.table.computed?.risk_rating === 'likelihood_x_severity'
                                ? riskBand(row.likelihood, row.severity)
                                : null;
                        return (
                            <div
                                key={`r-${i}`}
                                className={cn(
                                    'rounded-xl border border-slate-200 p-3 text-sm space-y-1',
                                    rating?.band === 'High' && 'border-red-300 bg-red-50/50'
                                )}
                            >
                                <p className="text-xs font-medium text-slate-500">Row {i + 1}</p>
                                {def.table.columns.map((col) => (
                                    <p key={col.key}>
                                        <span className="text-slate-500">{col.label}: </span>
                                        {String(row[col.key] ?? '—')}
                                    </p>
                                ))}
                                {rating?.score != null && (
                                    <p>
                                        Risk: {rating.score} ({rating.band})
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {submission.reviewed_at && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p>
                        Reviewed by {submission.reviewed_by} ({submission.reviewed_by_role}) on{' '}
                        {new Date(submission.reviewed_at).toLocaleString('en-SG', {
                            timeZone: 'Asia/Singapore',
                        })}
                    </p>
                    {submission.recommended_result && (
                        <p className="mt-1">
                            <span className="text-slate-500">Recommended result: </span>
                            {submission.recommended_result}
                        </p>
                    )}
                    {submission.review_note && (
                        <p className="mt-1">
                            <span className="text-slate-500">Note: </span>
                            {submission.review_note}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
