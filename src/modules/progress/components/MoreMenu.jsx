import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/modules/progress/lib/utils';

/** Small "⋯" actions menu. Closes on outside click or Escape. */
export default function MoreMenu({ items }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    const shown = items.filter(Boolean);
    if (!shown.length) return null;
    return (
        <div ref={ref} className="relative">
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 w-11 min-h-11 shrink-0 p-0"
                aria-label="More actions"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <MoreHorizontal className="h-4 w-4" />
            </Button>
            {open ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-white py-1 shadow-lg">
                    {shown.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            disabled={item.disabled}
                            onClick={() => { setOpen(false); item.onClick(); }}
                            className={cn(
                                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50',
                                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'
                            )}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
