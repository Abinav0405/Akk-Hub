// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/ui/badge';
import { PlusCircle, ChevronRight, ClipboardList, Trash2 } from 'lucide-react';
import { createPageUrl, cn } from '@/modules/timesheet/lib/utils';
import { toast } from 'sonner';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassInput, glassPanel } from '@/ui/glass';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

export default function AdminForms() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');

    const formsQuery = useQuery({
        queryKey: ['admin-feedback-forms'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('feedback_forms')
                .select('*')
                .order('updated_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
    });

    const createForm = useMutation({
        mutationFn: async () => {
            const t = title.trim();
            if (!t) throw new Error('Form title is required.');
            const { data, error } = await supabase
                .from('feedback_forms')
                .insert([
                    {
                        title: t,
                        description: description.trim() || null,
                        is_published: false,
                        publish_revision: 0,
                    },
                ])
                .select('id')
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: async (data) => {
            setTitle('');
            setDescription('');
            toast.success('Form created — add questions and publish when ready.');
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-forms'] });
            if (data?.id) {
                navigate(createPageUrl(`AdminFormDetail?id=${data.id}`));
            }
        },
        onError: (e) => toast.error(e.message || 'Failed to create form'),
    });

    const deleteForm = useMutation({
        mutationFn: async (id) => {
            const { error } = await supabase.from('feedback_forms').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: async () => {
            toast.success('Form deleted');
            await queryClient.invalidateQueries({ queryKey: ['admin-feedback-forms'] });
            await queryClient.invalidateQueries({ queryKey: ['worker-feedback-forms'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to delete form'),
    });

    const handleDeleteForm = async (e, form) => {
        e.preventDefault();
        e.stopPropagation();
        if (
            !(await confirmAction({
                title: 'Delete form?',
                message: `Delete "${form.title}"? All questions and worker responses will be permanently removed.`,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        ) {
            return;
        }
        deleteForm.mutate(form.id);
    };

    const list = formsQuery.data || [];

    return (
        <AdminPageShell
            title="Forms"
            subtitle="Meal & feedback surveys for workers"
            icon={ClipboardList}
            tone="indigo"
            maxWidth="max-w-5xl"
        >
                <div className={cn(glassPanel, 'space-y-3 p-5')}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Create a new form</h2>
                            <Button
                                onClick={() => createForm.mutate()}
                                disabled={createForm.isPending}
                                className="h-10 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)]"
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Create
                            </Button>
                        </div>
                        <Input className={glassInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Form title (e.g. Friday lunch feedback)" />
                        <Textarea
                            className="rounded-xl border-slate-200"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional description for workers"
                            rows={2}
                        />
                        <p className="text-xs text-slate-500">
                            After creating, add questions and publish. Republishing after edits asks workers to submit again.
                        </p>
                </div>

                <div className={cn(glassPanel, 'p-5')}>
                        <h2 className="text-lg font-semibold tracking-tight text-slate-900">All forms</h2>
                        <div className="mt-4 space-y-3">
                            {NATIVE_APP && formsQuery.isLoading ? (
                                <NativeListSkeleton rows={2} label="Loading forms" />
                            ) : NATIVE_APP && formsQuery.isError && !list.length ? (
                                <NativeErrorState
                                    className="shadow-none"
                                    error={formsQuery.error}
                                    onRetry={() => formsQuery.refetch()}
                                    retrying={formsQuery.isFetching}
                                />
                            ) : formsQuery.isLoading ? (
                                <p className="text-sm text-slate-600">Loading…</p>
                            ) : list.length === 0 ? (
                                <p className="text-sm text-slate-600">No forms yet.</p>
                            ) : (
                                list.map((form) => (
                                    <Link
                                        key={form.id}
                                        to={createPageUrl(`AdminFormDetail?id=${form.id}`)}
                                        className="flex items-center justify-between gap-3 rounded-2xl border border-teal-100 bg-white/80 p-4 transition-shadow hover:shadow-md"
                                    >
                                        <div className="flex min-w-0 items-start gap-3">
                                            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" />
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-slate-900">{form.title}</p>
                                                {form.description ? (
                                                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{form.description}</p>
                                                ) : null}
                                                <p className="mt-1 text-xs text-slate-500">
                                                    Revision {form.publish_revision || 0}
                                                    {form.published_at
                                                        ? ` · Published ${new Date(form.published_at).toLocaleDateString()}`
                                                        : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <Badge
                                                className={
                                                    form.is_published
                                                        ? 'bg-teal-100 text-teal-800 hover:bg-teal-100'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-100'
                                                }
                                            >
                                                {form.is_published ? 'Published' : 'Draft'}
                                            </Badge>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-11 w-11 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                aria-label={`Delete ${form.title}`}
                                                disabled={deleteForm.isPending}
                                                onClick={(e) => handleDeleteForm(e, form)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                            <ChevronRight className="h-5 w-5 text-slate-400" />
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                </div>
        </AdminPageShell>
    );
}
