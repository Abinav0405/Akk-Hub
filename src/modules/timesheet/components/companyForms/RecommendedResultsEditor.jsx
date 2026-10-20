import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { glassPanel, glassInput } from '@/ui/glass';
import { cn } from '@/modules/timesheet/lib/utils';
import {
    DEFAULT_RECOMMENDED_RESULTS,
    getRecommendedResultOptions,
    saveRecommendedResultOptions,
} from '@/modules/timesheet/lib/companyForms';

export default function RecommendedResultsEditor({ className }) {
    const queryClient = useQueryClient();
    const [rows, setRows] = useState([]);

    const { data: options = [], isLoading } = useQuery({
        queryKey: ['company-form-recommended-results'],
        queryFn: getRecommendedResultOptions,
    });

    useEffect(() => {
        setRows(options.length ? [...options] : [...DEFAULT_RECOMMENDED_RESULTS]);
    }, [options]);

    const saveMut = useMutation({
        mutationFn: () => saveRecommendedResultOptions(rows),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company-form-recommended-results'] });
            toast.success('Recommended results updated');
        },
        onError: (e) => toast.error(e.message || 'Save failed'),
    });

    return (
        <section className={cn(glassPanel, 'p-4 sm:p-5 space-y-4', className)}>
            <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                    Recommended results
                </h2>
                <p className="text-xs text-slate-500">
                    Options managers and admins choose when approving or rejecting a submitted form.
                </p>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map((value, index) => (
                        <div key={`rr-${index}`} className="flex gap-2">
                            <Input
                                className={glassInput}
                                value={value}
                                onChange={(e) => {
                                    const next = [...rows];
                                    next[index] = e.target.value;
                                    setRows(next);
                                }}
                                placeholder="e.g. Cleared to proceed"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 text-red-600 hover:bg-red-50"
                                disabled={rows.length <= 1}
                                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-xl"
                            onClick={() => setRows([...rows, ''])}
                        >
                            <Plus className="mr-1.5 h-4 w-4" />
                            Add option
                        </Button>
                        <Button
                            type="button"
                            className="h-10 rounded-xl bg-slate-900 hover:bg-slate-800"
                            disabled={saveMut.isPending}
                            onClick={() => saveMut.mutate()}
                        >
                            {saveMut.isPending ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-1.5 h-4 w-4" />
                            )}
                            Save options
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
