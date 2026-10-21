// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useMemo, useState } from 'react';
import { storageKey } from '@/core/storage';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ChevronRight, History, Loader2 } from 'lucide-react';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { Button } from '@/ui/button';
import { cn } from '@/modules/timesheet/lib/utils';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { isNativeApp } from '@/core/platform';
import { NativeListRow } from '@/ui/native/NativeChrome';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import {
    DEPARTMENTS,
    listFormModules,
    getDepartmentLabel,
} from '@/modules/timesheet/lib/companyForms';

const NATIVE_APP = isNativeApp();

export default function WorkerCompanyForms() {
    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim()
    );
    const [department, setDepartment] = useState(null);

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
            }
        });
    }, []);

    const modulesQuery = useQuery({
        queryKey: ['company-form-modules'],
        queryFn: listFormModules,
        staleTime: 30_000,
    });

    const enabledByDept = useMemo(() => {
        const modules = (modulesQuery.data || []).filter((m) => m.enabled && m.definition);
        const map = {};
        for (const m of modules) {
            const d = m.definition.department;
            if (!map[d]) map[d] = [];
            map[d].push(m.definition);
        }
        return map;
    }, [modulesQuery.data]);

    const deptList = DEPARTMENTS.filter((d) => (enabledByDept[d.key] || []).length > 0);

    return (
        <WorkerPageShell
            title="Company forms"
            subtitle="Choose a department, fill a form, and send it for review"
        >
            <div className="mb-4 flex justify-end">
                <Link to={"/timesheet/company-forms/history"}>
                    <Button variant="outline" className="h-10 rounded-xl">
                        <History className="mr-2 h-4 w-4" />
                        My submissions
                    </Button>
                </Link>
            </div>

            {NATIVE_APP && modulesQuery.isLoading ? (
                <NativeListSkeleton rows={3} label="Loading forms" />
            ) : NATIVE_APP && modulesQuery.isError ? (
                <NativeErrorState
                    error={modulesQuery.error}
                    onRetry={() => modulesQuery.refetch()}
                    retrying={modulesQuery.isRefetching}
                />
            ) : modulesQuery.isLoading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : modulesQuery.isError ? (
                <div className={cn(glassPanel, 'p-6 text-sm text-red-700')}>
                    Could not load forms. Ask admin to run the company forms migration.
                </div>
            ) : !department ? (
                NATIVE_APP ? (
                    deptList.length === 0 ? (
                        <NativeEmptyState
                            icon={ClipboardList}
                            title="No forms yet"
                            message="Ask an admin to turn them on under Form Modules."
                        />
                    ) : (
                        <nav className="akk-group" aria-label="Departments">
                            {deptList.map((d) => (
                                <NativeListRow
                                    key={d.key}
                                    icon={ClipboardList}
                                    iconClass="akk-tone-brand"
                                    title={d.label}
                                    hint={`${(enabledByDept[d.key] || []).length} form(s)`}
                                    onClick={() => setDepartment(d.key)}
                                />
                            ))}
                        </nav>
                    )
                ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    {deptList.map((d) => (
                        <button
                            key={d.key}
                            type="button"
                            onClick={() => setDepartment(d.key)}
                            className={cn(
                                glassPanel,
                                'flex items-center gap-3 p-4 text-left transition hover:bg-white/80'
                            )}
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-[#dc6b2f]">
                                <ClipboardList className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block font-semibold text-slate-900">{d.label}</span>
                                <span className="text-xs text-slate-500">
                                    {(enabledByDept[d.key] || []).length} form(s)
                                </span>
                            </span>
                            <ChevronRight className="h-5 w-5 text-slate-400" />
                        </button>
                    ))}
                    {deptList.length === 0 && (
                        <div className={cn(glassPanel, 'col-span-full p-8 text-center text-sm text-slate-500')}>
                            No forms are enabled yet. Ask an admin to turn them on under Form Modules.
                        </div>
                    )}
                </div>
                )
            ) : (
                <div className="space-y-3">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-xl px-2"
                        onClick={() => setDepartment(null)}
                    >
                        ← All departments
                    </Button>
                    <h2 className={cn('text-base font-semibold text-slate-900', NATIVE_APP && 'akk-section-title')}>
                        {getDepartmentLabel(department)}
                    </h2>
                    {NATIVE_APP ? (
                        <nav className="akk-group" aria-label="Forms">
                            {(enabledByDept[department] || []).map((form) => (
                                <NativeListRow
                                    key={form.key}
                                    to={`${"/timesheet/company-forms/fill"}?key=${encodeURIComponent(form.key)}`}
                                    title={form.title}
                                    hint={
                                        form.layout === 'checklist_steps'
                                            ? 'Step-by-step checklist'
                                            : form.layout === 'single_with_table'
                                              ? 'Form with table'
                                              : 'Single-page form'
                                    }
                                />
                            ))}
                        </nav>
                    ) : (
                    <div className="divide-y divide-slate-200/70 overflow-hidden rounded-2xl border border-white/70 bg-white/55">
                        {(enabledByDept[department] || []).map((form) => (
                            <Link
                                key={form.key}
                                to={`${"/timesheet/company-forms/fill"}?key=${encodeURIComponent(form.key)}`}
                                className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/70"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium text-slate-900">{form.title}</span>
                                    <span className="text-xs text-slate-500">
                                        {form.layout === 'checklist_steps'
                                            ? 'Step-by-step checklist'
                                            : form.layout === 'single_with_table'
                                              ? 'Form with table'
                                              : 'Single-page form'}
                                    </span>
                                </span>
                                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                            </Link>
                        ))}
                    </div>
                    )}
                    {!workerId && (
                        <p className="text-xs text-amber-700">Session missing worker id — re-login if submit fails.</p>
                    )}
                </div>
            )}
        </WorkerPageShell>
    );
}
