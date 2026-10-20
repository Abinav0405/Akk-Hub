import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { glassPanel, glassInput } from '@/ui/glass';
import { cn } from '@/modules/timesheet/lib/utils';
import {
    DEPARTMENTS,
    getDepartmentLabel,
    listFormModules,
    resolveFormDefinition,
    saveFormQuestions,
    resetFormQuestions,
} from '@/modules/timesheet/lib/companyForms';

function LabelInput({ label, value, onChange, hint }) {
    return (
        <div className="space-y-1">
            {hint ? <p className="text-[11px] font-mono text-slate-400">{hint}</p> : null}
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
            </label>
            <Input
                className={glassInput}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}

function EditorBody({ definition, onChange }) {
    if (!definition) return null;

    const setTitle = (title) => onChange({ ...definition, title });

    const setFieldLabel = (group, key, label) => {
        onChange({
            ...definition,
            [group]: (definition[group] || []).map((f) =>
                f.key === key ? { ...f, label } : f
            ),
        });
    };

    const setSectionTitle = (secKey, title) => {
        onChange({
            ...definition,
            sections: (definition.sections || []).map((s) =>
                s.key === secKey ? { ...s, title } : s
            ),
        });
    };

    const setItemLabel = (secKey, itemKey, label) => {
        onChange({
            ...definition,
            sections: (definition.sections || []).map((s) =>
                s.key === secKey
                    ? {
                          ...s,
                          items: s.items.map((it) =>
                              it.key === itemKey ? { ...it, label } : it
                          ),
                      }
                    : s
            ),
        });
    };

    const setTableLabel = (label) => {
        onChange({
            ...definition,
            table: { ...definition.table, label },
        });
    };

    const setColumnLabel = (colKey, label) => {
        onChange({
            ...definition,
            table: {
                ...definition.table,
                columns: definition.table.columns.map((c) =>
                    c.key === colKey ? { ...c, label } : c
                ),
            },
        });
    };

    return (
        <div className="space-y-6">
            <LabelInput
                label="Form title"
                value={definition.title}
                onChange={setTitle}
            />

            {(definition.fields || []).length > 0 && (
                <section className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-800">Header fields</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {definition.fields.map((field) => (
                            <LabelInput
                                key={field.key}
                                hint={field.key}
                                label="Question / label"
                                value={field.label}
                                onChange={(v) => setFieldLabel('fields', field.key, v)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {(definition.extraFields || []).length > 0 && (
                <section className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-800">Extra fields</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {definition.extraFields.map((field) => (
                            <LabelInput
                                key={field.key}
                                hint={field.key}
                                label="Question / label"
                                value={field.label}
                                onChange={(v) => setFieldLabel('extraFields', field.key, v)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {(definition.sections || []).map((sec) => (
                <section key={sec.key} className="space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <LabelInput
                        hint={sec.key}
                        label="Section title"
                        value={sec.title}
                        onChange={(v) => setSectionTitle(sec.key, v)}
                    />
                    <div className="space-y-3">
                        {sec.items.map((item) => (
                            <LabelInput
                                key={item.key}
                                hint={item.key}
                                label="Checklist question"
                                value={item.label}
                                onChange={(v) => setItemLabel(sec.key, item.key, v)}
                            />
                        ))}
                    </div>
                </section>
            ))}

            {definition.table && (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-4">
                    <LabelInput
                        label="Table title"
                        value={definition.table.label}
                        onChange={setTableLabel}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        {definition.table.columns.map((col) => (
                            <LabelInput
                                key={col.key}
                                hint={col.key}
                                label="Column label"
                                value={col.label}
                                onChange={(v) => setColumnLabel(col.key, v)}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

export default function CompanyFormQuestionsEditor({ className }) {
    const queryClient = useQueryClient();
    const [department, setDepartment] = useState(null);
    const [formKey, setFormKey] = useState(null);
    const [draft, setDraft] = useState(null);

    const modulesQuery = useQuery({
        queryKey: ['company-form-modules'],
        queryFn: listFormModules,
    });

    const modules = modulesQuery.data || [];

    const formsInDept = useMemo(() => {
        if (!department) return [];
        return modules.filter((m) => m.definition?.department === department);
    }, [modules, department]);

    const selectedModule = modules.find((m) => m.form_key === formKey) || null;

    useEffect(() => {
        if (!formKey) {
            setDraft(null);
            return;
        }
        const mod = modules.find((m) => m.form_key === formKey);
        if (mod?.definition) {
            setDraft(structuredClone(mod.definition));
        } else {
            setDraft(resolveFormDefinition(formKey, {}));
        }
    }, [formKey, modules]);

    const saveMut = useMutation({
        mutationFn: () => saveFormQuestions(formKey, draft),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company-form-modules'] });
            toast.success('Questions saved — workers will see the new wording');
        },
        onError: (e) => toast.error(e.message || 'Save failed'),
    });

    const resetMut = useMutation({
        mutationFn: () => resetFormQuestions(formKey),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company-form-modules'] });
            toast.success('Restored default questions');
        },
        onError: (e) => toast.error(e.message || 'Reset failed'),
    });

    const hasCustom =
        selectedModule &&
        selectedModule.questions_override &&
        Object.keys(selectedModule.questions_override).length > 0;

    return (
        <section className={cn(glassPanel, 'p-4 sm:p-5 space-y-4', className)}>
            <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                    Form questions
                </h2>
                <p className="text-xs text-slate-500">
                    View and edit question wording. Structure (OK/NOT OK, tables, field types) stays the same.
                </p>
            </div>

            {modulesQuery.isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                </div>
            ) : !department ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    {DEPARTMENTS.map((d) => {
                        const count = modules.filter(
                            (m) => m.definition?.department === d.key
                        ).length;
                        if (!count) return null;
                        return (
                            <button
                                key={d.key}
                                type="button"
                                onClick={() => {
                                    setDepartment(d.key);
                                    setFormKey(null);
                                }}
                                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-left hover:bg-white"
                            >
                                <span>
                                    <span className="block font-medium text-slate-900">{d.label}</span>
                                    <span className="text-xs text-slate-500">{count} form(s)</span>
                                </span>
                                <ChevronRight className="h-4 w-4 text-slate-400" />
                            </button>
                        );
                    })}
                </div>
            ) : !formKey ? (
                <div className="space-y-2">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-xl px-2"
                        onClick={() => setDepartment(null)}
                    >
                        ← Departments
                    </Button>
                    <h3 className="text-sm font-semibold text-slate-800">
                        {getDepartmentLabel(department)}
                    </h3>
                    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white/80">
                        {formsInDept.map((m) => (
                            <li key={m.form_key}>
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50"
                                    onClick={() => setFormKey(m.form_key)}
                                >
                                    <span className="min-w-0">
                                        <span className="block font-medium text-slate-900">
                                            {m.definition?.title}
                                        </span>
                                        <span className="font-mono text-xs text-slate-400">
                                            {m.form_key}
                                        </span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {m.questions_override &&
                                            Object.keys(m.questions_override).length > 0 && (
                                                <Badge variant="secondary">Customized</Badge>
                                            )}
                                        <ChevronRight className="h-4 w-4 text-slate-400" />
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-9 rounded-xl px-2"
                            onClick={() => setFormKey(null)}
                        >
                            ← Forms
                        </Button>
                        {hasCustom && <Badge variant="secondary">Customized</Badge>}
                        <div className="ml-auto flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-xl"
                                disabled={resetMut.isPending || saveMut.isPending}
                                onClick={() => {
                                    if (
                                        window.confirm(
                                            'Restore the original default questions for this form?'
                                        )
                                    ) {
                                        resetMut.mutate();
                                    }
                                }}
                            >
                                {resetMut.isPending ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                ) : (
                                    <RotateCcw className="mr-1.5 h-4 w-4" />
                                )}
                                Reset defaults
                            </Button>
                            <Button
                                type="button"
                                className="h-10 rounded-xl bg-slate-900 hover:bg-slate-800"
                                disabled={saveMut.isPending || !draft}
                                onClick={() => saveMut.mutate()}
                            >
                                {saveMut.isPending ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="mr-1.5 h-4 w-4" />
                                )}
                                Save questions
                            </Button>
                        </div>
                    </div>
                    {draft ? (
                        <EditorBody definition={draft} onChange={setDraft} />
                    ) : (
                        <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-400" />
                    )}
                </div>
            )}
        </section>
    );
}
