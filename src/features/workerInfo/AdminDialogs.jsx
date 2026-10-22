/**
 * Admin dialogs for worker information:
 *   ExportWorkerTypeDialog — foreign vs local before bulk export
 *   ExportDialog           — choose the details to include → one-page-per-worker PDF
 *   RequestInfoDialog      — ask one or many workers for one or many details
 *   SendCheckDialog        — send Worker Information Checks to one or many workers
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, FileDown, FileSpreadsheet, FileText, Loader2, Plus, Search, Send, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/hub/primitives';
import { cn } from '@/ui/utils';
import { ASKABLE_FIELDS, EXPORT_FIELDS, GROUPS, LABEL, customFieldDefs } from './fields';
import { workerInfoAdmin } from './api';
import { downloadWorkerInfoPdf } from './exportPdf';
import { downloadWorkerInfoExcel } from './exportExcel';

const DEFAULT_EXPORT = ['designation', 'in_company', 'date_joined', 'work_permit_no', 'permit_expiry_date', 'hp_number', 'nationality'];

/**
 * Ask foreign vs local before exporting "All employed" / "All workers".
 * @param {{ open: boolean, onClose: () => void, onChoose: (type: 'foreign'|'local') => void, title?: string }} props
 */
export function ExportWorkerTypeDialog({ open, onClose, onChoose, title = 'Export workers' }) {
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>Export foreign workers or local (Singapore / PR) workers?</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                    <Button type="button" className="w-full justify-center" onClick={() => onChoose('foreign')}>
                        Foreign workers
                    </Button>
                    <Button type="button" variant="outline" className="w-full justify-center" onClick={() => onChoose('local')}>
                        Local workers
                    </Button>
                </div>
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FieldPicker({ fields, selected, setSelected }) {
    const groups = GROUPS.map((g) => ({ ...g, items: fields.filter((f) => f.group === g.key) })).filter((g) => g.items.length);
    const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    const toggleGroup = (items) => {
        const keys = items.map((f) => f.key);
        const all = keys.every((k) => selected.includes(k));
        setSelected((s) => (all ? s.filter((k) => !keys.includes(k)) : [...new Set([...s, ...keys])]));
    };
    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setSelected(fields.map((f) => f.key))}>
                    Select all
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>
                    Clear
                </Button>
                <span className="ml-auto self-center text-xs text-slate-500">{selected.length} selected</span>
            </div>
            {groups.map((g) => {
                const all = g.items.every((f) => selected.includes(f.key));
                return (
                    <fieldset key={g.key} className="rounded-xl border border-[var(--g-hairline)] p-3">
                        <legend className="px-1">
                            <button type="button" onClick={() => toggleGroup(g.items)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                                {all ? <CheckSquare className="h-4 w-4 text-[var(--g-brand)]" /> : <Square className="h-4 w-4 text-slate-400" />}
                                {g.label}
                            </button>
                        </legend>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {g.items.map((f) => (
                                <label key={f.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-slate-50">
                                    <input type="checkbox" className="h-4 w-4 accent-[var(--g-brand)]" checked={selected.includes(f.key)} onChange={() => toggle(f.key)} />
                                    {f.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                );
            })}
        </div>
    );
}

/**
 * @param {{ open, onClose, target: { ids?: string[], scope?: 'all'|'employed'|'unemployed', workerType?: 'foreign'|'local', title: string, pick?: boolean } }} props
 */
export function ExportDialog({ open, onClose, target, workers = [] }) {
    const [selected, setSelected] = useState(DEFAULT_EXPORT);
    const [format, setFormat] = useState('pdf'); // pdf | xlsx
    const [picked, setPicked] = useState([]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');
    const [custom, setCustom] = useState([]);
    useEffect(() => {
        if (open) {
            setError('');
            setProgress('');
            setPicked([]);
            const single = target?.ids?.length === 1;
            setSelected(single ? EXPORT_FIELDS.map((x) => x.key) : DEFAULT_EXPORT);
            workerInfoAdmin.customLabels().then((l) => { const defs = customFieldDefs(l); setCustom(defs); if (single) setSelected((s) => [...s, ...defs.map((d) => d.key)]); }).catch(() => setCustom([]));
        }
    }, [open]);
    const allFields = useMemo(() => [...EXPORT_FIELDS, ...custom], [custom]);

    const run = async () => {
        setBusy(true);
        setError('');
        try {
            setProgress('Collecting worker details…');
            const ids = target.pick ? picked : target.ids || null;
            if (target.pick && !ids.length) throw new Error('Choose at least one worker.');
            if (ids && !ids.length) throw new Error('No workers to export for that type.');
            const rows = await workerInfoAdmin.exportWorkers(ids, target.scope || 'all', selected);
            if (!rows?.length) throw new Error('No workers to export.');
            const stamp = new Date().toISOString().slice(0, 10);
            const typeTag = target.workerType ? `-${target.workerType}` : '';
            const base = ids?.length === 1
                ? `AKK-Employee-${ids[0]}-${stamp}`
                : `AKK-Employees-${target.pick ? 'selected' : target.scope || 'selected'}${typeTag}-${stamp}`;
            if (format === 'xlsx') {
                setProgress('Building the spreadsheet…');
                await downloadWorkerInfoExcel(rows, selected, `${base}.xlsx`, allFields);
            } else {
                await downloadWorkerInfoPdf(rows, selected, `${base}.pdf`, (d, t) => setProgress(`Building page ${d} of ${t}…`), allFields);
            }
            toast.success(`Exported ${rows.length} worker${rows.length === 1 ? '' : 's'}`);
            onClose();
        } catch (e) {
            setError(e.message || 'Export failed.');
        } finally {
            setBusy(false);
            setProgress('');
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Export {target?.title}</DialogTitle>
                    <DialogDescription>
                        Choose any details to include — everything on file is available.{' '}
                        {format === 'xlsx' ? 'Excel: one row per worker, details only (no ID card).' : 'PDF: one page per worker with their ID card, then these details.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="File format">
                    {[['pdf', 'PDF · ID cards', FileText], ['xlsx', 'Excel · details only', FileSpreadsheet]].map(([k, l, Icon]) => (
                        <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={format === k}
                            onClick={() => setFormat(k)}
                            className={cn('flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold', format === k ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600')}
                        >
                            <Icon className="h-4 w-4" /> {l}
                        </button>
                    ))}
                </div>
                <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                    {target?.pick ? (
                        <section>
                            <p className="mb-1.5 text-sm font-semibold">Workers ({picked.length})</p>
                            <WorkerChecklist workers={workers} picked={picked} setPicked={setPicked} />
                        </section>
                    ) : null}
                    <FieldPicker fields={allFields} selected={selected} setSelected={setSelected} />
                </div>
                {error ? <Banner tone="danger">{error}</Banner> : null}
                {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={run} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Export {format === 'xlsx' ? 'Excel' : 'PDF'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function WorkerChecklist({ workers, picked, setPicked }) {
    const [q, setQ] = useState('');
    const list = useMemo(() => {
        const s = q.trim().toLowerCase();
        return (workers || []).filter((w) => !s || `${w.employee_id} ${w.name}`.toLowerCase().includes(s));
    }, [workers, q]);
    const allShown = list.length && list.every((w) => picked.includes(w.employee_id));
    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID" className="h-10 w-full rounded-xl border border-[var(--g-hairline)] pl-9 pr-3 text-base sm:text-sm" />
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                        setPicked((p) => (allShown ? p.filter((id) => !list.some((w) => w.employee_id === id)) : [...new Set([...p, ...list.map((w) => w.employee_id)])]))
                    }
                >
                    {allShown ? 'Clear shown' : 'Select shown'}
                </Button>
            </div>
            <ul className="max-h-56 divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-xl border border-[var(--g-hairline)]">
                {list.map((w) => (
                    <li key={w.employee_id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                            <input
                                type="checkbox"
                                className="h-4 w-4 accent-[var(--g-brand)]"
                                checked={picked.includes(w.employee_id)}
                                onChange={() => setPicked((p) => (p.includes(w.employee_id) ? p.filter((x) => x !== w.employee_id) : [...p, w.employee_id]))}
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {w.name} <span className="text-slate-400">{w.employee_id}</span>
                            </span>
                            {!w.in_company ? <span className="text-xs text-red-700">left</span> : null}
                        </label>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Toggle chips for every askable detail, grouped. `selected` is an array of keys. */
function ChipPicker({ selected, onToggle, fields = ASKABLE_FIELDS }) {
    const groups = GROUPS.map((g) => ({ ...g, items: fields.filter((f) => f.group === g.key) })).filter((g) => g.items.length);
    return (
        <div className="space-y-2.5">
            {groups.map((g) => (
                <div key={g.key}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {g.items.map((f) => {
                            const on = selected.includes(f.key);
                            return (
                                <button
                                    key={f.key}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => onToggle(f.key)}
                                    className={cn(
                                        'min-h-8 rounded-full border px-2.5 text-xs font-semibold transition-colors',
                                        on ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                                    )}
                                >
                                    {f.label}
                                    {f.approval ? <span className="ml-1 font-normal opacity-70">· you approve</span> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function CustomAdder({ onAdd }) {
    const [text, setText] = useState('');
    const add = () => {
        const t = text.trim();
        if (t.length < 2) return;
        onAdd(t.slice(0, 60));
        setText('');
    };
    return (
        <div className="flex gap-2">
            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        add();
                    }
                }}
                maxLength={60}
                placeholder="Ask for something else, e.g. Next of kin name"
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--g-hairline)] px-2.5 text-sm"
            />
            <Button type="button" size="sm" variant="outline" onClick={add} disabled={text.trim().length < 2}>
                <Plus className="h-3.5 w-3.5" /> Add
            </Button>
        </div>
    );
}

const uniq = (a) => [...new Set(a)];

/**
 * Ask workers for details. Pick workers, then give EACH worker their own list (any catalogue detail,
 * plus anything you type). "Quick fill" applies one list to many workers at once.
 * `workers` = directory rows (with `missing`). `initialIds` / `initialFields` preselect.
 */
export function RequestInfoDialog({ open, onClose, workers, initialIds = [], initialFields = [], onDone }) {
    const [picked, setPicked] = useState(initialIds);
    const [plan, setPlan] = useState({}); // id -> { fields: [], custom: [] }
    const [editing, setEditing] = useState(null);
    const [bulk, setBulk] = useState([]);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const byId = useMemo(() => Object.fromEntries((workers || []).map((w) => [w.employee_id, w])), [workers]);

    const seed = (id) => ({ fields: initialIds.includes(id) && initialFields.length ? [...initialFields] : [...(byId[id]?.missing || [])], custom: [] });
    useEffect(() => {
        if (open) {
            setPicked(initialIds);
            setPlan({});
            setEditing(null);
            setBulk([]);
            setMessage('');
            setError('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const planOf = (id) => plan[id] || seed(id);
    const setFor = (id, patch) => setPlan((p) => ({ ...p, [id]: { ...(p[id] || seed(id)), ...patch } }));
    const toggleField = (id, key) => {
        const cur = planOf(id).fields;
        setFor(id, { fields: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
    };
    const applyBulk = (mode) =>
        setPlan((p) => {
            const next = { ...p };
            for (const id of picked) {
                const cur = next[id] || seed(id);
                next[id] = { ...cur, fields: mode === 'replace' ? [...bulk] : uniq([...cur.fields, ...bulk]) };
            }
            return next;
        });
    const fillMissing = () =>
        setPlan((p) => {
            const next = { ...p };
            for (const id of picked) next[id] = { ...(next[id] || seed(id)), fields: [...(byId[id]?.missing || [])] };
            return next;
        });

    const ready = picked.filter((id) => planOf(id).fields.length + planOf(id).custom.length > 0);
    const empty = picked.length - ready.length;

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            const items = ready.map((id) => ({ employee_id: id, fields: planOf(id).fields, custom: planOf(id).custom }));
            const r = await workerInfoAdmin.requestItems(items, message);
            toast.success(`Request sent to ${r.created} worker${r.created === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already asked` : ''}`);
            onDone?.();
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Request information</DialogTitle>
                    <DialogDescription>
                        Pick the workers, then choose what to ask each one. Workers get a notification and see only the details you ask for. Details already
                        asked and still pending are skipped.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
                    <section>
                        <p className="mb-1.5 text-sm font-semibold">1 · Workers ({picked.length})</p>
                        <WorkerChecklist workers={workers} picked={picked} setPicked={setPicked} />
                    </section>

                    {picked.length ? (
                        <section className="space-y-3">
                            <p className="text-sm font-semibold">2 · What to ask each worker</p>
                            {picked.length > 1 ? (
                                <details className="rounded-xl border border-dashed border-[var(--g-hairline)] bg-slate-50/60 p-3">
                                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Quick fill — same details for several workers</summary>
                                    <div className="mt-3 space-y-3">
                                        <ChipPicker selected={bulk} onToggle={(k) => setBulk((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]))} />
                                        <div className="flex flex-wrap gap-2">
                                            <Button type="button" size="sm" disabled={!bulk.length} onClick={() => applyBulk('add')}>
                                                Add to all {picked.length}
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" disabled={!bulk.length} onClick={() => applyBulk('replace')}>
                                                Replace for all {picked.length}
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" onClick={fillMissing}>
                                                Each worker&apos;s missing details
                                            </Button>
                                        </div>
                                    </div>
                                </details>
                            ) : null}
                            <ul className="space-y-2">
                                {picked.map((id) => {
                                    const w = byId[id];
                                    const pl = planOf(id);
                                    const open2 = editing === id;
                                    const count = pl.fields.length + pl.custom.length;
                                    return (
                                        <li key={id} className="rounded-xl border border-[var(--g-hairline)] bg-white">
                                            <div className="flex items-start gap-2 p-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-slate-900">
                                                        {w?.name || id} <span className="font-normal text-slate-400">{id}</span>
                                                    </p>
                                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                                        {pl.fields.map((k) => (
                                                            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[var(--g-brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--g-brand-text)]">
                                                                {LABEL[k] || k}
                                                                <button type="button" aria-label={`Remove ${LABEL[k] || k}`} onClick={() => toggleField(id, k)}>
                                                                    <X className="h-3 w-3" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                        {pl.custom.map((c) => (
                                                            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                                                {c}
                                                                <button type="button" aria-label={`Remove ${c}`} onClick={() => setFor(id, { custom: pl.custom.filter((x) => x !== c) })}>
                                                                    <X className="h-3 w-3" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                        {!count ? <span className="text-xs italic text-slate-400">Nothing chosen yet — this worker will be skipped</span> : null}
                                                    </div>
                                                </div>
                                                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(open2 ? null : id)}>
                                                    {open2 ? 'Done' : 'Choose details'}
                                                </Button>
                                            </div>
                                            {open2 ? (
                                                <div className="space-y-3 border-t border-[var(--g-hairline)] bg-slate-50/50 p-3">
                                                    <ChipPicker selected={pl.fields} onToggle={(k) => toggleField(id, k)} />
                                                    <CustomAdder onAdd={(c) => setFor(id, { custom: uniq([...pl.custom, c]) })} />
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ) : null}

                    <section>
                        <label className="mb-1.5 block text-sm font-semibold" htmlFor="wi-msg">
                            3 · Message (optional)
                        </label>
                        <textarea id="wi-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded-xl border border-[var(--g-hairline)] p-2.5 text-sm" placeholder="e.g. Needed for MOM records" />
                    </section>
                </div>
                {error ? <Banner tone="danger">{error}</Banner> : null}
                <DialogFooter className="gap-2">
                    {empty > 0 && ready.length > 0 ? <p className="mr-auto self-center text-xs text-amber-700">{empty} worker{empty === 1 ? ' has' : 's have'} nothing chosen and will be skipped</p> : null}
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={send} disabled={busy || !ready.length}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to {ready.length} worker{ready.length === 1 ? '' : 's'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function SendCheckDialog({ open, onClose, workers, initialIds = [], onDone }) {
    const [picked, setPicked] = useState(initialIds);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (open) {
            setPicked(initialIds);
            setError('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await workerInfoAdmin.sendChecks(picked);
            toast.success(`Information check sent to ${r.sent} worker${r.sent === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already have one open` : ''}`);
            onDone?.();
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Send Worker Information Check</DialogTitle>
                    <DialogDescription>
                        Each worker sees all their current details (read-only) and approves them, or declines with a reason so you can correct them.
                    </DialogDescription>
                </DialogHeader>
                <WorkerChecklist workers={workers} picked={picked} setPicked={setPicked} />
                {error ? <Banner tone="danger">{error}</Banner> : null}
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={send} disabled={busy || !picked.length}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to {picked.length}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
