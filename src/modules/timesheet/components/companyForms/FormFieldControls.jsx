import React from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/select';
import { cn } from '@/modules/timesheet/lib/utils';
import { glassInput } from '@/ui/glass';

/** Tick-box answers are stored as an array of the ticked options. */
export function formatFieldValue(value) {
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (value === null || value === undefined || String(value).trim() === '') return '—';
    return String(value);
}

/** `when: { field, has }` — the field only applies when that other answer holds the value. */
export function fieldApplies(field, values) {
    if (!field?.when) return true;
    const v = values?.[field.when.field];
    return Array.isArray(v) ? v.includes(field.when.has) : v === field.when.has;
}

export function FormFieldControl({ field, value, onChange, disabled = false, suggestions = null }) {
    const id = `cf-${field.key}`;
    const listId = suggestions?.length ? `${id}-list` : undefined;
    const common = {
        id,
        disabled,
        className: cn(glassInput, field.type === 'textarea' && 'h-auto min-h-[96px] py-2'),
    };

    if (field.type === 'textarea') {
        return (
            <Textarea
                {...common}
                value={value ?? ''}
                placeholder={field.placeholder || ''}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    }

    if (field.type === 'select') {
        return (
            <Select
                value={value || undefined}
                onValueChange={onChange}
                disabled={disabled}
            >
                <SelectTrigger className={glassInput}>
                    <SelectValue placeholder={`Select ${field.label}`} />
                </SelectTrigger>
                <SelectContent>
                    {(field.options || []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                            {opt}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    if (field.type === 'multi_check') {
        const picked = Array.isArray(value) ? value : [];
        const toggle = (opt) =>
            onChange(picked.includes(opt) ? picked.filter((x) => x !== opt) : (field.options || []).filter((o) => o === opt || picked.includes(o)));
        return (
            <div id={id} role="group" aria-label={field.label} className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {(field.options || []).map((opt) => {
                    const active = picked.includes(opt);
                    return (
                        <button
                            key={opt}
                            type="button"
                            role="checkbox"
                            aria-checked={active}
                            disabled={disabled}
                            onClick={() => toggle(opt)}
                            className={cn(
                                'flex h-11 items-center gap-2.5 rounded-xl border px-3 text-left text-sm font-medium transition-colors',
                                active
                                    ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)] text-slate-900'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                                    active ? 'border-[var(--g-brand)] bg-[var(--g-brand)] text-white' : 'border-slate-300 bg-white'
                                )}
                            >
                                {active ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                            </span>
                            {opt}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (field.type === 'yes_no') {
        return (
            <div className="grid grid-cols-2 gap-2">
                {['Yes', 'No'].map((opt) => {
                    const active = value === opt;
                    return (
                        <button
                            key={opt}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(opt)}
                            className={cn(
                                'h-11 rounded-xl border text-sm font-semibold transition-colors',
                                active
                                    ? opt === 'Yes'
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                        : 'border-slate-400 bg-slate-100 text-slate-800'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            )}
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        );
    }

    const inputType =
        field.type === 'number'
            ? 'number'
            : field.type === 'date'
              ? 'date'
              : field.type === 'time'
                ? 'time'
                : field.type === 'datetime-local'
                  ? 'datetime-local'
                  : 'text';

    return (
        <>
            <Input
                {...common}
                type={inputType}
                value={value ?? ''}
                placeholder={field.placeholder || ''}
                onChange={(e) => onChange(e.target.value)}
                readOnly={Boolean(field.auto) && disabled !== true && field.autoLocked}
                list={listId}
                autoComplete={listId ? 'off' : undefined}
            />
            {listId ? (
                <datalist id={listId}>
                    {suggestions.map((s) => (
                        <option key={s} value={s} />
                    ))}
                </datalist>
            ) : null}
        </>
    );
}

export function FieldBlock({ field, value, onChange, disabled, suggestions, hint, className }) {
    return (
        <div className={cn('space-y-1.5', className)}>
            <label htmlFor={`cf-${field.key}`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {field.label}
                {field.required !== false ? <span className="text-red-500"> *</span> : null}
            </label>
            <FormFieldControl
                field={field}
                value={value}
                onChange={onChange}
                disabled={disabled || Boolean(field.auto)}
                suggestions={suggestions}
            />
            {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        </div>
    );
}

export function ChecklistItemButtons({
    answerMode = 'ok_not_ok',
    value,
    onChange,
    disabled = false,
}) {
    const options =
        answerMode === 'done_pending'
            ? [
                  { value: 'done', label: 'Done', good: true },
                  { value: 'pending', label: 'Pending', good: false },
              ]
            : [
                  { value: 'ok', label: 'OK', good: true },
                  { value: 'not_ok', label: 'NOT OK', good: false },
              ];

    return (
        <div className="grid grid-cols-2 gap-2">
            {options.map((opt) => {
                const active = value === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'h-11 rounded-xl border text-sm font-semibold transition-colors',
                            active
                                ? opt.good
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                    : 'border-red-500 bg-red-50 text-red-700'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
