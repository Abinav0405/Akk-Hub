/**
 * Admin → Employees: worker information overview.
 *   Find a worker · Request information (many workers × many details) · Send information checks ·
 *   Export (employed / all / not in company) · status of every request and check · which details
 *   are required (missing ones are asked automatically).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, FileDown, IdCard, Loader2, Search, Send, Settings2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/hub/primitives';
import { cn } from '@/ui/utils';
import { UNIFIED } from '@/core/supabase';
import { INFO_FIELDS, labelOf } from './fields';
import { workerInfoAdmin } from './api';
import { ExportDialog, ExportWorkerTypeDialog, RequestInfoDialog, SendCheckDialog } from './AdminDialogs';
import { StatusPill, WorkerInfoAdminHost, openWorkerLookup, openWorkerProfile } from './WorkerProfile';
import { EXPIRY_NAME_CLASS, hasExpiryAlert, expiryAlertTitle } from './expiryAlert';

const when = (t) => (t ? new Date(t).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

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
    const attention = [
        ...(activity?.requests || []).filter((r) => r.status === 'review').map((r) => ({ ...r, kind: 'request' })),
        ...(activity?.checks || []).filter((c) => c.status === 'declined').map((c) => ({ ...c, kind: 'check' })),
        ...(activity?.requests || []).filter((r) => r.status === 'completed' && r.completed_at && Date.now() - new Date(r.completed_at) < 14 * 864e5).map((r) => ({ ...r, kind: 'request' })),
        ...(activity?.checks || []).filter((c) => c.status === 'approved' && Date.now() - new Date(c.responded_at) < 14 * 864e5).map((c) => ({ ...c, kind: 'check' })),
    ];
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

    return (
        <section className="rounded-2xl border border-[var(--g-hairline)] bg-white p-4 sm:p-5" aria-label="Worker information">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
                        <IdCard className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold tracking-tight text-slate-900">Worker information & ID cards</h2>
                        <p className="text-sm text-slate-500">Click any worker&apos;s ID or name below to open their card and details.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={openWorkerLookup}>
                        <Search className="h-4 w-4" /> Find a worker
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setDialog('request')} disabled={!directory}>
                        <Send className="h-4 w-4" /> Request information
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setDialog('check')} disabled={!directory}>
                        <ClipboardCheck className="h-4 w-4" /> Information check
                    </Button>
                </div>
            </div>

            {error ? <Banner tone="danger" className="mt-3">{error}</Banner> : null}

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                    ['Missing details', stats.missing, 'employed workers', stats.missing ? 'text-amber-700' : 'text-slate-900'],
                    ['Requests waiting', stats.pendingReq, 'for workers', 'text-slate-900'],
                    ['Checks waiting', stats.pendingChecks, 'for workers', 'text-slate-900'],
                    ['To correct', stats.declined, 'declined checks', stats.declined ? 'text-red-700' : 'text-slate-900'],
                ].map(([label, n, hint, tone]) => (
                    <div key={label} className="rounded-xl border border-[var(--g-hairline)] px-3 py-2.5">
                        <p className="text-xs font-semibold text-slate-500">{label}</p>
                        <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{directory ? n : '–'}</p>
                        <p className="text-[11px] text-slate-400">{hint}</p>
                    </div>
                ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Export:</span>
                <Button type="button" size="sm" variant="outline" onClick={() => startTypedExport('employed', 'all employed workers')} disabled={!directory}>
                    <FileDown className="h-3.5 w-3.5" /> All employed
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => startTypedExport('all', 'all workers')} disabled={!directory}>
                    <FileDown className="h-3.5 w-3.5" /> All workers
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => doExport('unemployed', 'workers not in company')}>
                    <FileDown className="h-3.5 w-3.5" /> Not in company
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setExportTarget({ pick: true, title: 'selected workers' })} disabled={!directory}>
                    <FileDown className="h-3.5 w-3.5" /> Choose workers…
                </Button>
            </div>

            <div className="mt-4 flex gap-1.5 border-b border-[var(--g-hairline)]">
                {[['attention', `Needs attention${attention.length ? ` (${attention.length})` : ''}`], ['requests', 'Requests'], ['checks', 'Information checks'], ['settings', 'Settings']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', tab === k ? 'border-[var(--g-brand)] text-[var(--g-brand-text)]' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                        {k === 'settings' ? <Settings2 className="mr-1 inline h-3.5 w-3.5" /> : null}
                        {l}
                    </button>
                ))}
            </div>

            {tab !== 'settings' ? (
                <ul className="max-h-80 divide-y divide-[var(--g-hairline)] overflow-y-auto">
                    {!activity ? (
                        <li className="flex items-center gap-2 py-4 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </li>
                    ) : null}
                    {activity && !rows.length ? <li className="py-6 text-center text-sm text-slate-500">Nothing here.</li> : null}
                    {rows.map((r) => (
                        <li key={`${r.kind}-${r.id}`}>
                            <button type="button" onClick={() => openWorkerProfile(r.employee_id)} className="flex w-full flex-wrap items-center gap-2 py-2.5 text-left hover:bg-slate-50">
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-slate-900">
                                        <span
                                            className={cn(hasExpiryAlert(byId[r.employee_id]) && EXPIRY_NAME_CLASS)}
                                            title={hasExpiryAlert(byId[r.employee_id]) ? expiryAlertTitle(byId[r.employee_id]) : undefined}
                                        >
                                            {r.name || r.employee_id}
                                        </span>{' '}
                                        <span className="font-normal text-slate-400">{r.employee_id}</span>
                                    </span>
                                    <span className="block truncate text-xs text-slate-500">
                                        {r.kind === 'request'
                                            ? `${r.auto ? 'Automatic request' : 'Request'}: ${r.fields.map((k) => labelOf(k, r.custom_labels)).join(', ')}`
                                            : r.status === 'declined'
                                              ? `Declined: “${r.decline_reason}”`
                                              : 'Information check'}
                                    </span>
                                </span>
                                <StatusPill status={r.status} />
                                <span className="text-xs text-slate-400">{when(r.completed_at || r.responded_at || r.created_at || r.sent_at)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
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
            <WorkerInfoAdminHost />
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
