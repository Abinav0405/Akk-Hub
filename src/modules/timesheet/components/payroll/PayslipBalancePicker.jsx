/**
 * Pass-out payslip: choose open pay balances to use (in full or in part) and enter the amount
 * actually paid. The difference between payable and paid becomes a new balance on pass-out.
 */
import { Input } from '@/ui/input';
import { balanceTitle, DIRECTION_LABEL, selectionToLines } from '@/modules/timesheet/lib/payBalances';
import { cn } from '@/modules/timesheet/lib/utils';

const fmt = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

export default function PayslipBalancePicker({ balances = [], selection = {}, onSelectionChange, amountPaid = '', onAmountPaidChange, compact = false }) {
    const { adjustment } = selectionToLines(balances, selection);

    const toggle = (b) => {
        const next = { ...selection };
        if (b.id in next) delete next[b.id];
        else next[b.id] = String(b.remaining_amount);
        onSelectionChange(next);
    };

    return (
        <div className={cn('space-y-3 rounded-xl border border-slate-200 bg-slate-50/70', compact ? 'p-3' : 'p-4')}>
            <div>
                <p className="text-sm font-semibold text-slate-800">Pay balances</p>
                <p className="text-xs text-slate-500">
                    Use money carried over from earlier payslips. Owed to worker adds, owed by worker deducts. Net pay and CPF are not affected.
                </p>
            </div>

            {balances.length === 0 ? (
                <p className="text-xs text-slate-500">No open balances for this worker.</p>
            ) : (
                <div className="space-y-2">
                    {balances.map((b) => {
                        const on = b.id in selection;
                        const toWorker = b.direction === 'owed_to_worker';
                        return (
                            <div key={b.id} className={cn('rounded-lg border bg-white px-3 py-2', on ? 'border-slate-200' : 'border-slate-200')}>
                                <label className="flex cursor-pointer items-start gap-2">
                                    <input type="checkbox" className="mt-1 h-4 w-4" checked={on} onChange={() => toggle(b)} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium text-slate-900">{balanceTitle(b)}</span>
                                        <span className={cn('text-xs', toWorker ? 'text-emerald-700' : 'text-red-700')}>
                                            {DIRECTION_LABEL[b.direction]} · {fmt(b.remaining_amount)} left
                                            {Number(b.remaining_amount) !== Number(b.original_amount) ? ` of ${fmt(b.original_amount)}` : ''}
                                        </span>
                                    </span>
                                </label>
                                {on && (
                                    <div className="mt-2 flex items-center gap-2 pl-6">
                                        <span className="text-xs text-slate-600">{toWorker ? 'Add' : 'Deduct'}</span>
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            min="0"
                                            max={b.remaining_amount}
                                            step="0.01"
                                            className="h-8 w-32"
                                            value={selection[b.id]}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                const capped = v !== '' && Number(v) > Number(b.remaining_amount) ? String(b.remaining_amount) : v;
                                                onSelectionChange({ ...selection, [b.id]: capped });
                                            }}
                                        />
                                        <span className="text-xs text-slate-500">max {fmt(b.remaining_amount)}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <p className="text-xs font-medium text-slate-700">
                        Balance adjustment: {adjustment >= 0 ? '+' : '-'}{fmt(Math.abs(adjustment))} (amount payable = net pay {adjustment >= 0 ? '+' : '-'} {fmt(Math.abs(adjustment))})
                    </p>
                </div>
            )}

            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Amount actually paid (optional)</label>
                <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Leave blank if paid in full"
                    value={amountPaid}
                    onChange={(e) => onAmountPaidChange(e.target.value)}
                    className="h-9"
                />
                <p className="text-[11px] text-slate-500">
                    Paid less than payable → the rest is carried forward as owed to the worker. Paid more → it's recovered from a later payslip.
                </p>
            </div>
        </div>
    );
}
