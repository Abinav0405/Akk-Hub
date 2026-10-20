/**
 * Admin → Payslip report → Pay balances.
 * Lists balances carried between payslips, and lets the admin add one by hand (e.g. a cash
 * advance to recover later) or cancel one.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, PlusCircle, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabaseTimesheet } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { balanceTitle, cancelBalance, createManualBalance, DIRECTION_LABEL, listBalances } from '@/modules/timesheet/lib/payBalances';
import { cn } from '@/modules/timesheet/lib/utils';

const fmt = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

const STATUS_STYLE = {
    open: 'bg-blue-50 text-blue-800 ring-blue-200',
    settled: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const SOURCE_LABEL = { short_payment: 'Paid less than payable', overpayment: 'Paid more than payable', manual: 'Added by admin' };

async function detectWorkerType(workerId) {
    const id = String(workerId).trim();
    const { data: local } = await supabaseTimesheet.from('local_worker_details').select('employee_id').eq('employee_id', id).maybeSingle();
    if (local) return 'local';
    const { data: foreign } = await supabaseTimesheet.from('worker_details').select('employee_id').eq('employee_id', id).maybeSingle();
    if (foreign) return 'foreign';
    return null;
}

export default function PayBalancesPanel({ className }) {
    const [workerFilter, setWorkerFilter] = useState('');
    const [openOnly, setOpenOnly] = useState(true);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [adding, setAdding] = useState(null); // form state
    const [cancelling, setCancelling] = useState(null); // { balance, reason }
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setRows(await listBalances({ workerId: workerFilter.trim() || undefined, includeClosed: !openOnly }));
        } catch (error) {
            console.error('Error loading pay balances:', error);
            toast.error('Could not load pay balances');
        } finally {
            setLoading(false);
        }
    }, [workerFilter, openOnly]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openOnly]);

    const submitAdd = async () => {
        setSaving(true);
        try {
            const workerType = await detectWorkerType(adding.workerId);
            if (!workerType) {
                toast.error('No worker with that ID');
                return;
            }
            await createManualBalance({ ...adding, workerType });
            toast.success('Balance added');
            setAdding(null);
            void load();
        } catch (error) {
            toast.error(error.message || 'Could not add balance');
        } finally {
            setSaving(false);
        }
    };

    const submitCancel = async () => {
        setSaving(true);
        try {
            await cancelBalance(cancelling.balance.id, cancelling.reason);
            toast.success('Balance cancelled');
            setCancelling(null);
            void load();
        } catch (error) {
            console.error(error);
            toast.error('Could not cancel balance');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className={cn('mt-6 rounded-2xl border border-slate-200/80 bg-white/70 p-4 sm:p-5', className)}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                        <Wallet className="h-5 w-5 text-slate-700" />
                        Pay balances
                    </h2>
                    <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                        Money carried between payslips. Pick open balances when passing out a payslip; paying less or more than payable creates one automatically.
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <Input
                        placeholder="Worker ID"
                        value={workerFilter}
                        onChange={(e) => setWorkerFilter(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && load()}
                        className="h-10 w-36 rounded-xl"
                    />
                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700">
                        <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
                        Open only
                    </label>
                    <Button variant="outline" className="h-10 rounded-xl" onClick={load} disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button
                        className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                        onClick={() => setAdding({ workerId: workerFilter.trim(), direction: 'owed_by_worker', amount: '', reason: '' })}
                    >
                        <PlusCircle className="mr-1.5 h-4 w-4" /> Add balance
                    </Button>
                </div>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                    {loading ? 'Loading…' : openOnly ? 'No open balances.' : 'No balances yet.'}
                </p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((b) => {
                        const uses = b.pay_balance_uses || [];
                        return (
                            <div key={b.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-mono text-xs text-slate-500">ID {b.worker_id}</p>
                                        <p className="mt-0.5 break-words font-semibold text-slate-900">{balanceTitle(b)}</p>
                                    </div>
                                    <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ring-1', STATUS_STYLE[b.status])}>
                                        {b.status}
                                    </span>
                                </div>
                                <p className={cn('mt-2 text-sm font-medium', b.direction === 'owed_to_worker' ? 'text-emerald-700' : 'text-red-700')}>
                                    {DIRECTION_LABEL[b.direction]} · {fmt(b.remaining_amount)} left of {fmt(b.original_amount)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {SOURCE_LABEL[b.source]}
                                    {uses.length ? ` · used on ${uses.length} payslip${uses.length > 1 ? 's' : ''}` : ''}
                                    {b.cancel_reason ? ` · cancelled: ${b.cancel_reason}` : ''}
                                </p>
                                {b.status === 'open' && (
                                    <div className="mt-auto pt-3">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-9 w-full rounded-xl border-slate-200"
                                            onClick={() => setCancelling({ balance: b, reason: '' })}
                                        >
                                            Cancel balance
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Dialog open={!!adding} onOpenChange={(open) => !open && setAdding(null)}>
                <DialogContent className="max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Add pay balance</DialogTitle>
                        <DialogDescription>For money given or owed outside a payslip, e.g. a cash advance to recover later.</DialogDescription>
                    </DialogHeader>
                    {adding && (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Worker ID</label>
                                <Input value={adding.workerId} onChange={(e) => setAdding({ ...adding, workerId: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Type</label>
                                <select
                                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                                    value={adding.direction}
                                    onChange={(e) => setAdding({ ...adding, direction: e.target.value })}
                                >
                                    <option value="owed_by_worker">Owed by worker — deduct later (advance, overpayment)</option>
                                    <option value="owed_to_worker">Owed to worker — add later (unpaid amount)</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Amount</label>
                                <Input type="number" min="0" step="0.01" value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">Reason</label>
                                <Input
                                    placeholder={adding.direction === 'owed_by_worker' ? 'e.g. Cash advance' : 'e.g. Unpaid OT'}
                                    value={adding.reason}
                                    onChange={(e) => setAdding({ ...adding, reason: e.target.value })}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAdding(null)}>Cancel</Button>
                        <Button onClick={submitAdd} disabled={saving || !adding?.workerId?.trim() || !(Number(adding?.amount) > 0)}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add balance'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
                <DialogContent className="max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Cancel this balance?</DialogTitle>
                        <DialogDescription>
                            {cancelling ? `${balanceTitle(cancelling.balance)} · ${fmt(cancelling.balance.remaining_amount)} left. It can no longer be used on a payslip; amounts already used stay on those payslips.` : ''}
                        </DialogDescription>
                    </DialogHeader>
                    {cancelling && (
                        <Input
                            placeholder="Reason (required)"
                            value={cancelling.reason}
                            onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })}
                        />
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelling(null)}>Keep it</Button>
                        <Button variant="destructive" onClick={submitCancel} disabled={saving || !cancelling?.reason?.trim()}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel balance'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
