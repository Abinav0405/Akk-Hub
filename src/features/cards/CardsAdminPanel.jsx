/**
 * Admin → Employees → "ID cards": every card at a glance, filters (expiring, no photo, role, state),
 * batch print to PVC (admin only), and the scan log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CreditCard, Loader2, Printer, ScanLine, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { cn } from '@/ui/utils';
import { UNIFIED } from '@/core/supabase';
import { openWorkerProfile } from '@/features/workerInfo/WorkerProfile';
import { cardsAdmin } from './api';
import { downloadPvcCards } from './pvcPrint';
import { STATE_LABEL, daysLeft, fmtDate, themeFor } from './cardModel';

const ROLE_DOT = { employee: 'bg-red-600', supervisor: 'bg-blue-600', manager: 'bg-emerald-600', admin: 'bg-white ring-2 ring-red-600' };
const PAGE = 30;
const FILTERS = [
    ['active', 'Active'],
    ['expiring', 'Expiring ≤ 60 days'],
    ['nophoto', 'No photo'],
    ['notissued', 'Physical card not issued'],
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
    const [limit, setLimit] = useState(PAGE);

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
                    (filter === 'notissued' && r.state === 'valid' && !r.physical_issued_at) ||
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
            notissued: r.filter((x) => x.state === 'valid' && !x.physical_issued_at).length,
            problem: r.filter((x) => x.in_company && ['expired', 'void', 'replaced', 'none'].includes(x.state)).length,
        };
    }, [rows]);

    if (!UNIFIED) return null;
    const printable = shown.filter((r) => r.state === 'valid');
    const markIssued = async (ids, issued) => {
        setBusy('phys');
        try {
            const n = await cardsAdmin.setPhysical(ids, issued);
            toast.success(issued ? `${n} card${n === 1 ? '' : 's'} marked as issued` : `${n} card${n === 1 ? '' : 's'} marked as not issued`);
            setPicked([]);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };
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

    const page = shown.slice(0, limit);
    const scanPage = (scans || []).slice(0, limit);
    const GRID = 'md:grid-cols-[1.25rem_7.5rem_minmax(0,1fr)_7rem_7rem_6rem_7rem]';

    return (
        <section className="min-w-0 rounded-2xl border border-[var(--g-hairline)] bg-white p-3 sm:p-4" aria-label="ID cards">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight text-slate-900">Employee ID cards</h2>
                    <p className="text-sm text-slate-500">16-digit card per person · valid 2 years · PVC printing is admin only.</p>
                </div>
                <div role="tablist" aria-label="ID card views" className="flex shrink-0 gap-1 self-start rounded-xl bg-slate-100 p-1">
                    {[
                        ['cards', 'Cards', CreditCard],
                        ['scans', 'Scan log', ScanLine],
                    ].map(([k, l, Icon]) => (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={tab === k}
                            onClick={() => {
                                setTab(k);
                                setLimit(PAGE);
                            }}
                            className={cn(
                                'flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)]',
                                tab === k ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600 hover:text-slate-900',
                            )}
                        >
                            <Icon className="h-4 w-4" /> {l}
                        </button>
                    ))}
                </div>
            </div>
            {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

            {tab === 'cards' ? (
                <>
                    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {[
                            ['Active cards', stats.active, 'text-slate-900', 'active', 'valid now'],
                            ['Expiring ≤ 60 days', stats.expiring, stats.expiring ? 'text-amber-700' : 'text-slate-900', 'expiring', 'renew soon'],
                            ['No photo', stats.nophoto, stats.nophoto ? 'text-amber-700' : 'text-slate-900', 'nophoto', 'employed workers'],
                            ['Need a new card', stats.problem, stats.problem ? 'text-red-700' : 'text-slate-900', 'problem', 'expired / cancelled'],
                        ].map(([label, n, tone, f, hint]) => (
                            <button
                                key={label}
                                type="button"
                                aria-pressed={filter === f}
                                onClick={() => {
                                    setFilter(f);
                                    setLimit(PAGE);
                                }}
                                className={cn(
                                    'min-w-0 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)]',
                                    filter === f ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)]' : 'border-[var(--g-hairline)] bg-slate-50/60 hover:bg-slate-50',
                                )}
                            >
                                <p className="truncate text-xs font-semibold text-slate-500">{label}</p>
                                <p className={cn('text-xl font-semibold leading-tight tabular-nums', tone)}>{rows ? n : '–'}</p>
                                <p className="truncate text-[11px] text-slate-400">{hint}</p>
                            </button>
                        ))}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label className="relative min-w-[12rem] flex-1">
                            <span className="sr-only">Search cards</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                value={q}
                                onChange={(e) => {
                                    setQ(e.target.value);
                                    setLimit(PAGE);
                                }}
                                placeholder="Search name, employee ID or card number"
                                className="h-9 w-full rounded-lg border border-[var(--g-hairline)] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--g-brand)]"
                            />
                        </label>
                        <select
                            value={filter}
                            onChange={(e) => {
                                setFilter(e.target.value);
                                setLimit(PAGE);
                            }}
                            className="h-9 rounded-lg border border-[var(--g-hairline)] bg-white px-2 text-sm"
                            aria-label="Card status"
                        >
                            {FILTERS.map(([k, l]) => (
                                <option key={k} value={k}>
                                    {l}
                                </option>
                            ))}
                        </select>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="h-9" disabled={!printable.length} onClick={() => setPicked(allPicked ? [] : printable.map((r) => r.employee_id))}>
                                {allPicked ? 'Clear selection' : `Select ${printable.length}`}
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="h-9" disabled={!picked.length || !!busy} onClick={() => markIssued(picked, true)} title="Mark the selected cards as handed over">
                                {busy === 'phys' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1.5 h-4 w-4" />} Mark issued
                            </Button>
                            <Button type="button" size="sm" className="h-9" disabled={!picked.length || !!busy} onClick={() => print(picked)}>
                                {busy.startsWith('print') ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
                                {busy.startsWith('print ') ? busy.slice(6) : `Print${picked.length ? ` ${picked.length}` : ''}`}
                            </Button>
                        </div>
                    </div>

                    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--g-hairline)]">
                        <div className={cn('hidden gap-3 bg-[var(--g-surface-inset,#f1f5f9)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500 md:grid', GRID)}>
                            <span />
                            <span>Status</span>
                            <span>Employee</span>
                            <span>Card no.</span>
                            <span>Valid to</span>
                            <span>Photo</span>
                            <span>Physical card</span>
                        </div>
                        <ul className="divide-y divide-[var(--g-hairline)]">
                            {!rows ? (
                                <li className="flex items-center gap-2 p-4 text-sm text-slate-500">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading cards…
                                </li>
                            ) : null}
                            {rows && !shown.length ? <li className="p-6 text-center text-sm text-slate-500">No cards match.</li> : null}
                            {page.map((r) => {
                                const d = daysLeft(r.valid_until);
                                const canPick = r.state === 'valid';
                                const soon = r.state === 'valid' && d != null && d <= 60;
                                const stateTone = r.state === 'valid' ? (soon ? 'amber' : 'green') : ['expired', 'void', 'replaced', 'none'].includes(r.state) && r.in_company ? 'red' : 'slate';
                                return (
                                    <li key={r.employee_id} className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-slate-50', GRID)}>
                                        <input
                                            type="checkbox"
                                            className="order-1 h-4 w-4 accent-[var(--g-brand)] md:order-none"
                                            disabled={!canPick}
                                            checked={picked.includes(r.employee_id)}
                                            onChange={() => setPicked((p) => (p.includes(r.employee_id) ? p.filter((x) => x !== r.employee_id) : [...p, r.employee_id]))}
                                            aria-label={`Select ${r.name}`}
                                        />
                                        <span className="order-3 col-start-2 flex min-w-0 items-center gap-1.5 md:order-none md:col-start-auto">
                                            <span
                                                aria-hidden
                                                className={cn('h-2 w-2 shrink-0 rounded-full', { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', slate: 'bg-slate-400' }[stateTone])}
                                            />
                                            <span className="truncate text-xs font-semibold text-slate-700">{soon ? `${d} days left` : STATE_LABEL[r.state] || r.state}</span>
                                        </span>
                                        <button type="button" onClick={() => openWorkerProfile(r.employee_id)} className="order-2 col-start-2 flex min-w-0 items-center gap-2 text-left md:order-none md:col-start-auto">
                                            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ROLE_DOT[r.role] || ROLE_DOT.employee)} title={`${themeFor(r.role).label} card`} />
                                            <span className="min-w-0 truncate text-sm font-semibold text-slate-900 hover:text-[var(--g-brand-text)] hover:underline">
                                                {r.name} <span className="font-mono text-xs font-normal text-slate-400">{r.employee_id}</span>
                                            </span>
                                        </button>
                                        <span className="order-4 col-start-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 md:contents">
                                            <span className="font-mono tabular-nums md:text-slate-600">{r.card_number ? `•••• ${String(r.card_number).slice(-4)}` : '—'}</span>
                                            <span className="tabular-nums md:text-slate-600">
                                                <span className="md:hidden">valid to </span>
                                                {r.state === 'valid' ? fmtDate(r.valid_until) : '—'}
                                            </span>
                                            <span>
                                                {r.has_photo ? (
                                                    <span className="text-slate-500">Photo ✓</span>
                                                ) : r.in_company ? (
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">No photo</span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                            </span>
                                            <span>
                                                {r.state === 'valid' ? (
                                                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', r.physical_issued_at ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
                                                        {r.physical_issued_at ? 'Issued' : 'Digital only'}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                                {r.printed_count ? <span className="ml-1 text-[11px] text-slate-400">· printed {r.printed_count}×</span> : null}
                                            </span>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>
                            {rows ? `Showing ${page.length} of ${shown.length}` : ''}
                            {picked.length ? ` · ${picked.length} selected` : ''} · Click a person to renew, cancel or print their card, or link their logins.
                        </span>
                        {shown.length > limit ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                                Show more
                            </Button>
                        ) : null}
                    </div>
                </>
            ) : (
                <>
                    <ul className="mt-3 divide-y divide-[var(--g-hairline)] overflow-hidden rounded-xl border border-[var(--g-hairline)] text-sm">
                        {!scans ? (
                            <li className="flex items-center gap-2 p-4 text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                            </li>
                        ) : null}
                        {scans && !scans.length ? <li className="p-6 text-center text-slate-500">No scans yet.</li> : null}
                        {scanPage.map((x, i) => {
                            const bad = x.result === 'red' || x.result === 'not_found';
                            return (
                                <li key={i} className="flex items-center gap-3 px-3 py-2">
                                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', bad ? 'bg-red-500' : x.result === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-slate-900">{x.name || x.employee_id || 'Unknown code'}</span>
                                        <span className="block truncate text-xs capitalize text-slate-500">
                                            {bad ? 'Not cleared' : x.result === 'amber' ? 'Warning' : 'Cleared'} · {x.purpose} · {String(x.method || '—').replace('_', ' ')} · <span className="normal-case">{x.by || 'public'}</span>
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-xs tabular-nums text-slate-400">{new Date(x.at).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                </li>
                            );
                        })}
                    </ul>
                    {(scans || []).length > limit ? (
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span>
                                Showing {scanPage.length} of {scans.length}
                            </span>
                            <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                                Show more
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </section>
    );
}
