import { useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/ui/input';
import { cn } from '@/modules/progress/lib/utils';
import { matchSuggestions } from '@/modules/progress/lib/packageSuggestions';

/**
 * Free-text input with search-as-you-type suggestions underneath (like a search bar).
 * Anything can be typed; a suggestion is just a shortcut. Arrow keys + Enter, or tap.
 */
export default function SuggestInput({
    id,
    value,
    onChange,
    suggestions = [],
    placeholder,
    disabled = false,
    maxLength = 150,
    native = false,
    className,
}) {
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const blurTimer = useRef(null);
    const matches = useMemo(() => matchSuggestions(suggestions, value), [suggestions, value]);
    const showList = open && !disabled && matches.length > 0;

    const pick = (row) => {
        onChange(row.value);
        setOpen(false);
        setActive(-1);
    };

    const onKeyDown = (e) => {
        if (!showList) {
            if (e.key === 'ArrowDown' && matches.length) {
                setOpen(true);
                setActive(0);
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            setActive((i) => (i + 1) % matches.length);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
            e.preventDefault();
        } else if (e.key === 'Enter' && active >= 0) {
            pick(matches[active]);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            setOpen(false);
            setActive(-1);
        }
    };

    return (
        <div className={cn('relative', showList && 'z-50', className)}>
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value.slice(0, maxLength));
                        setOpen(true);
                        setActive(-1);
                    }}
                    onFocus={() => {
                        clearTimeout(blurTimer.current);
                        setOpen(true);
                    }}
                    onBlur={() => {
                        // Let a tap on a suggestion land before the list closes.
                        blurTimer.current = setTimeout(() => setOpen(false), 150);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showList}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    className="pl-9"
                />
            </div>
            {showList ? (
                <ul
                    id={listId}
                    role="listbox"
                    className="akk-suggest-list absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-lg"
                >
                    {matches.map((row, i) => (
                        <li key={row.id || row.value} role="option" aria-selected={i === active}>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(row)}
                                className={cn(
                                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm',
                                    native && 'min-h-11',
                                    i === active ? 'bg-brand-muted text-brand' : 'text-slate-800 hover:bg-slate-50'
                                )}
                            >
                                <span className="min-w-0 break-words">{row.value}</span>
                                {row.use_count > 1 ? (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">used {row.use_count}×</span>
                                ) : null}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
