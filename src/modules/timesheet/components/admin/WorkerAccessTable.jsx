/**
 * Employees → who can open what. One row per employee (Attendance record is the master:
 * ID, name, type); Materials and Site photos are switches on that same row. Replaces the old
 * "Material requesters" and "App access" lists. One AKK Hub backend only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { UNIFIED, supabaseCore } from '@/core/supabase';

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'materials', label: 'Materials' },
    { id: 'progress', label: 'Site photos' },
    { id: 'none', label: 'Attendance only' },
];

function Toggle({ on, busy, onChange, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            disabled={busy}
            onClick={() => onChange(!on)}
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-[var(--g-brand,#a50f2d)]' : 'bg-slate-300'}`}
        >
            <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    on ? 'translate-x-5' : 'translate-x-0'
                }`}
            />
        </button>
    );
}

export default function WorkerAccessTable() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [busy, setBusy] = useState('');
    const [showLeft, setShowLeft] = useState(false);

    const load = useCallback(async () => {
        const { data, error: e } = await supabaseCore.rpc('admin_list_workers');
        if (e) setError(e.message || 'Could not load employees.');
        else {
            setError('');
            setRows(data || []);
        }
    }, []);
    useEffect(() => {
        if (UNIFIED) load();
    }, [load]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (rows || []).filter((r) => {
            if (!showLeft && r.in_company === false) return false;
            if (filter === 'materials' && !r.materials) return false;
            if (filter === 'progress' && !r.progress) return false;
            if (filter === 'none' && (r.materials || r.progress)) return false;
            return !q || `${r.employee_id} ${r.employee_name}`.toLowerCase().includes(q);
        });
    }, [rows, query, filter, showLeft]);

    if (!UNIFIED) return null;

    const set = async (row, patch) => {
        const next = { materials: row.materials, progress: row.progress, ...patch };
        setBusy(row.employee_id);
        setError('');
        const { error: e } = await supabaseCore.rpc('admin_set_worker_access', {
            p_employee_id: row.employee_id,
            p_materials: next.materials,
            p_progress: next.progress,
        });
        setBusy('');
        if (e) setError(e.message || 'Could not save.');
        else setRows((rs) => rs.map((r) => (r.employee_id === row.employee_id ? { ...r, ...next } : r)));
    };

    return (
        <section className="rounded-2xl border border-[var(--g-hairline)] bg-white p-4 sm:p-5" aria-label="Employee access">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Who can open what</h2>
                    <p className="text-sm text-slate-500">
                        One login per employee. Attendance is always on; switch Materials and Site photos here. The same ID, name and details are used everywhere.
                    </p>
                </div>
                {rows ? <p className="text-sm text-slate-500">{shown.length} of {rows.length}</p> : null}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by ID or name"
                        aria-label="Search employees"
                        className="h-11 w-full rounded-xl border border-input bg-white pl-9 pr-3 text-base sm:text-sm"
                    />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
                    {FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            aria-pressed={filter === f.id}
                            onClick={() => setFilter(f.id)}
                            className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                                filter === f.id ? 'border-[var(--g-brand,#a50f2d)] bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]' : 'border-slate-200 bg-white text-slate-600'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show employees no longer in the company
            </label>

            {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
            {!rows && !error ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading employees…
                </div>
            ) : null}

            {rows ? (
                <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-[var(--g-hairline)]">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-[#f7f8fa] text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-3 py-2">ID</th>
                                <th className="px-3 py-2">Name</th>
                                <th className="hidden px-3 py-2 md:table-cell">Role</th>
                                <th className="px-3 py-2 text-center">Materials</th>
                                <th className="px-3 py-2 text-center">Site photos</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((r) => (
                                <tr key={r.employee_id} className={`border-t border-[var(--g-hairline)] ${r.in_company === false ? 'bg-red-50/40 text-slate-500' : ''}`}>
                                    <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">{r.employee_id}</td>
                                    <td className="px-3 py-2">
                                        <span className="block max-w-[14rem] truncate sm:max-w-none">{r.employee_name}</span>
                                        <span className="text-xs text-slate-400 md:hidden">{r.designation || (r.worker_type === 'local' ? 'Local' : 'Foreign')}</span>
                                    </td>
                                    <td className="hidden px-3 py-2 text-slate-600 md:table-cell">
                                        {r.designation || '—'} · {r.worker_type === 'local' ? 'Local' : 'Foreign'}
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex justify-center">
                                            <Toggle on={Boolean(r.materials)} busy={busy === r.employee_id} label={`Materials for ${r.employee_name}`} onChange={(v) => set(r, { materials: v })} />
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex justify-center">
                                            <Toggle on={Boolean(r.progress)} busy={busy === r.employee_id} label={`Site photos for ${r.employee_name}`} onChange={(v) => set(r, { progress: v })} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!shown.length ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                                        No employees match.
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
    );
}
