import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { FormFieldControl } from '@/modules/timesheet/components/companyForms/FormFieldControls';
import { riskBand } from '@/modules/timesheet/lib/companyForms';
import { cn } from '@/modules/timesheet/lib/utils';

function emptyRow(columns) {
    const row = {};
    for (const col of columns) row[col.key] = '';
    return row;
}

export function buildInitialTableRows(table) {
    if (!table) return [];
    if (Array.isArray(table.defaultRows) && table.defaultRows.length) {
        return table.defaultRows.map((r) => ({ ...emptyRow(table.columns), ...r }));
    }
    const min = Math.max(1, table.minRows || 1);
    return Array.from({ length: min }, () => emptyRow(table.columns));
}

export default function FormTableEditor({
    table,
    rows,
    onChange,
    disabled = false,
}) {
    if (!table) return null;

    const updateCell = (index, key, value) => {
        const next = rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
        onChange(next);
    };

    const addRow = () => {
        onChange([...rows, emptyRow(table.columns)]);
    };

    const removeRow = (index) => {
        if (rows.length <= (table.minRows || 1)) return;
        onChange(rows.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{table.label}</h3>
                {!disabled && (
                    <Button type="button" variant="outline" size="sm" className="h-11 rounded-xl" onClick={addRow}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        Add row
                    </Button>
                )}
            </div>

            <div className="space-y-3">
                {rows.map((row, index) => {
                    const rating =
                        table.computed?.risk_rating === 'likelihood_x_severity'
                            ? riskBand(row.likelihood, row.severity)
                            : null;

                    return (
                        <div
                            key={`row-${index}`}
                            className={cn(
                                'rounded-2xl border border-slate-200 bg-white/80 p-3 space-y-3',
                                rating?.band === 'High' && 'border-red-300 bg-red-50/40'
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Row {index + 1}
                                </p>
                                {!disabled && rows.length > (table.minRows || 1) && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 w-11 text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() => removeRow(index)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {table.columns.map((col) => (
                                    <div key={col.key} className="space-y-1">
                                        <label className="text-xs font-medium text-slate-500">{col.label}</label>
                                        <FormFieldControl
                                            field={col}
                                            value={row[col.key]}
                                            onChange={(v) => updateCell(index, col.key, v)}
                                            disabled={disabled}
                                        />
                                    </div>
                                ))}
                            </div>
                            {rating && rating.score != null && (
                                <p className="text-xs text-slate-600">
                                    Risk rating:{' '}
                                    <span
                                        className={cn(
                                            'font-semibold',
                                            rating.band === 'High' && 'text-red-700',
                                            rating.band === 'Medium' && 'text-amber-700',
                                            rating.band === 'Low' && 'text-emerald-700'
                                        )}
                                    >
                                        {rating.score} ({rating.band})
                                    </span>
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
