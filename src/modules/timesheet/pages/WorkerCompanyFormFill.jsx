// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useEffect, useState } from 'react';
import { storageKey } from '@/core/storage';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { WorkerPageShell } from '@/ui/PortalShell';
import CompanyFormFiller from '@/modules/timesheet/components/companyForms/CompanyFormFiller';
import { verifyRoleSession } from '@/core/auth/timesheetSession';

import { isNativeApp } from '@/core/platform';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import {
    getDepartmentLabel,
    getResolvedFormDefinition,
    submitCompanyForm,
} from '@/modules/timesheet/lib/companyForms';

export default function WorkerCompanyFormFill() {
    const [searchParams] = useSearchParams();
    const formKey = searchParams.get('key');
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [workerId, setWorkerId] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerId'))) || '').trim()
    );
    const [workerType, setWorkerType] = useState(() =>
        (typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerType'))) || 'foreign'
    );
    const [workerName, setWorkerName] = useState(() =>
        ((typeof localStorage !== 'undefined' && localStorage.getItem(storageKey('timesheet', 'workerName'))) || '').trim()
    );

    useEffect(() => {
        verifyRoleSession().then((session) => {
            if (session?.role === 'worker' && session.subject_id) {
                setWorkerId(String(session.subject_id).trim());
            }
        });
        try {
            setWorkerType(localStorage.getItem(storageKey('timesheet', 'workerType')) || 'foreign');
            setWorkerName((localStorage.getItem(storageKey('timesheet', 'workerName')) || '').trim());
        } catch {
            /* ignore */
        }
    }, []);

    const defQuery = useQuery({
        queryKey: ['company-form-definition', formKey],
        enabled: !!formKey,
        queryFn: () => getResolvedFormDefinition(formKey),
    });

    const definition = defQuery.data;

    const submitMutation = useMutation({
        mutationFn: (payload) =>
            submitCompanyForm({
                formKey,
                workerId,
                workerType,
                workerName: workerName || workerId,
                payload,
            }),
        onSuccess: (row) => {
            queryClient.invalidateQueries({ queryKey: ['worker-company-forms'] });
            queryClient.invalidateQueries({ queryKey: ['company-form-review'] });
            toast.success(
                row.is_flagged
                    ? 'Submitted (flagged for manager attention)'
                    : 'Form submitted for review'
            );
            navigate("/timesheet/company-forms/history");
        },
        onError: (e) => toast.error(e.message || 'Submit failed'),
    });

    const nativeApp = isNativeApp();

    if (!formKey) {
        return (
            <WorkerPageShell title="Form not found" subtitle="This form key is invalid or removed">
                {nativeApp ? (
                    <NativeEmptyState
                        icon={ClipboardList}
                        title="Form not found"
                        message="Go back and pick a form from the catalog."
                    />
                ) : (
                    <p className="text-sm text-slate-600">Go back and pick a form from the catalog.</p>
                )}
            </WorkerPageShell>
        );
    }

    if (defQuery.isLoading) {
        return (
            <WorkerPageShell title="Loading form…" subtitle="">
                {nativeApp ? (
                    <NativeListSkeleton rows={4} label="Loading form" />
                ) : (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                )}
            </WorkerPageShell>
        );
    }

    if (defQuery.isError) {
        return (
            <WorkerPageShell title="Form unavailable" subtitle="Could not load this form">
                {nativeApp ? (
                    <NativeErrorState
                        error={defQuery.error}
                        onRetry={() => defQuery.refetch()}
                        retrying={defQuery.isRefetching}
                    />
                ) : (
                    <p className="text-sm text-slate-600">Ask your manager or admin to enable it under Form Modules.</p>
                )}
            </WorkerPageShell>
        );
    }

    if (!definition || definition.enabled === false) {
        return (
            <WorkerPageShell title="Form unavailable" subtitle="This form is off or missing">
                {nativeApp ? (
                    <NativeEmptyState
                        icon={ClipboardList}
                        title="Form unavailable"
                        message="Ask your manager or admin to enable it under Form Modules."
                    />
                ) : (
                    <p className="text-sm text-slate-600">Ask your manager or admin to enable it under Form Modules.</p>
                )}
            </WorkerPageShell>
        );
    }

    return (
        <WorkerPageShell
            title={definition.title}
            subtitle={getDepartmentLabel(definition.department)}
        >
            <CompanyFormFiller
                key={`${definition.key}-${definition.title}`}
                definition={definition}
                workerName={workerName || workerId}
                submitting={submitMutation.isPending}
                onSubmit={(payload) => submitMutation.mutateAsync(payload)}
            />
        </WorkerPageShell>
    );
}
