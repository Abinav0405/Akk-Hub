import React, { useMemo, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { FieldBlock, ChecklistItemButtons } from '@/modules/timesheet/components/companyForms/FormFieldControls';
import FormTableEditor, { buildInitialTableRows } from '@/modules/timesheet/components/companyForms/FormTableEditor';
import { evaluateFormFlags, LAYOUT } from '@/modules/timesheet/lib/companyForms';
import { getTodaySingapore } from '@/modules/timesheet/lib/timeUtils';
import { glassPanel } from '@/ui/glass';
import { cn } from '@/modules/timesheet/lib/utils';
import { toast } from 'sonner';

function buildInitialFields(def, workerName) {
    const fields = {};
    const all = [...(def.fields || []), ...(def.extraFields || [])];
    for (const field of all) {
        if (field.auto === 'worker_name') {
            fields[field.key] = workerName || '';
        } else if (field.type === 'date') {
            fields[field.key] = getTodaySingapore();
        } else {
            fields[field.key] = '';
        }
    }
    return fields;
}

function validateFields(fieldDefs, values) {
    for (const field of fieldDefs) {
        if (field.required === false) continue;
        const v = values[field.key];
        if (v == null || String(v).trim() === '') {
            return `${field.label} is required`;
        }
    }
    return null;
}

export default function CompanyFormFiller({
    definition,
    workerName,
    onSubmit,
    submitting = false,
    /** Pre-fill from an existing submission (manager/admin edit-before-approve). */
    initialPayload = null,
    submitLabel = 'Submit for review',
    reviewTitle = 'Review & submit',
    reviewHint = 'Check your answers before sending to managers/admins.',
}) {
    const [fields, setFields] = useState(() => {
        const base = buildInitialFields(definition, workerName);
        if (initialPayload?.fields && typeof initialPayload.fields === 'object') {
            return { ...base, ...initialPayload.fields };
        }
        return base;
    });
    const [checklist, setChecklist] = useState(() =>
        initialPayload?.checklist && typeof initialPayload.checklist === 'object'
            ? { ...initialPayload.checklist }
            : {}
    );
    const [tableRows, setTableRows] = useState(() => {
        if (Array.isArray(initialPayload?.tableRows) && initialPayload.tableRows.length) {
            return initialPayload.tableRows.map((row) => ({ ...row }));
        }
        return buildInitialTableRows(definition.table);
    });
    const [step, setStep] = useState(0);

    const isChecklist = definition.layout === LAYOUT.CHECKLIST_STEPS;
    const sections = definition.sections || [];
    // steps: header fields → each section → extras → review
    const totalSteps = isChecklist
        ? 1 + sections.length + (definition.extraFields?.length ? 1 : 0) + 1
        : 1;

    const reviewStepIndex = totalSteps - 1;

    const setField = (key, value) => {
        setFields((prev) => ({ ...prev, [key]: value }));
    };

    const payload = useMemo(
        () => ({ fields, checklist, tableRows }),
        [fields, checklist, tableRows]
    );

    const previewFlags = useMemo(
        () => evaluateFormFlags(definition.key, payload),
        [definition.key, payload]
    );

    const goNext = () => {
        if (step === 0) {
            const err = validateFields(definition.fields || [], fields);
            if (err) {
                toast.error(err);
                return;
            }
        } else if (isChecklist && step >= 1 && step <= sections.length) {
            const sec = sections[step - 1];
            for (const item of sec.items) {
                if (!checklist[item.key]) {
                    toast.error(`Answer all items in ${sec.title}`);
                    return;
                }
            }
        } else if (
            isChecklist &&
            definition.extraFields?.length &&
            step === 1 + sections.length
        ) {
            const err = validateFields(definition.extraFields, fields);
            if (err) {
                toast.error(err);
                return;
            }
        }
        setStep((s) => Math.min(reviewStepIndex, s + 1));
    };

    const handleSubmit = async () => {
        if (!isChecklist) {
            const err = validateFields(
                [...(definition.fields || []), ...(definition.extraFields || [])],
                fields
            );
            if (err) {
                toast.error(err);
                return;
            }
            if (definition.table) {
                const min = definition.table.minRows || 1;
                if (!tableRows.length || tableRows.length < min) {
                    toast.error(`Add at least ${min} row(s) in ${definition.table.label}`);
                    return;
                }
                for (let i = 0; i < tableRows.length; i += 1) {
                    for (const col of definition.table.columns) {
                        const v = tableRows[i][col.key];
                        if (v == null || String(v).trim() === '') {
                            toast.error(`Row ${i + 1}: ${col.label} is required`);
                            return;
                        }
                    }
                }
            }
        } else {
            for (const sec of sections) {
                for (const item of sec.items) {
                    if (!checklist[item.key]) {
                        toast.error(`Incomplete checklist: ${item.label}`);
                        return;
                    }
                }
            }
            if (definition.extraFields?.length) {
                const err = validateFields(definition.extraFields, fields);
                if (err) {
                    toast.error(err);
                    return;
                }
            }
        }

        await onSubmit(payload);
    };

    const renderHeaderFields = () => (
        <div className="grid gap-4 sm:grid-cols-2">
            {(definition.fields || []).map((field) => (
                <FieldBlock
                    key={field.key}
                    field={field}
                    value={fields[field.key]}
                    onChange={(v) => setField(field.key, v)}
                />
            ))}
        </div>
    );

    const renderSection = (sec) => (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-semibold text-slate-900">{sec.title}</h3>
                <p className="text-sm text-slate-500">
                    {definition.answerMode === 'done_pending'
                        ? 'Mark each item Done or Pending'
                        : 'Mark each item OK or NOT OK'}
                </p>
            </div>
            {sec.items.map((item) => (
                <div key={item.key} className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
                    <p className="text-sm font-medium text-slate-800">{item.label}</p>
                    <ChecklistItemButtons
                        answerMode={definition.answerMode || 'ok_not_ok'}
                        value={checklist[item.key]}
                        onChange={(v) =>
                            setChecklist((prev) => ({ ...prev, [item.key]: v }))
                        }
                    />
                </div>
            ))}
        </div>
    );

    const renderExtras = () => (
        <div className="grid gap-4 sm:grid-cols-2">
            {(definition.extraFields || []).map((field) => (
                <FieldBlock
                    key={field.key}
                    field={field}
                    value={fields[field.key]}
                    onChange={(v) => setField(field.key, v)}
                />
            ))}
        </div>
    );

    const renderReview = () => (
        <div className="space-y-4">
            <div>
                <h3 className="text-base font-semibold text-slate-900">{reviewTitle}</h3>
                <p className="text-sm text-slate-500">{reviewHint}</p>
            </div>
            {previewFlags.is_flagged && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <Badge className="bg-red-600">Flagged</Badge>
                    <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
                        {previewFlags.flag_reasons.map((r) => (
                            <li key={r}>{r}</li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700 space-y-1">
                {(definition.fields || []).map((field) => (
                    <p key={field.key}>
                        <span className="text-slate-500">{field.label}: </span>
                        {String(fields[field.key] || '—')}
                    </p>
                ))}
                {(definition.extraFields || []).map((field) => (
                    <p key={field.key}>
                        <span className="text-slate-500">{field.label}: </span>
                        {String(fields[field.key] || '—')}
                    </p>
                ))}
            </div>
            {isChecklist && (
                <p className="text-sm text-slate-600">
                    Checklist answers: {Object.keys(checklist).length} items recorded
                </p>
            )}
            {definition.table && (
                <p className="text-sm text-slate-600">
                    {definition.table.label}: {tableRows.length} row(s)
                </p>
            )}
        </div>
    );

    let body = null;
    if (!isChecklist) {
        body = (
            <div className="space-y-6">
                {renderHeaderFields()}
                {definition.table && (
                    <FormTableEditor
                        table={definition.table}
                        rows={tableRows}
                        onChange={setTableRows}
                    />
                )}
                {renderReview()}
            </div>
        );
    } else if (step === 0) {
        body = renderHeaderFields();
    } else if (step >= 1 && step <= sections.length) {
        body = renderSection(sections[step - 1]);
    } else if (definition.extraFields?.length && step === 1 + sections.length) {
        body = renderExtras();
    } else {
        body = renderReview();
    }

    const onReviewStep = !isChecklist || step === reviewStepIndex;

    return (
        <div className={cn(glassPanel, 'min-w-0 overflow-x-hidden p-4 sm:p-6 space-y-5')}>
            {isChecklist && (
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                        Step {step + 1} of {totalSteps}
                    </span>
                    <div className="h-1.5 flex-1 max-w-xs overflow-hidden rounded-full bg-slate-200">
                        <div
                            className="h-full rounded-full bg-[#dc6b2f] transition-all"
                            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {body}

            <div className="flex flex-wrap gap-2 pt-2">
                {isChecklist && step > 0 && (
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl"
                        onClick={() => setStep((s) => s - 1)}
                        disabled={submitting}
                    >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Back
                    </Button>
                )}
                {isChecklist && !onReviewStep && (
                    <Button
                        type="button"
                        className="ml-auto h-11 rounded-xl bg-slate-900 hover:bg-slate-800"
                        onClick={goNext}
                    >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                )}
                {onReviewStep && (
                    <Button
                        type="button"
                        className="ml-auto h-11 rounded-xl bg-[#dc6b2f] hover:bg-[#c45f28]"
                        disabled={submitting}
                        onClick={() => void handleSubmit()}
                    >
                        {submitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="mr-2 h-4 w-4" />
                        )}
                        {submitLabel}
                    </Button>
                )}
            </div>
        </div>
    );
}
