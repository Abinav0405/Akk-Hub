/**
 * Worker: company forms home.
 *   - "Waiting / returned" summary from My submissions
 *   - Recently used forms (one tap for daily checklists)
 *   - Search across every form, department chips, all forms in one list
 */
import React, { useEffect, useMemo, useState } from 'react';
import { storageKey } from '@/core/storage';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardList, Clock, History, Loader2, RotateCcw, Search, XCircle } from 'lucide-react';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { Button } from '@/ui/button';
import { cn } from '@/modules/timesheet/lib/utils';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { DEPARTMENTS, getDepartmentLabel, listFormModules, listWorkerSubmissions } from '@/modules/timesheet/lib/companyForms';

const FILL = '/timesheet/company-forms/fill';
const HISTORY = '/timesheet/company-forms/history';
const layoutHint = (form) =>
    form.layout === 'checklist_steps' ? 'Step-by-step checklist' : form.layout === 'single_with_table' ? 'Form with table' : 'Single-page form';
const hasDraft = (workerId, key) => {
    try {
        return Boolean(workerId && localStorage.getItem(`akk:company-form-draft:${workerId}:${key}`));
    } catch {
        return false;
    }
};

function FormRow({ form, sub, draft }) {
    return (
        <Link to={`${FILL}?key=${encodeURIComponent(form.key)}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-white/80">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
                <ClipboardList className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{form.title}</span>
                <span className="block truncate text-xs text-slate-500">
                    {sub || layoutHint(form)}
                    {draft ? <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">Draft saved</span> : null}
                </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
        </Link>
    );
}

export default function WorkerCompanyForms() {
    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim()
    );
    const [q, setQ] = useState('');
    const [department, setDepartment] = useState('all');

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) setWorkerId(String(session.subject_id).trim());
        });
    }, []);

    const modulesQuery = useQuery({ queryKey: ['company-form-modules'], queryFn: listFormModules, staleTime: 30_000 });
    const historyQuery = useQuery({
        queryKey: ['worker-company-forms', workerId],
        enabled: Boolean(workerId),
        queryFn: () => listWorkerSubmissions(workerId, { limit: 60 }),
        staleTime: 30_000,
    });

    const forms = useMemo(() => (modulesQuery.data || []).filter((m) => m.enabled && m.definition).map((m) => m.definition), [modulesQuery.data]);
    const byKey = useMemo(() => Object.fromEntries(forms.map((f) => [f.key, f])), [forms]);
    const history = historyQuery.data || [];
    const pending = history.filter((r) => r.status === 'pending').length;
    const rejected = history.filter((r) => r.status === 'rejected' && Date.now() - new Date(r.reviewed_at || r.created_at) < 14 * 864e5).length;

    // Most recently used forms first (unique), max 4.
    const recent = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const r of history) {
            if (seen.has(r.form_key) || !byKey[r.form_key]) continue;
            seen.add(r.form_key);
            out.push({ form: byKey[r.form_key], at: r.created_at });
            if (out.length === 4) break;
        }
        return out;
    }, [history, byKey]);

    const deptList = DEPARTMENTS.filter((d) => forms.some((f) => f.department === d.key));
    const s = q.trim().toLowerCase();
    const shown = forms.filter(
        (f) => (department === 'all' || f.department === department) && (!s || `${f.title} ${getDepartmentLabel(f.department)}`.toLowerCase().includes(s)),
    );
    const groups = deptList.map((d) => ({ ...d, items: shown.filter((f) => f.department === d.key) })).filter((g) => g.items.length);

    return (
        <WorkerPageShell title="Company forms" subtitle="Fill a form and send it for review">
            <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    <Link to={HISTORY} className="flex-1 sm:flex-none">
                        <Button variant="outline" className="h-11 w-full rounded-xl">
                            <History className="mr-2 h-4 w-4" />
                            My submissions
                        </Button>
                    </Link>
                    {pending ? (
                        <Link to={HISTORY} className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-sm font-semibold text-amber-800">
                            <Clock className="h-4 w-4" /> {pending} waiting for review
                        </Link>
                    ) : null}
                    {rejected ? (
                        <Link to={HISTORY} className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 text-sm font-semibold text-red-700">
                            <XCircle className="h-4 w-4" /> {rejected} rejected — check why
                        </Link>
                    ) : null}
                </div>

                {modulesQuery.isLoading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                ) : modulesQuery.isError ? (
                    <div className={cn(glassPanel, 'p-6 text-sm text-red-700')}>
                        Could not load forms.{' '}
                        <button type="button" className="font-semibold underline" onClick={() => modulesQuery.refetch()}>
                            Try again
                        </button>
                    </div>
                ) : !forms.length ? (
                    <div className={cn(glassPanel, 'p-8 text-center text-sm text-slate-500')}>No forms are turned on yet. Ask an admin.</div>
                ) : (
                    <>
                        {recent.length && !s && department === 'all' ? (
                            <section>
                                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                                    <RotateCcw className="h-4 w-4" /> Fill again
                                </h2>
                                <div className="divide-y divide-slate-200/70 overflow-hidden rounded-2xl border border-white/70 bg-white/60">
                                    {recent.map(({ form, at }) => (
                                        <FormRow
                                            key={form.key}
                                            form={form}
                                            draft={hasDraft(workerId, form.key)}
                                            sub={`Last sent ${new Date(at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short' })}`}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder={`Search ${forms.length} forms`}
                                className="h-12 w-full rounded-2xl border border-[var(--g-hairline)] bg-white pl-11 pr-3 text-base"
                                aria-label="Search forms"
                            />
                        </div>
                        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Departments">
                            {[{ key: 'all', label: 'All' }, ...deptList].map((d) => (
                                <button
                                    key={d.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={department === d.key}
                                    onClick={() => setDepartment(d.key)}
                                    className={cn(
                                        'min-h-9 shrink-0 rounded-full border px-3 text-sm font-semibold',
                                        department === d.key
                                            ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]'
                                            : 'border-slate-200 bg-white text-slate-600',
                                    )}
                                >
                                    {d.key === 'all' ? 'All' : getDepartmentLabel(d.key)}
                                </button>
                            ))}
                        </div>

                        {groups.length ? (
                            groups.map((g) => (
                                <section key={g.key}>
                                    <h2 className="mb-2 text-sm font-semibold text-slate-700">
                                        {getDepartmentLabel(g.key)} <span className="font-normal text-slate-400">· {g.items.length}</span>
                                    </h2>
                                    <div className="divide-y divide-slate-200/70 overflow-hidden rounded-2xl border border-white/70 bg-white/60">
                                        {g.items.map((form) => (
                                            <FormRow key={form.key} form={form} draft={hasDraft(workerId, form.key)} />
                                        ))}
                                    </div>
                                </section>
                            ))
                        ) : (
                            <div className={cn(glassPanel, 'p-6 text-center text-sm text-slate-500')}>No form matches “{q}”.</div>
                        )}
                        {!workerId ? <p className="text-xs text-amber-700">Session missing worker id — log in again if sending fails.</p> : null}
                    </>
                )}
            </div>
        </WorkerPageShell>
    );
}
