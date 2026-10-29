/**
 * "Who should receive these packages?" — shared by the review board and the export queue.
 *   mode 'send'   — approved packages are sent to export to the chosen clients (Export Only accounts)
 *   mode 'change' — packages that are already sent get a different audience
 * The sender must choose: tick the clients, or pick "every Export Only account" on purpose.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { listExporters } from '@/modules/progress/lib/accounts';
import { listStaffExporters } from '@/modules/progress/lib/jsr';
import { cn } from '@/modules/progress/lib/utils';

export default function SendToClientsDialog({ open, mode = 'send', count = 0, initialIds = [], busy = false, asManager = false, onConfirm, onClose }) {
    const [accounts, setAccounts] = useState(null);
    const [everyone, setEveryone] = useState(false);
    const [picked, setPicked] = useState([]);
    const [q, setQ] = useState('');

    useEffect(() => {
        if (!open) return;
        setEveryone(false);
        setQ('');
        setPicked((initialIds || []).map(String));
        (asManager ? listStaffExporters() : listExporters())
            .then((rows) => setAccounts((rows || []).filter((r) => r.is_active !== false)))
            .catch((e) => {
                toast.error(e.message || 'Could not load the client accounts');
                setAccounts([]);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const shown = useMemo(() => {
        const s = q.trim().toLowerCase();
        return (accounts || []).filter((a) => !s || String(a.display_name || '').toLowerCase().includes(s));
    }, [accounts, q]);

    const toggle = (id) => {
        const key = String(id);
        setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
    };
    const chosen = (accounts || []).filter((a) => picked.includes(String(a.id)));
    const canConfirm = !busy && accounts && (everyone || chosen.length > 0);
    const noun = `${count} package${count === 1 ? '' : 's'}`;
    const verb = mode === 'change' ? 'Save' : 'Send';
    const summary = everyone
        ? 'every Export Only account'
        : chosen.length === 0
          ? 'no one yet'
          : chosen.length === 1
            ? chosen[0].display_name
            : `${chosen.length} accounts`;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose?.()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{mode === 'change' ? 'Change who can see these packages' : 'Send to which clients?'}</DialogTitle>
                    <DialogDescription>
                        {mode === 'change'
                            ? `${noun} already with Export Only. Choose who can see ${count === 1 ? 'it' : 'them'} from now on.`
                            : `Choose which Export Only accounts receive ${noun}. The others will not see ${count === 1 ? 'it' : 'them'}.`}
                    </DialogDescription>
                </DialogHeader>

                {accounts === null ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading clients…
                    </div>
                ) : accounts.length === 0 ? (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">There are no active Export Only accounts. Create one first.</p>
                ) : (
                    <div className="space-y-3">
                        <label className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm', everyone ? 'border-brand bg-brand-muted/30' : 'border-border')}>
                            <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
                            <Users className="h-4 w-4 text-slate-500" aria-hidden />
                            <span>
                                <span className="font-medium">Every Export Only account</span>
                                <span className="block text-xs text-muted-foreground">All {accounts.length} accounts can see {count === 1 ? 'it' : 'them'}, including accounts added later.</span>
                            </span>
                        </label>

                        <div className={cn('space-y-2', everyone && 'pointer-events-none opacity-40')} aria-disabled={everyone}>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={q}
                                        onChange={(e) => setQ(e.target.value)}
                                        placeholder="Search clients…"
                                        className="h-9 w-full rounded-lg border border-border bg-white pl-8 pr-2 text-sm"
                                        aria-label="Search clients"
                                    />
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={() => setPicked(shown.map((a) => String(a.id)))}>
                                    All
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setPicked([])}>
                                    None
                                </Button>
                            </div>
                            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                                {shown.length === 0 ? <li className="p-3 text-center text-sm text-muted-foreground">No client matches.</li> : null}
                                {shown.map((a) => (
                                    <li key={a.id}>
                                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-slate-50">
                                            <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={picked.includes(String(a.id))} onChange={() => toggle(a.id)} />
                                            <span className="font-medium text-slate-800">{a.display_name}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                        {mode === 'change' ? 'Visible to' : 'Sending to'}: <span className="font-semibold text-slate-700">{summary}</span>
                    </p>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={!canConfirm}
                            onClick={() => onConfirm?.(everyone ? [] : chosen.map((a) => String(a.id)), everyone ? [] : chosen.map((a) => a.display_name))}
                        >
                            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                            {verb} {noun}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
