import React from 'react';
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

export function FormFieldControl({ field, value, onChange, disabled = false }) {
    const id = `cf-${field.key}`;
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
        <Input
            {...common}
            type={inputType}
            value={value ?? ''}
            placeholder={field.placeholder || ''}
            onChange={(e) => onChange(e.target.value)}
            readOnly={Boolean(field.auto) && disabled !== true && field.autoLocked}
        />
    );
}

export function FieldBlock({ field, value, onChange, disabled }) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={`cf-${field.key}`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {field.label}
                {field.required !== false ? <span className="text-red-500"> *</span> : null}
            </label>
            <FormFieldControl
                field={field}
                value={value}
                onChange={onChange}
                disabled={disabled || Boolean(field.auto)}
            />
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
