/**
 * Admin → Employees → "ID cards": every card at a glance, filters (expiring, no photo, role, state),
 * batch print to PVC (admin only), and the scan log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2, Printer, ScanLine, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { cn } from '@/ui/utils';
import { UNIFIED } from '@/core/supabase';
import { openWorkerProfile } from '@/features/workerInfo/WorkerProfile';
import { cardsAdmin } from './api';
import { downloadPvcCards } from './pvcPrint';
import { STATE_LABEL, daysLeft, fmtDate, themeFor } from './cardModel';

const ROLE_DOT = { employee: 'bg-red-600', supervisor: 'bg-blue-600', manager: 'bg-emerald-600', admin: 'bg-white ring-2 ring-red-600' };
const FILTERS = [
    ['active', 'Active'],
    ['expiring', 'Expiring ≤ 60 days'],
    ['nophoto', 'No photo'],
    ['problem', 'Expired / cancelled'],
    ['all', 'Everyone'],
];

export default function CardsAdminPanel() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('active');
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState([]);
    const [busy, setBusy] = useState('');
    const [tab, setTab] = useState('cards');
    const [scans, setScans] = useState(null);

    const load = useCallback(async () => {
        try {
            setRows(await cardsAdmin.list());
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, []);
    useEffect(() => {
        if (UNIFIED) load();
    }, [load]);
    useEffect(() => {
        if (tab === 'scans' && !scans) cardsAdmin.scans(300).then(setScans).catch((e) => toast.error(e.message));
    }, [tab, scans]);

    const s = q.trim().toLowerCase();
    const shown = useMemo(
        () =>
            (rows || []).filter((r) => {
                const d = daysLeft(r.valid_until);
                const ok =
                    filter === 'all' ||
                    (filter === 'active' && r.state === 'valid') ||
                    (filter === 'expiring' && r.state === 'valid' && d != null && d <= 60) ||
                    (filter === 'nophoto' && r.in_company && !r.has_photo) ||
                    (filter === 'problem' && ['expired', 'void', 'replaced', 'none'].includes(r.state) && r.in_company);
                return ok && (!s || `${r.employee_id} ${r.name} ${r.card_number || ''}`.toLowerCase().includes(s));
            }),
        [rows, filter, s],
    );
    const stats = useMemo(() => {
        const r = rows || [];
        return {
            active: r.filter((x) => x.state === 'valid').length,
            expiring: r.filter((x) => x.state === 'valid' && (daysLeft(x.valid_until) ?? 999) <= 60).length,
            nophoto: r.filter((x) => x.in_company && !x.has_photo).length,
            problem: r.filter((x) => x.in_company && ['expired', 'void', 'replaced', 'none'].includes(x.state)).length,
        };
    }, [rows]);

    if (!UNIFIED) return null;
    const printable = shown.filter((r) => r.state === 'valid');
    const allPicked = printable.length > 0 && printable.every((r) => picked.includes(r.employee_id));

    const print = async (ids) => {
        if (!ids.length) return;
        setBusy('print');
        try {
            const data = await cardsAdmin.forPrint(ids);
            const roleOf = Object.fromEntries((rows || []).map((r) => [r.employee_id, r.role]));
            await downloadPvcCards(
                data.map((c) => ({ ...c, role: c.role || roleOf[c.employee_id] })),
                `AKK-ID-cards-${new Date().toISOString().slice(0, 10)}-${data.length}.pdf`,
                (d, t) => setBusy(`print ${d}/${t}`),
            );
            toast.success(`${data.length} card${data.length === 1 ? '' : 's'} ready to print (front + back)`);
            setPicked([]);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };

    return (
        <section className="rounded-2xl border border-[var(--g-hairline)] bg-white p-4 sm:p-5" aria-label="ID cards">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
                        <CreditCard className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold tracking-tight text-slate-900">ID cards</h2>
                        <p className="text-sm text-slate-500">16-digit card per person · valid 2 years · print PVC cards (admin only).</p>
                    </div>
                </div>
                <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
                    {[
                        ['cards', 'Cards', CreditCard],
                        ['scans', 'Scan log', ScanLine],
                    ].map(([k, l, Icon]) => (
                        <button key={k} type="button" onClick={() => setTab(k)} className={cn('flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold', tab === k ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600')}>
                            <Icon className="h-4 w-4" /> {l}
                        </button>
                    ))}
                </div>
            </div>
            {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

            {tab === 'cards' ? (
                <>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                            ['Active cards', stats.active, 'text-slate-900', 'active'],
                            ['Expiring ≤ 60 days', stats.expiring, stats.expiring ? 'text-amber-700' : 'text-slate-900', 'expiring'],
                            ['No photo', stats.nophoto, stats.nophoto ? 'text-amber-700' : 'text-slate-900', 'nophoto'],
                            ['Need a new card', stats.problem, stats.problem ? 'text-red-700' : 'text-slate-900', 'problem'],
                        ].map(([label, n, tone, f]) => (
                            <button key={label} type="button" onClick={() => setFilter(f)} className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors', filter === f ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)]' : 'border-[var(--g-hairline)] hover:bg-slate-50')}>
                                <p className="text-xs font-semibold text-slate-500">{label}</p>
                                <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{rows ? n : '–'}</p>
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or card number" className="h-10 w-full rounded-xl border border-[var(--g-hairline)] pl-9 pr-3 text-sm" />
                        </div>
                        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-xl border border-[var(--g-hairline)] bg-white px-2 text-sm" aria-label="Filter">
                            {FILTERS.map(([k, l]) => (
                                <option key={k} value={k}>
                                    {l}
                                </option>
                            ))}
                        </select>
                        <Button type="button" variant="outline" className="h-10" disabled={!printable.length} onClick={() => setPicked(allPicked ? [] : printable.map((r) => r.employee_id))}>
                            {allPicked ? 'Clear' : `Select ${printable.length}`}
                        </Button>
                        <Button type="button" className="h-10" disabled={!picked.length || !!busy} onClick={() => print(picked)}>
                            {busy.startsWith('print') ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
                            {busy.startsWith('print ') ? busy.slice(6) : `Print ${picked.length || ''}`}
                        </Button>
                    </div>
                    <ul className="mt-3 max-h-[28rem] divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-xl border border-[var(--g-hairline)]">
                        {!rows ? (
                            <li className="flex items-center gap-2 p-4 text-sm text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading cards…
                            </li>
                        ) : null}
                        {rows && !shown.length ? <li className="p-6 text-center text-sm text-slate-500">Nothing here.</li> : null}
                        {shown.map((r) => {
                            const d = daysLeft(r.valid_until);
                            const canPick = r.state === 'valid';
                            return (
                                <li key={r.employee_id} className="flex items-center gap-3 px-3 py-2.5">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-[var(--g-brand)]"
                                        disabled={!canPick}
                                        checked={picked.includes(r.employee_id)}
                                        onChange={() => setPicked((p) => (p.includes(r.employee_id) ? p.filter((x) => x !== r.employee_id) : [...p, r.employee_id]))}
                                        aria-label={`Select ${r.name}`}
                                    />
                                    <span className={cn('h-3 w-3 shrink-0 rounded-full', ROLE_DOT[r.role] || ROLE_DOT.employee)} title={themeFor(r.role).label} />
                                    <button type="button" onClick={() => openWorkerProfile(r.employee_id)} className="min-w-0 flex-1 text-left">
                                        <span className="block truncate text-sm font-semibold text-slate-900">
                                            {r.name} <span className="font-normal text-slate-400">{r.employee_id}</span>
                                        </span>
                                        <span className="block truncate text-xs text-slate-500">
                                            {r.card_number ? `•••• ${String(r.card_number).slice(-4)} · ` : ''}
                                            {r.state === 'valid' ? `valid to ${fmtDate(r.valid_until)}` : STATE_LABEL[r.state] || r.state}
                                            {r.printed_count ? ` · printed ${r.printed_count}×` : ''}
                                        </span>
                                    </button>
                                    {!r.has_photo && r.in_company ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">No photo</span> : null}
                                    {r.state === 'valid' && d != null && d <= 60 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{d} days</span> : null}
                                    {['expired', 'void', 'replaced'].includes(r.state) && r.in_company ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{STATE_LABEL[r.state]}</span> : null}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">Tap a person to renew, cancel or print their card, or link their manager / admin logins (card colour).</p>
                </>
            ) : (
                <ul className="mt-4 max-h-[30rem] divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-xl border border-[var(--g-hairline)] text-sm">
                    {!scans ? (
                        <li className="flex items-center gap-2 p-4 text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </li>
                    ) : null}
                    {scans && !scans.length ? <li className="p-6 text-center text-slate-500">No scans yet.</li> : null}
                    {(scans || []).map((x, i) => (
                        <li key={i} className="flex items-center gap-3 px-3 py-2">
                            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', x.result === 'red' || x.result === 'not_found' ? 'bg-red-500' : x.result === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-slate-900">{x.name || x.employee_id || 'Unknown code'}</span>
                                <span className="block truncate text-xs capitalize text-slate-500">
                                    {x.purpose} · {String(x.method || '—').replace('_', ' ')} · <span className="normal-case">{x.by || 'public'}</span>
                                </span>
                            </span>
                            <span className="shrink-0 text-xs text-slate-400">{new Date(x.at).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
