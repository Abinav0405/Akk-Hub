/**
 * Date field you can TYPE into (DD/MM/YYYY — slashes are added for you) or pick from the calendar button.
 * Value in / out is ISO `YYYY-MM-DD` ('' when empty or not a complete, real date yet).
 * Also accepts pasted "2029-03-21", "21-03-2029", "21.3.2029" or "21 Mar 2029".
 */
import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/ui/utils';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

export function isoToDisplay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Parse what the user typed → ISO, or null if incomplete / impossible. */
export function parseTypedDate(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return '';
    let y;
    let mo;
    let d;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (m) [, y, mo, d] = m;
    if (!m) {
        m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(s);
        if (m) [, d, mo, y] = m;
    }
    if (!m) {
        m = /^(\d{1,2})[-/. ]([a-z]{3,9})[-/. ,]+(\d{4})$/.exec(s);
        if (m) {
            const idx = MONTHS.indexOf(m[2].slice(0, 3));
            if (idx >= 0) [d, mo, y] = [m[1], idx + 1, m[3]];
        }
    }
    if (!y) return null;
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    if (yy < 1900 || yy > 9999 || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
    return `${yy}-${pad(mm)}-${pad(dd)}`;
}

/** Add slashes while typing digits: 2103 → 21/03, 21032029 → 21/03/2029. */
function autoSlash(next, prev) {
    if (next.length < prev.length) return next; // deleting: leave it alone
    if (/[a-z]/i.test(next)) return next; // "21 Mar 2029" style
    const digits = next.replace(/\D/g, '').slice(0, 8);
    if (/^\d{4}[-/.]/.test(next)) return next; // ISO style typed
    let out = digits.slice(0, 2);
    if (digits.length > 2) out += '/' + digits.slice(2, 4);
    else if (digits.length === 2 && next.length > prev.length) out += '/';
    if (digits.length > 4) out += '/' + digits.slice(4);
    else if (digits.length === 4 && next.length > prev.length) out += '/';
    return out;
}

export default function DateInput({ value, onChange, id, required, disabled, className, inputClassName, placeholder = 'DD/MM/YYYY', 'aria-label': ariaLabel }) {
    const autoId = useId();
    const inputId = id || autoId;
    const [text, setText] = useState(isoToDisplay(value));
    const [bad, setBad] = useState(false);
    const pickerRef = useRef(null);

    // Follow outside changes (e.g. form reset), but don't fight the user mid-typing.
    useEffect(() => {
        const parsed = parseTypedDate(text);
        if ((value || '') !== (parsed || '')) setText(isoToDisplay(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const update = (raw) => {
        const next = autoSlash(raw, text);
        setText(next);
        const iso = parseTypedDate(next);
        setBad(false);
        if (iso !== null) onChange(iso);
        else if (!next.trim()) onChange('');
    };

    const openPicker = () => {
        const el = pickerRef.current;
        if (!el) return;
        try {
            if (typeof el.showPicker === 'function') el.showPicker();
            else el.click();
        } catch {
            el.click();
        }
    };

    return (
        <div className={cn('relative', className)}>
            <input
                id={inputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={text}
                required={required}
                disabled={disabled}
                aria-label={ariaLabel}
                aria-invalid={bad || undefined}
                placeholder={placeholder}
                onChange={(e) => update(e.target.value)}
                onBlur={() => setBad(Boolean(text.trim()) && parseTypedDate(text) === null)}
                className={cn(
                    'h-12 w-full rounded-xl border bg-white pl-3 pr-12 text-base tabular-nums',
                    bad ? 'border-red-400 ring-1 ring-red-200' : 'border-[var(--g-hairline)]',
                    inputClassName,
                )}
            />
            <button
                type="button"
                onClick={openPicker}
                disabled={disabled}
                aria-label="Pick from calendar"
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[var(--g-brand)]"
            >
                <CalendarDays className="h-5 w-5" />
            </button>
            <input
                ref={pickerRef}
                type="date"
                tabIndex={-1}
                aria-hidden
                value={value || ''}
                onChange={(e) => {
                    setText(isoToDisplay(e.target.value));
                    setBad(false);
                    onChange(e.target.value);
                }}
                className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
            />
            {bad ? <p className="mt-1 text-xs text-red-600">Type the date as DD/MM/YYYY, e.g. 21/03/2029</p> : null}
        </div>
    );
}
