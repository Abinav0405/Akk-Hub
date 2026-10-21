/**
 * Worker details → roles + which areas this worker can open with their one login.
 * One AKK Hub backend only (core.admin_get_worker / core.admin_set_worker_access); renders
 * nothing on the old three-project setup.
 */
import { useEffect, useState } from 'react';
import { Boxes, Camera, Clock, Loader2 } from 'lucide-react';
import { UNIFIED, supabaseCore } from '@/core/supabase';

const AREAS = [
    { key: 'attendance', label: 'Attendance', hint: 'Clock in/out, leave, payslips', icon: Clock, fixed: true },
    { key: 'materials', label: 'Materials', hint: 'Request and return materials', icon: Boxes },
    { key: 'progress', label: 'Site photos', hint: 'Before / during / after photo packages', icon: Camera },
];
const ROLE_LABEL = { worker: 'Worker', supervisor: 'Supervisor (separate login)' };

export default function WorkerAccessPanel({ employeeId }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState('');

    useEffect(() => {
        if (!UNIFIED || !employeeId) return undefined;
        let live = true;
        setData(null);
        setError('');
        supabaseCore.rpc('admin_get_worker', { p_employee_id: employeeId }).then(({ data: d, error: e }) => {
            if (!live) return;
            if (e) setError(e.message || 'Could not load access.');
            else setData(d);
        });
        return () => {
            live = false;
        };
    }, [employeeId]);

    if (!UNIFIED) return null;

    const toggle = async (area) => {
        if (!data || saving) return;
        const next = { ...data.access, [area]: !data.access[area] };
        setSaving(area);
        setError('');
        const { error: e } = await supabaseCore.rpc('admin_set_worker_access', {
            p_employee_id: employeeId,
            p_materials: next.materials,
            p_progress: next.progress,
        });
        setSaving('');
        if (e) setError(e.message || 'Could not save.');
        else setData((d) => ({ ...d, access: { ...d.access, ...next } }));
    };

    return (
        <section className="rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] p-3.5 sm:col-span-2 lg:col-span-3" aria-label="Roles and access">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--g-muted)]">Roles &amp; access</p>
                <div className="flex flex-wrap gap-1.5">
                    {(data?.roles || []).map((r) => (
                        <span key={r} className="rounded-full bg-[var(--g-brand-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--g-brand-text)]">
                            {ROLE_LABEL[r] || r}
                        </span>
                    ))}
                </div>
            </div>
            {!data && !error ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading access…
                </div>
            ) : null}
            {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
            {data ? (
                <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                    {AREAS.map(({ key, label, hint, icon: Icon, fixed }) => {
                        const on = fixed || Boolean(data.access?.[key]);
                        return (
                            <li key={key}>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    disabled={fixed || Boolean(saving)}
                                    onClick={() => toggle(key)}
                                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                                        on ? 'border-[var(--g-brand)]/30 bg-[var(--g-brand-soft)]' : 'border-[var(--g-hairline)] bg-[var(--g-surface-2,#f6f7fa)]'
                                    } ${fixed ? 'cursor-default' : 'hover:border-[var(--g-hairline-2)]'}`}
                                >
                                    <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-[var(--g-brand)]' : 'text-[var(--g-faint)]'}`} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-[var(--g-ink)]">{label}</span>
                                        <span className="block truncate text-xs text-[var(--g-muted)]">{fixed ? 'Always on' : hint}</span>
                                    </span>
                                    {saving === key ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-[var(--g-faint)]" />
                                    ) : (
                                        <span
                                            aria-hidden
                                            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--g-brand)]' : 'bg-slate-300'}`}
                                        >
                                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
            {data?.activity ? (
                <p className="mt-2 text-xs text-slate-500">
                    {data.activity.shifts} shifts · {data.activity.leave_requests} leave requests · {data.activity.material_requests} material
                    requests · {data.activity.photo_packages} photo packages
                </p>
            ) : null}
        </section>
    );
}
