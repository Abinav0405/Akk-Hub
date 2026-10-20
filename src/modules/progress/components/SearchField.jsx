import { Search, X } from 'lucide-react';
import { Input } from '@/ui/input';
import { cn } from '@/modules/progress/lib/utils';

/**
 * Case-insensitive search across the given field values: true when every word typed
 * appears somewhere in them, in any order — "pole phillip" finds a package with
 * "Accident pole replacement" and "Phillip Street".
 */
export function matchesQuery(values, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const fields = values.map((value) => String(value ?? '').toLowerCase());
    return words.every((word) => fields.some((field) => field.includes(word)));
}

export default function SearchField({
    value,
    onChange,
    placeholder,
    className,
    native = false,
    id,
}) {
    return (
        <div className={cn('relative min-w-0', className)}>
            <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
            />
            <Input
                id={id}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                enterKeyHint="search"
                className={cn('pl-9 pr-9', native && 'min-h-11')}
            />
            {value ? (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label="Clear search"
                    className={cn(
                        'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700',
                        native && 'min-h-11 min-w-11 inline-flex items-center justify-center'
                    )}
                >
                    <X className="h-4 w-4" />
                </button>
            ) : null}
        </div>
    );
}
