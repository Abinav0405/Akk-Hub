// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React from 'react';
import { storageKey } from '@/core/storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, Settings2, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { Button } from '@/ui/button';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeListSkeleton } from '@/ui/native/NativeStates';
import CompanyFormReviewPanel from '@/modules/timesheet/components/companyForms/CompanyFormReviewPanel';
import CompanyFormQuestionsEditor from '@/modules/timesheet/components/companyForms/CompanyFormQuestionsEditor';
import RecommendedResultsEditor from '@/modules/timesheet/components/companyForms/RecommendedResultsEditor';
import { cn } from '@/modules/timesheet/lib/utils';
import {
    DEPARTMENTS,
    getDepartmentLabel,
    listFormModules,
    setFormModuleEnabled,
} from '@/modules/timesheet/lib/companyForms';

function FormModulesSettings() {
    const queryClient = useQueryClient();
    const { data: modules = [], isLoading } = useQuery({
        queryKey: ['company-form-modules'],
        queryFn: listFormModules,
    });

    const toggleMut = useMutation({
        mutationFn: ({ formKey, enabled }) => setFormModuleEnabled(formKey, enabled),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company-form-modules'] });
            toast.success('Form module updated');
        },
        onError: (e) => toast.error(e.message || 'Could not update module'),
    });

    if (isLoading) {
        if (isNativeApp()) {
            return <NativeListSkeleton rows={4} label="Loading form modules" />;
        }
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600">
                Turn forms on or off for workers. Disabled forms stay hidden in the worker catalog;
                existing submissions remain in the review queue.
            </p>
            {DEPARTMENTS.map((dept) => {
                const rows = modules.filter((m) => m.definition?.department === dept.key);
                if (!rows.length) return null;
                return (
                    <section key={dept.key} className={cn(glassPanel, 'p-4 sm:p-5')}>
                        <h3 className="mb-3 text-base font-semibold text-slate-900">
                            {getDepartmentLabel(dept.key)}
                        </h3>
                        <ul className="divide-y divide-slate-100">
                            {rows.map((m) => (
                                <li
                                    key={m.form_key}
                                    className="flex items-center justify-between gap-3 py-3"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-900">
                                            {m.definition?.title || m.form_key}
                                        </p>
                                        <p className="truncate font-mono text-xs text-slate-400">
                                            {m.form_key}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={m.enabled ? 'default' : 'outline'}
                                        className={cn(
                                            'h-9 min-w-[4.5rem] rounded-xl',
                                            m.enabled && 'bg-emerald-600 hover:bg-emerald-700'
                                        )}
                                        disabled={toggleMut.isPending}
                                        onClick={() =>
                                            toggleMut.mutate({
                                                formKey: m.form_key,
                                                enabled: !m.enabled,
                                            })
                                        }
                                    >
                                        {m.enabled ? 'On' : 'Off'}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

export default function AdminCompanyForms() {
    let adminName = 'Admin';
    try {
        adminName = localStorage.getItem(storageKey('timesheet', 'adminName')) || sessionStorage.getItem(storageKey('timesheet', 'adminName')) || 'Admin';
    } catch {
        /* ignore */
    }

    return (
        <AdminPageShell
            title="Company forms"
            subtitle="Review submissions, edit questions, and enable form modules"
            icon={ClipboardList}
            tone="teal"
            eyebrow="Settings"
        >
            <Tabs defaultValue="review" className="space-y-4">
                <TabsList className="grid h-auto w-full max-w-xl grid-cols-3 gap-0.5 rounded-xl bg-slate-100/80 p-1">
                    <TabsTrigger value="review" className="rounded-lg px-1 text-xs sm:px-3 sm:text-sm">
                        Review
                    </TabsTrigger>
                    <TabsTrigger value="questions" className="rounded-lg px-1 text-xs sm:px-3 sm:text-sm">
                        <PencilLine className="mr-0 h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Questions</span>
                        <span className="sm:hidden">Qs</span>
                    </TabsTrigger>
                    <TabsTrigger value="modules" className="rounded-lg px-1 text-xs sm:px-3 sm:text-sm">
                        <Settings2 className="mr-0 h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Modules</span>
                        <span className="sm:hidden">Mods</span>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="review">
                    <CompanyFormReviewPanel reviewerName={adminName} reviewerRole="admin" />
                </TabsContent>
                <TabsContent value="questions">
                    <CompanyFormQuestionsEditor />
                </TabsContent>
                <TabsContent value="modules" className="space-y-4">
                    <RecommendedResultsEditor />
                    <FormModulesSettings />
                </TabsContent>
            </Tabs>
        </AdminPageShell>
    );
}
