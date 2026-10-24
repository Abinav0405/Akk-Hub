/**
 * Admin → Employees: worker information overview.
 *   Find a worker · Request information (many workers × many details) · Send information checks ·
 *   Export (employed / all / not in company) · status of every request and check · which details
 *   are required (missing ones are asked automatically).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck, FileDown, Loader2, Search, Send, Settings2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/hub/primitives';
import { cn } from '@/ui/utils';
import { UNIFIED } from '@/core/supabase';
import { INFO_FIELDS, labelOf } from './fields';
import { workerInfoAdmin } from './api';
import { ExportDialog, ExportWorkerTypeDialog, RequestInfoDialog, SendCheckDialog } from './AdminDialogs';
import { StatusPill, openWorkerLookup, openWorkerProfile } from './WorkerProfile';
import { EXPIRY_NAME_CLASS, hasExpiryAlert, expiryAlertTitle } from './expiryAlert';

const PAGE = 15;
const RECENT_MS = 14 * 864e5;
/** Keep finished items on the default Requests / Checks list for this long, then hide. */
const KEEP_DONE_MS = 2 * 864e5;
/** Finished request/check statuses — shown for KEEP_DONE_MS after finish, then hidden by default. */
const DONE_STATUSES = new Set(['completed', 'approved', 'rejected', 'resolved', 'cancelled']);
const when = (t) => (t ? new Date(t).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Best finish/update time on an activity row (requests use completed_at; checks use responded_at / resolved_at). */
function finishAt(r) {
    return r.completed_at || r.resolved_at || r.responded_at || r.updated_at || r.created_at || r.sent_at || null;
}

/** Open statuses always; finished statuses only if finished within KEEP_DONE_MS. */
function keepOnDefaultList(r) {
    if (!DONE_STATUSES.has(r.status)) return true;
    const at = finishAt(r);
    return Boolean(at) && Date.now() - new Date(at).getTime() < KEEP_DONE_MS;
}

/** Filter directory rows for bulk export by employment scope + foreign/local. */
function exportIdsFor(workers, scope, workerType) {
    return (workers || [])
        .filter((w) => w.worker_type === workerType)
        .filter((w) => (scope === 'employed' ? w.in_company : true))
        .map((w) => w.employee_id);
}

export default function WorkerInfoCenter() {
    const [directory, setDirectory] = useState(null);
    const [activity, setActivity] = useState(null);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('attention');
    const [dialog, setDialog] = useState(null);
    const [exportTarget, setExportTarget] = useState(null);
    /** Pending bulk export that needs foreign/local first: { scope, titleStem } */
    const [typePick, setTypePick] = useState(null);
    const [settings, setSettings] = useState(null);
    const [busy, setBusy] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [limit, setLimit] = useState(PAGE);
    const exportMenu = useRef(null);

    const load = useCallback(async () => {
        try {
            const [d, a] = await Promise.all([workerInfoAdmin.directory('all'), workerInfoAdmin.activity()]);
            setDirectory(d);
            setActivity(a);
            setSettings(a.settings);
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, []);
    useEffect(() => {
        if (UNIFIED) load();
    }, [load]);

    const stats = useMemo(() => {
        const employed = (directory || []).filter((w) => w.in_company);
        return {
            missing: employed.filter((w) => w.missing?.length).length,
            pendingReq: (activity?.requests || []).filter((r) => r.status === 'pending').length,
            pendingChecks: (activity?.checks || []).filter((c) => c.status === 'pending').length,
            declined: (activity?.checks || []).filter((c) => c.status === 'declined').length,
        };
    }, [directory, activity]);

    if (!UNIFIED) return null;

    const byId = Object.fromEntries((directory || []).map((w) => [w.employee_id, w]));
    // Open items first (need an admin decision); recently finished ones follow, marked as such.
    const attention = [
        ...(activity?.requests || []).filter((r) => r.status === 'review').map((r) => ({ ...r, kind: 'request' })),
        ...(activity?.checks || []).filter((c) => c.status === 'declined').map((c) => ({ ...c, kind: 'check' })),
        ...(activity?.requests || []).filter((r) => r.status === 'completed' && r.completed_at && Date.now() - new Date(r.completed_at) < RECENT_MS).map((r) => ({ ...r, kind: 'request', recent: true })),
        ...(activity?.checks || []).filter((c) => c.status === 'approved' && Date.now() - new Date(c.responded_at) < RECENT_MS).map((c) => ({ ...c, kind: 'check', recent: true })),
    ];
    const openCount = attention.filter((r) => !r.recent).length;
    const rows = tab === 'attention' ? attention : tab === 'requests' ? (activity?.requests || []).map((r) => ({ ...r, kind: 'request' })) : (activity?.checks || []).map((c) => ({ ...c, kind: 'check' }));

    const doExport = (scope, title) => setExportTarget({ scope, title });

    /** All employed / All workers: ask foreign vs local, then open ExportDialog with filtered ids. */
    const startTypedExport = (scope, titleStem) => {
        if (!directory) {
            toast.error('Worker list is still loading.');
            return;
        }
        setTypePick({ scope, titleStem });
    };

    const onWorkerTypeChosen = (workerType) => {
        if (!typePick) return;
        const { scope, titleStem } = typePick;
        setTypePick(null);
        const ids = exportIdsFor(directory, scope, workerType);
        if (!ids.length) {
            toast.error(`No ${workerType} workers to export.`);
            return;
        }
        const typeLabel = workerType === 'local' ? 'local' : 'foreign';
        setExportTarget({
            scope,
            workerType,
            ids,
            title: `${titleStem} (${typeLabel})`,
        });
    };

    const statuses = [...new Set(rows.map((r) => r.status))];
    const hideStaleDoneByDefault = tab === 'requests' || tab === 'checks';
    const shownRows =
        statusFilter === '__all__'
            ? rows
            : statusFilter
              ? rows.filter((r) => r.status === statusFilter)
              : hideStaleDoneByDefault
                ? rows.filter(keepOnDefaultList)
                : rows;
    const page = shownRows.slice(0, limit);
    const firstRecent = page.findIndex((r) => r.recent);

    return (
        <section className="min-w-0 rounded-2xl border border-[var(--g-hairline)] bg-white p-3 sm:p-4" aria-label="Worker information">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight text-slate-900">Worker information</h2>
                    <p className="text-sm text-slate-500">Requests, information checks and required details. Click a worker to open their details and ID card.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" className="h-9" onClick={openWorkerLookup}>
                        <Search className="h-4 w-4" /> Find a worker
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setDialog('request')} disabled={!directory}>
                        <Send className="h-4 w-4" /> Request information
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setDialog('check')} disabled={!directory}>
                        <ClipboardCheck className="h-4 w-4" /> Information check
                    </Button>
                    <details ref={exportMenu} className="relative">
                        <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--g-hairline)] bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)] [&::-webkit-details-marker]:hidden">
                            <FileDown className="h-4 w-4" /> Export <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        </summary>
                        <div className="absolute left-0 z-40 mt-1 w-52 overflow-hidden sm:left-auto sm:right-0 rounded-xl border border-[var(--g-hairline)] bg-white py-1 shadow-lg">
                            {[
                                ['All employed', () => startTypedExport('employed', 'all employed workers'), !directory],
                                ['All workers', () => startTypedExport('all', 'all workers'), !directory],
                                ['Not in company', () => doExport('unemployed', 'workers not in company'), false],
                                ['Choose workers…', () => setExportTarget({ pick: true, title: 'selected workers' }), !directory],
                            ].map(([l, fn, off]) => (
                                <button
                                    key={l}
                                    type="button"
                                    disabled={off}
                                    onClick={() => {
                                        exportMenu.current?.removeAttribute('open');
                                        fn();
                                    }}
                                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                    {l}
                                </button>
                            ))}
                        </div>
                    </details>
                </div>
            </div>

            {error ? <Banner tone="danger" className="mt-3">{error}</Banner> : null}

            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {[
                    ['Missing details', stats.missing, 'employed workers', stats.missing ? 'text-amber-700' : 'text-slate-900'],
                    ['Requests waiting', stats.pendingReq, 'sent to workers', 'text-slate-900'],
                    ['Checks waiting', stats.pendingChecks, 'sent to workers', 'text-slate-900'],
                    ['To correct', stats.declined, 'declined checks', stats.declined ? 'text-red-700' : 'text-slate-900'],
                ].map(([label, n, hint, tone]) => (
                    <div key={label} className="min-w-0 rounded-xl border border-[var(--g-hairline)] bg-slate-50/60 px-3 py-2">
                        <p className="truncate text-xs font-semibold text-slate-500">{label}</p>
                        <p className={cn('text-xl font-semibold leading-tight tabular-nums', tone)}>{directory ? n : '–'}</p>
                        <p className="truncate text-[11px] text-slate-400">{hint}</p>
                    </div>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-b border-[var(--g-hairline)]">
                <div role="tablist" aria-label="Information sections" className="-mb-px flex max-w-full gap-1 overflow-x-auto">
                    {[
                        ['attention', 'Needs attention', openCount],
                        ['requests', 'Requests', null],
                        ['checks', 'Information checks', null],
                        ['settings', 'Settings', null],
                    ].map(([k, l, n]) => (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={tab === k}
                            onClick={() => {
                                setTab(k);
                                setStatusFilter('');
                                setLimit(PAGE);
                            }}
                            className={cn(
                                'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--g-brand)]',
                                tab === k ? 'border-[var(--g-brand)] text-[var(--g-brand-text)]' : 'border-transparent text-slate-500 hover:text-slate-800',
                            )}
                        >
                            {k === 'settings' ? <Settings2 className="h-3.5 w-3.5" /> : null}
                            {l}
                            {n ? <span className="rounded-full bg-[var(--g-brand)] px-1.5 text-[11px] font-bold text-white tabular-nums">{n}</span> : null}
                        </button>
                    ))}
                </div>
                {tab !== 'settings' && statuses.length > 1 ? (
                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value);
                            setLimit(PAGE);
                        }}
                        aria-label="Filter by status"
                        className="mb-1.5 h-8 rounded-lg border border-[var(--g-hairline)] bg-white px-2 text-sm capitalize"
                    >
                        {hideStaleDoneByDefault ? (
                            <>
                                <option value="">Open & recent</option>
                                <option value="__all__">All statuses</option>
                            </>
                        ) : (
                            <option value="">All statuses</option>
                        )}
                        {statuses.map((st) => (
                            <option key={st} value={st}>
                                {st === 'review' ? 'needs approval' : st}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>

            {tab !== 'settings' ? (
                <div className="pt-1">
                    <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_7rem_7.5rem_1rem] gap-3 px-2 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500 md:grid">
                        <span>Worker</span>
                        <span>Information / issue</span>
                        <span>Status</span>
                        <span>Updated</span>
                        <span />
                    </div>
                    <ul className="divide-y divide-[var(--g-hairline)] border-t border-[var(--g-hairline)] md:border-t-0">
                        {!activity ? (
                            <li className="flex items-center gap-2 py-4 text-sm text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                            </li>
                        ) : null}
                        {activity && !shownRows.length ? (
                            <li className="py-8 text-center text-sm text-slate-500">{tab === 'attention' ? 'Nothing needs your attention.' : 'Nothing here.'}</li>
                        ) : null}
                        {page.map((r, i) => (
                            <li key={`${r.kind}-${r.id}`}>
                                {i === firstRecent ? (
                                    <p className="bg-slate-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recently completed · last 14 days</p>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => openWorkerProfile(r.employee_id)}
                                    className={cn(
                                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--g-brand)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_7rem_7.5rem_1rem]',
                                        r.recent && 'opacity-80',
                                    )}
                                >
                                    <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                                        <span
                                            className={cn(hasExpiryAlert(byId[r.employee_id]) && EXPIRY_NAME_CLASS)}
                                            title={hasExpiryAlert(byId[r.employee_id]) ? expiryAlertTitle(byId[r.employee_id]) : undefined}
                                        >
                                            {r.name || r.employee_id}
                                        </span>{' '}
                                        <span className="font-mono text-xs font-normal text-slate-400">{r.employee_id}</span>
                                    </span>
                                    <span className="col-start-1 row-start-2 min-w-0 truncate text-xs text-slate-500 md:col-start-auto md:row-start-auto md:text-sm md:text-slate-600">
                                        {r.kind === 'request'
                                            ? `${r.auto ? 'Automatic request' : 'Request'}: ${r.fields.map((k) => labelOf(k, r.custom_labels)).join(', ')}`
                                            : r.status === 'declined'
                                              ? `Declined: “${r.decline_reason}”`
                                              : 'Information check'}
                                    </span>
                                    <span className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-start">
                                        <StatusPill status={r.status} />
                                    </span>
                                    <span className="col-start-2 row-start-2 justify-self-end whitespace-nowrap text-xs tabular-nums text-slate-400 md:col-start-auto md:row-start-auto md:justify-self-start">
                                        {when(r.completed_at || r.responded_at || r.created_at || r.sent_at)}
                                    </span>
                                    <ChevronRight className="hidden h-4 w-4 text-slate-300 md:block" />
                                </button>
                            </li>
                        ))}
                    </ul>
                    {shownRows.length > limit ? (
                        <div className="flex items-center justify-between gap-2 border-t border-[var(--g-hairline)] pt-2 text-xs text-slate-500">
                            <span>
                                Showing {page.length} of {shownRows.length}
                            </span>
                            <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                                Show more
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : (
                <SettingsPanel
                    settings={settings}
                    busy={busy}
                    onSave={async (required, auto) => {
                        setBusy('save');
                        try {
                            await workerInfoAdmin.setSettings(required, auto);
                            setSettings({ required_fields: required, auto_request: auto });
                            toast.success('Saved');
                            load();
                        } catch (e) {
                            toast.error(e.message);
                        } finally {
                            setBusy('');
                        }
                    }}
                    onAskAll={async () => {
                        setBusy('ask');
                        try {
                            const r = await workerInfoAdmin.requestMissing();
                            toast.success(`Asked ${r.created} worker${r.created === 1 ? '' : 's'} for missing details`);
                            load();
                        } catch (e) {
                            toast.error(e.message);
                        } finally {
                            setBusy('');
                        }
                    }}
                />
            )}

            <RequestInfoDialog open={dialog === 'request'} onClose={() => setDialog(null)} workers={directory || []} onDone={load} />
            <SendCheckDialog open={dialog === 'check'} onClose={() => setDialog(null)} workers={directory || []} onDone={load} />
            <ExportWorkerTypeDialog
                open={Boolean(typePick)}
                onClose={() => setTypePick(null)}
                onChoose={onWorkerTypeChosen}
                title={typePick?.scope === 'employed' ? 'Export all employed' : 'Export all workers'}
            />
            <ExportDialog open={Boolean(exportTarget)} onClose={() => setExportTarget(null)} target={exportTarget || {}} workers={directory || []} />
        </section>
    );
}

function SettingsPanel({ settings, busy, onSave, onAskAll }) {
    const [req, setReq] = useState(settings?.required_fields || []);
    const [auto, setAuto] = useState(settings?.auto_request !== false);
    useEffect(() => {
        setReq(settings?.required_fields || []);
        setAuto(settings?.auto_request !== false);
    }, [settings]);
    return (
        <div className="space-y-3 pt-3 text-sm">
            <p className="text-slate-600">
                Required details are checked for every employed worker. Missing ones are shown here and asked automatically (one request per worker, never twice
                while it is still open).
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
                {INFO_FIELDS.map((f) => (
                    <label key={f.key} className="flex min-h-9 items-center gap-2 rounded-lg px-2 hover:bg-slate-50">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--g-brand)]" checked={req.includes(f.key)} onChange={() => setReq((r) => (r.includes(f.key) ? r.filter((x) => x !== f.key) : [...r, f.key]))} />
                        {f.label}
                        {f.applies === 'foreign' ? <span className="text-xs text-slate-400">(foreign workers)</span> : null}
                    </label>
                ))}
            </div>
            <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" className="h-4 w-4 accent-[var(--g-brand)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Ask workers automatically when they open the app
            </label>
            <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => onSave(req, auto)} disabled={busy === 'save'}>
                    Save settings
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onAskAll} disabled={busy === 'ask'}>
                    {busy === 'ask' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Ask everyone for missing details now
                </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <AlertTriangle className="h-3.5 w-3.5" /> Workers only ever see the details they are asked for, and their own ID card.
            </p>
        </div>
    );
}
