/**
 * Admin: one worker's ID card + information + actions, as a sheet that opens from anywhere
 * (`openWorkerProfile(id)` — worker tables, the lookup, the activity list). Also the redesigned
 * worker lookup (`openWorkerLookup()`). Both are mounted once by <WorkerInfoAdminHost/>.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
    AlertTriangle, CheckCircle2, ClipboardCheck, Clock, FileDown, History, Loader2, Pencil, Search, Send, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/hub/primitives';
import { cn } from '@/ui/utils';
import AdminCardView from '@/features/cards/AdminCardView';
import {
    BASE_FIELDS, FIELD_BY_KEY, GROUPS, INFO_FIELDS, customFieldDefs, daysUntil, formatValue, labelOf, showField,
} from './fields';
import { workerInfoAdmin } from './api';
import { openWorkerEdit } from './EditWorkerExtras';
import { ExportDialog, RequestInfoDialog, SendCheckDialog } from './AdminDialogs';

/* ---------------- tiny store: which sheet is open ---------------- */
let state = { profileId: null, lookup: false, lookupMode: 'view', nonce: 0 };
const listeners = new Set();
const emit = (patch) => {
    state = { ...state, ...patch, nonce: state.nonce + 1 };
    listeners.forEach((l) => l());
};
export const openWorkerProfile = (id) => emit({ profileId: String(id), lookup: false });
/** mode 'view' opens the worker's profile; 'edit' goes straight to the Edit Worker dialog. */
export const openWorkerLookup = (mode = 'view') => emit({ lookup: true, lookupMode: mode === 'edit' ? 'edit' : 'view' });
const useSheets = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);

/* ---------------- shared bits ---------------- */
function Field({ label, value, warn }) {
    return (
        <div className="min-w-0 rounded-xl border border-[var(--g-hairline)] bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={cn('mt-0.5 break-words text-sm font-medium', value ? 'text-slate-900' : 'italic text-slate-400')}>
                {value || 'Not provided'}
                {warn ? <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold not-italic', warn.tone)}>{warn.text}</span> : null}
            </p>
        </div>
    );
}

function expiryWarn(key, value) {
    if (FIELD_BY_KEY[key]?.kind !== 'date' || !key.endsWith('_expiry_date')) return null;
    const d = daysUntil(value);
    if (d == null) return null;
    if (d < 0) return { text: 'Expired', tone: 'bg-red-50 text-red-700' };
    if (d <= 60) return { text: `${d} days left`, tone: 'bg-amber-50 text-amber-800' };
    return null;
}

const STATUS_TONE = {
    pending: 'bg-amber-50 text-amber-800',
    review: 'bg-sky-50 text-sky-800',
    rejected: 'bg-red-50 text-red-700',
    completed: 'bg-emerald-50 text-emerald-800',
    approved: 'bg-emerald-50 text-emerald-800',
    declined: 'bg-red-50 text-red-700',
    resolved: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-slate-100 text-slate-500',
};
export const StatusPill = ({ status }) => (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', STATUS_TONE[status])}>{status === 'review' ? 'needs approval' : status}</span>
);
const when = (t) => (t ? new Date(t).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/* ---------------- profile sheet ---------------- */
function WorkerProfileSheet({ id, open, onClose, directory, reloadDirectory }) {
    const [p, setP] = useState(null);
    const [error, setError] = useState('');
    const [dialog, setDialog] = useState(null); // 'request' | 'check' | 'export'
    const [resolveNote, setResolveNote] = useState('');

    const load = useCallback(async () => {
        if (!id) return;
        setError('');
        try {
            const data = await workerInfoAdmin.profile(id);
            if (!data) throw new Error(`No worker with ID ${id}`);
            setP(data);
        } catch (e) {
            setError(e.message);
        }
    }, [id]);
    useEffect(() => {
        if (open) {
            setP(null);
            load();
        }
    }, [open, load]);

    const infoFields = useMemo(() => [...INFO_FIELDS.filter((f) => showField(f, p?.worker_type, p?.info?.[f.key])), ...customFieldDefs(p?.custom_labels)], [p]);
    const baseSrc = (key) => (p?.base || p)?.[key];
    const startEdit = () => {
        onClose();
        openWorkerEdit(p.employee_id, p.worker_type);
    };

    const openRequests = (p?.requests || []).filter((r) => r.status === 'pending');
    const reviewing = (p?.requests || []).filter((r) => r.status === 'review');
    const [reviewNote, setReviewNote] = useState('');
    const review = async (r, approve) => {
        try {
            await workerInfoAdmin.reviewRequest(r.id, approve, reviewNote);
            setReviewNote('');
            toast.success(approve ? 'Approved and saved to the employee record' : 'Rejected — nothing was changed');
            load();
            reloadDirectory?.();
        } catch (e) {
            toast.error(e.message);
        }
    };
    const declined = (p?.checks || []).find((c) => c.status === 'declined');

    return (
        <>
            <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{p ? p.name : 'Worker'}</DialogTitle>
                        <DialogDescription>{p ? `Employee ${p.employee_id} · ${p.worker_type === 'local' ? 'Local' : 'Foreign'} worker` : 'Loading…'}</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
                        {error ? <Banner tone="danger">{error}</Banner> : null}
                        {!p && !error ? (
                            <div className="flex justify-center py-10">
                                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                            </div>
                        ) : null}
                        {p ? (
                            <>
                                <div className="grid gap-4 md:grid-cols-[minmax(0,440px)_1fr]">
                                    <AdminCardView employeeId={p.employee_id} onChanged={reloadDirectory} />
                                    <div className="space-y-2">
                                        {p.missing?.length ? (
                                            <Banner tone="warning">
                                                Missing: {p.missing.map((k) => labelOf(k, p.custom_labels)).join(', ')}
                                            </Banner>
                                        ) : (
                                            <Banner tone="success">All required details are on file.</Banner>
                                        )}
                                        <div className="grid grid-cols-2 gap-2">
                                            <Button type="button" variant="outline" onClick={() => setDialog('request')}>
                                                <Send className="h-4 w-4" /> Request information
                                            </Button>
                                            <Button type="button" variant="outline" onClick={() => setDialog('check')}>
                                                <ClipboardCheck className="h-4 w-4" /> Send information check
                                            </Button>
                                            <Button type="button" variant="outline" onClick={() => setDialog('export')}>
                                                <FileDown className="h-4 w-4" /> Export details
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                    onClose();
                                                    window.dispatchEvent(new CustomEvent('akk:worker-records', { detail: { id: p.employee_id } }));
                                                }}
                                            >
                                                <History className="h-4 w-4" /> Timesheets & payslips
                                            </Button>
                                        </div>
                                        {reviewing.map((r) => (
                                            <div key={r.id} className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm">
                                                <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-sky-900">
                                                    <ClipboardCheck className="h-4 w-4" /> Sent by the worker — approve to save to their record
                                                </p>
                                                <ul className="space-y-1">
                                                    {Object.entries(r.submitted || {}).map(([k, v]) => (
                                                        <li key={k} className="flex flex-wrap items-baseline gap-x-2">
                                                            <span className="text-xs font-semibold uppercase tracking-wide text-sky-800">{labelOf(k, p.custom_labels)}</span>
                                                            <span className="text-slate-500 line-through">{formatValue(k, (p.base || p)[k]) || 'empty'}</span>
                                                            <span aria-hidden>→</span>
                                                            <span className="font-semibold text-slate-900">{String(v)}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Note to the worker if rejected" className="h-9 min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-2.5 text-sm" />
                                                    <Button type="button" size="sm" onClick={() => review(r, true)}>
                                                        <CheckCircle2 className="h-4 w-4" /> Approve
                                                    </Button>
                                                    <Button type="button" size="sm" variant="outline" onClick={() => review(r, false)}>
                                                        <XCircle className="h-4 w-4" /> Reject
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        {openRequests.length ? (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                                                <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-900">
                                                    <Clock className="h-4 w-4" /> Waiting for the worker
                                                </p>
                                                <ul className="space-y-1">
                                                    {openRequests.map((r) => (
                                                        <li key={r.id} className="flex items-start justify-between gap-2">
                                                            <span>
                                                                {r.fields.map((k) => labelOf(k, p.custom_labels)).join(', ')}
                                                                <span className="text-xs text-amber-800/80"> · {r.auto ? 'automatic' : 'asked'} {when(r.created_at)}</span>
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="shrink-0 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline"
                                                                onClick={async () => {
                                                                    await workerInfoAdmin.cancelRequest(r.id).catch((e) => toast.error(e.message));
                                                                    load();
                                                                }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                {declined ? (
                                    <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 text-sm">
                                        <p className="flex items-center gap-1.5 font-semibold text-red-800">
                                            <XCircle className="h-4 w-4" /> Worker says some details are wrong ({when(declined.responded_at)})
                                        </p>
                                        <p className="mt-1 text-red-900">“{declined.decline_reason}”</p>
                                        {declined.decline_fields?.length ? (
                                            <p className="mt-1 text-xs text-red-800">Fields: {declined.decline_fields.map((k) => labelOf(k, p.custom_labels)).join(', ')}</p>
                                        ) : null}
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="What you corrected (optional)" className="h-9 min-w-0 flex-1 rounded-lg border border-red-200 bg-white px-2.5 text-sm" />
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={async () => {
                                                    try {
                                                        await workerInfoAdmin.resolveCheck(declined.id, resolveNote);
                                                        setResolveNote('');
                                                        toast.success('Marked as corrected');
                                                        load();
                                                    } catch (e) {
                                                        toast.error(e.message);
                                                    }
                                                }}
                                            >
                                                <CheckCircle2 className="h-4 w-4" /> Mark corrected
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('check')}>
                                                Send a new check
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}

                                <section>
                                    <div className="mb-2 flex items-center justify-between">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Employee details</h3>
                                        <Button type="button" size="sm" variant="outline" onClick={startEdit}>
                                            <Pencil className="h-3.5 w-3.5" /> Edit details
                                        </Button>
                                    </div>
                                    <div className="space-y-4">
                                        {GROUPS.map((g) => {
                                            const base = BASE_FIELDS.filter((f) => f.group === g.key && showField(f, p.worker_type, baseSrc(f.key)));
                                            const mine = infoFields.filter((f) => f.group === g.key);
                                            if (!base.length && !mine.length) return null;
                                            return (
                                                <div key={g.key}>
                                                    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h4>
                                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                                        {base.map((f) => (
                                                            <Field key={f.key} label={f.label} value={formatValue(f.key, baseSrc(f.key))} />
                                                        ))}
                                                        {mine.map((f) => (
                                                            <Field key={f.key} label={f.label} value={formatValue(f.key, p.info?.[f.key])} warn={expiryWarn(f.key, p.info?.[f.key])} />
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>

                                {(p.checks || []).length || (p.requests || []).length ? (
                                    <section>
                                        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h3>
                                        <ul className="divide-y divide-[var(--g-hairline)] rounded-xl border border-[var(--g-hairline)] bg-white text-sm">
                                            {[
                                                ...(p.checks || []).map((c) => ({ at: c.responded_at || c.sent_at, kind: 'Information check', status: c.status, text: c.decline_reason || c.resolution_note || '' })),
                                                ...(p.requests || []).map((r) => ({ at: r.completed_at || r.created_at, kind: r.auto ? 'Automatic request' : 'Request', status: r.status, text: r.fields.map((k) => labelOf(k, p.custom_labels)).join(', ') })),
                                            ]
                                                .sort((a, b) => String(b.at).localeCompare(String(a.at)))
                                                .slice(0, 12)
                                                .map((h, i) => (
                                                    <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                                        <span className="font-medium">{h.kind}</span>
                                                        <StatusPill status={h.status} />
                                                        <span className="min-w-0 flex-1 truncate text-slate-600">{h.text}</span>
                                                        <span className="text-xs text-slate-400">{when(h.at)}</span>
                                                    </li>
                                                ))}
                                        </ul>
                                    </section>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>
            {p ? (
                <>
                    <RequestInfoDialog open={dialog === 'request'} onClose={() => setDialog(null)} workers={directory} initialIds={[p.employee_id]} initialFields={p.missing || []} onDone={load} />
                    <SendCheckDialog open={dialog === 'check'} onClose={() => setDialog(null)} workers={directory} initialIds={[p.employee_id]} onDone={load} />
                    <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} target={{ ids: [p.employee_id], title: p.name }} />
                </>
            ) : null}
        </>
    );
}

/* ---------------- lookup (redesigned "Search worker") ---------------- */
function WorkerLookup({ open, onClose, directory, loading, mode = 'view' }) {
    const pick = (w) => {
        if (mode === 'edit') {
            onClose();
            openWorkerEdit(w.employee_id, w.worker_type);
        } else openWorkerProfile(w.employee_id);
    };
    const [q, setQ] = useState('');
    const [scope, setScope] = useState('employed');
    useEffect(() => {
        if (open) setQ('');
    }, [open]);
    const results = useMemo(() => {
        const s = q.trim().toLowerCase();
        return (directory || [])
            .filter((w) => scope === 'all' || (scope === 'employed' ? w.in_company : !w.in_company))
            .filter((w) => !s || `${w.employee_id} ${w.name} ${w.work_permit_no || ''}`.toLowerCase().includes(s))
            .slice(0, 80);
    }, [directory, q, scope]);
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{mode === 'edit' ? 'Edit a worker' : 'Find a worker'}</DialogTitle>
                    <DialogDescription>Search by employee ID, name or work permit number.</DialogDescription>
                </DialogHeader>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                        autoFocus
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && results[0] && pick(results[0])}
                        placeholder="e.g. 1006, Ganesan, 0 38281712"
                        className="h-12 w-full rounded-2xl border border-[var(--g-hairline)] bg-white pl-11 pr-3 text-base shadow-sm"
                    />
                </div>
                <div className="flex gap-1.5">
                    {[['employed', 'Employed'], ['unemployed', 'Not in company'], ['all', 'All']].map(([k, l]) => (
                        <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={cn('min-h-9 rounded-full border px-3 text-sm font-semibold', scope === k ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]' : 'border-slate-200 text-slate-600')}>
                            {l}
                        </button>
                    ))}
                </div>
                <ul className="max-h-[50vh] divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-2xl border border-[var(--g-hairline)] bg-white">
                    {loading ? (
                        <li className="flex items-center gap-2 p-4 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading workers…
                        </li>
                    ) : null}
                    {!loading && !results.length ? <li className="p-4 text-center text-sm text-slate-500">No worker matches “{q}”.</li> : null}
                    {results.map((w) => (
                        <li key={w.employee_id}>
                            <button type="button" onClick={() => pick(w)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold', w.in_company ? 'bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]' : 'bg-red-50 text-red-700')}>
                                    {String(w.name || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-slate-900">{w.name}</span>
                                    <span className="block truncate text-xs text-slate-500">
                                        {w.employee_id} · {w.designation || (w.worker_type === 'local' ? 'Local' : 'Foreign')}
                                        {w.work_permit_no ? ` · WP ${w.work_permit_no}` : ''}
                                    </span>
                                </span>
                                {w.missing?.length ? (
                                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title={w.missing.map((k) => labelOf(k)).join(', ')}>
                                        <AlertTriangle className="h-3 w-3" /> {w.missing.length} missing
                                    </span>
                                ) : null}
                                {!w.in_company ? <span className="shrink-0 text-[11px] font-semibold text-red-700">Left</span> : null}
                            </button>
                        </li>
                    ))}
                </ul>
            </DialogContent>
        </Dialog>
    );
}

/** Mount once (admins): owns the directory + the lookup + profile sheets. */
export function WorkerInfoAdminHost() {
    const s = useSheets();
    const [directory, setDirectory] = useState(null);
    const [loading, setLoading] = useState(false);
    const reloadDirectory = useCallback(async () => {
        setLoading(true);
        try {
            setDirectory(await workerInfoAdmin.directory('all'));
        } catch (e) {
            toast.error(e.message);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        if ((s.lookup || s.profileId) && !directory && !loading) reloadDirectory();
    }, [s.lookup, s.profileId, directory, loading, reloadDirectory]);
    return (
        <>
            <WorkerLookup open={s.lookup && !s.profileId} mode={s.lookupMode} onClose={() => emit({ lookup: false })} directory={directory} loading={loading && !directory} />
            <WorkerProfileSheet
                id={s.profileId}
                open={Boolean(s.profileId)}
                onClose={() => emit({ profileId: null })}
                directory={directory || []}
                reloadDirectory={reloadDirectory}
            />
        </>
    );
}
