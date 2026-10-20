import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
    SUGGESTION_KINDS,
    deletePackageSuggestion,
    listPackageSuggestions,
    savePackageSuggestion,
} from '@/modules/progress/lib/packageSuggestions';

/**
 * Admin: the shared description / street name list employees/technicians pick from
 * while typing. Grows by itself as packages are submitted; edit or prune it here.
 */
export default function PackageSuggestionsPanel() {
    const [lists, setLists] = useState(null);

    const refresh = useCallback(() => {
        listPackageSuggestions()
            .then(setLists)
            .catch((e) => {
                toast.error(e.message || 'Could not load the list');
                setLists({ description: [], street: [] });
            });
    }, []);

    useEffect(refresh, [refresh]);

    return (
        <Card className="space-y-4 p-4 sm:p-5">
            <div>
                <h3 className="text-base font-semibold text-slate-900">Descriptions &amp; street names</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                    Employees/technicians type these when starting a package and pick from matching entries as they type.
                    New ones are added automatically when a package is submitted. Add, rename or remove entries here —
                    a removed entry will not come back on its own.
                </p>
            </div>
            {lists === null ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                    {SUGGESTION_KINDS.map((k) => (
                        <SuggestionList key={k.kind} meta={k} rows={lists[k.kind] || []} onChanged={refresh} />
                    ))}
                </div>
            )}
        </Card>
    );
}

function SuggestionList({ meta, rows, onChanged }) {
    const [draft, setDraft] = useState('');
    const [filter, setFilter] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [busyId, setBusyId] = useState(null);

    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return q ? rows.filter((r) => r.value.toLowerCase().includes(q)) : rows;
    }, [rows, filter]);

    const run = async (key, fn, ok) => {
        setBusyId(key);
        try {
            await fn();
            if (ok) toast.success(ok);
            onChanged();
            return true;
        } catch (e) {
            toast.error(e.message || 'Could not save that');
            return false;
        } finally {
            setBusyId(null);
        }
    };

    const add = async (e) => {
        e.preventDefault();
        const value = draft.trim();
        if (!value) return;
        if (await run('new', () => savePackageSuggestion({ kind: meta.kind, value }))) setDraft('');
    };

    const saveEdit = async (row) => {
        const value = editValue.trim();
        if (!value || value === row.value) {
            setEditingId(null);
            return;
        }
        if (await run(row.id, () => savePackageSuggestion({ id: row.id, value }))) setEditingId(null);
    };

    const remove = (row) => {
        if (!window.confirm(`Remove "${row.value}" from the ${meta.label.toLowerCase()} list?`)) return;
        run(row.id, () => deletePackageSuggestion(row.id));
    };

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                <span className="text-xs text-muted-foreground">{rows.length}</span>
            </div>
            <form onSubmit={add} className="flex gap-2">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 150))}
                    placeholder={meta.placeholder}
                    aria-label={`Add a ${meta.singular}`}
                />
                <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!draft.trim() || busyId === 'new'}>
                    {busyId === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span className="ml-1">Add</span>
                </Button>
            </form>
            {rows.length > 6 ? (
                <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={`Search ${meta.label.toLowerCase()}…`}
                    aria-label={`Search ${meta.label.toLowerCase()}`}
                    className="h-9"
                />
            ) : null}
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {shown.length === 0 ? (
                    <li className="px-3 py-4 text-sm text-muted-foreground">
                        {rows.length ? 'Nothing matches.' : `No ${meta.label.toLowerCase()} yet.`}
                    </li>
                ) : shown.map((row) => (
                    <li key={row.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                        {editingId === row.id ? (
                            <>
                                <Input
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value.slice(0, 150))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(row); }
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    className="h-9"
                                    autoFocus
                                    aria-label={`Rename ${row.value}`}
                                />
                                <Button type="button" size="sm" variant="outline" className="h-9 w-9 shrink-0 p-0" aria-label="Save" disabled={busyId === row.id} onClick={() => saveEdit(row)}>
                                    {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label="Cancel" onClick={() => setEditingId(null)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </>
                        ) : (
                            <>
                                <span className="min-w-0 flex-1 break-words text-sm text-slate-800">{row.value}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {row.use_count ? `used ${row.use_count}×` : 'added by staff'}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 p-0 text-slate-500"
                                    aria-label={`Rename ${row.value}`}
                                    onClick={() => { setEditingId(row.id); setEditValue(row.value); }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                                    aria-label={`Remove ${row.value}`}
                                    disabled={busyId === row.id}
                                    onClick={() => remove(row)}
                                >
                                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
