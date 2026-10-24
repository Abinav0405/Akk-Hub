/**
 * Admin → Managers: the ONE place to manage manager accounts. Each manager is shown once (by email) with the
 * areas they can sign in to — Hub login, Materials, Site work. Add / edit / reset password / remove act on all
 * three at once with one email + one password; setting a password also sets up any area that is missing.
 * Site work JSR permissions stay on "Manager JSR access" (linked from here).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabaseMaterials } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Activity, AlertTriangle, Check, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, UserCog, X } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { formatDisplayDateTime } from '@/modules/materials/lib/dates';
import { paths } from '@/app/paths';
import { sectionHref } from '@/app/useHubSection';
import { AREAS, MIN_PASSWORD, areaLabel, grantArea, invokeStaff, loadManagers, removeManager, revokeArea, saveManager, summarize } from '@/features/managers/managerAccounts';

const EMPTY_FORM = { name: '', email: '', password: '', confirm: '' };
const JSR_ACCESS = sectionHref(paths.progress.admin, 'managers');

function activityDetails(item) {
    const before = item.before_data || {};
    const after = item.after_data || {};
    if (item.action === 'transaction_approved' || item.action === 'transaction_declined') {
        return `${after.worker_name || before.worker_name || 'Worker'} · ${after.transaction_type || before.transaction_type || 'transaction'}`;
    }
    if (item.entity_type === 'material') {
        const name = after.name || before.name || 'Material';
        if (before.quantity !== after.quantity && after.quantity != null) return `${name}: ${before.quantity ?? '—'} → ${after.quantity}`;
        return name;
    }
    return '';
}

function AreaChips({ row, busy, onGrant, onRevoke }) {
    return (
        <div className="flex flex-wrap gap-1">
            {AREAS.map((a) => {
                const working = busy === `${row.email}:${a.key}`;
                if (row[a.key]) {
                    return (
                        <button
                            key={a.key}
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => onRevoke(row, a.key)}
                            className="group inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)] disabled:opacity-60"
                            title={`Can sign in to ${a.label} — click to take this access away`}
                            aria-label={`Take ${a.label} access away from ${row.name}`}
                        >
                            {working ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <>
                                    <Check className="h-3 w-3 group-hover:hidden" />
                                    <X className="hidden h-3 w-3 group-hover:block" />
                                </>
                            )}{' '}
                            {a.label}
                        </button>
                    );
                }
                return (
                    <button
                        key={a.key}
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => onGrant(row, a.key)}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)] disabled:opacity-60"
                        title={`Give ${a.label} access — they keep their current password`}
                        aria-label={`Give ${row.name} access to ${a.label}`}
                    >
                        {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {a.label}
                    </button>
                );
            })}
        </div>
    );
}

function PasswordFields({ form, setForm, required, label = 'Password' }) {
    const [show, setShow] = useState(false);
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
                <span className="mb-1 block text-sm font-medium">{label}</span>
                <div className="relative">
                    <Input
                        type={show ? 'text' : 'password'}
                        name="manager-new-password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                        placeholder={required ? `At least ${MIN_PASSWORD} characters` : 'Leave blank to keep'}
                        className="pr-10"
                    />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </label>
            <label className="block">
                <span className="mb-1 block text-sm font-medium">Type it again</span>
                <Input
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                    placeholder={required ? 'Same password' : ''}
                />
            </label>
        </div>
    );
}

export default function ManagersManager() {
    const [data, setData] = useState({ list: [], errors: {}, removed: new Map() });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [mode, setMode] = useState(null); // 'add' | 'edit' | 'password' | 'activity'
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState('');
    const [granting, setGranting] = useState('');
    const [activities, setActivities] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityFilter, setActivityFilter] = useState('all');
    const [activityDate, setActivityDate] = useState('all');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setData(await loadManagers());
        } catch (error) {
            toast.error(error.message || 'Failed to load managers');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        reload();
    }, [reload]);

    const { list, errors } = data;
    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return term ? list.filter((m) => m.name.toLowerCase().includes(term) || m.email.includes(term)) : list;
    }, [list, search]);
    const incomplete = list.filter((m) => m.missing.length).length;

    const close = () => {
        setMode(null);
        setSelected(null);
        setForm(EMPTY_FORM);
        setProblem('');
    };
    const open = (m, row = null) => {
        setSelected(row);
        setForm(row ? { ...EMPTY_FORM, name: row.name, email: row.email } : EMPTY_FORM);
        setProblem('');
        setMode(m);
    };

    const submit = async (event) => {
        event.preventDefault();
        if (form.password !== form.confirm) {
            setProblem('The two passwords do not match.');
            return;
        }
        if (mode === 'password' && !form.password) {
            setProblem('Enter the new password.');
            return;
        }
        setSaving(true);
        setProblem('');
        try {
            const out = await saveManager(selected, form, data);
            if (out.failed.length) {
                setProblem(summarize(out));
                await reload();
                return; // keep the dialog open so it can be retried
            }
            toast.success(
                mode === 'add'
                    ? `${form.name.trim()} can now sign in to ${out.done.map(areaLabel).join(', ')}`
                    : mode === 'password'
                      ? `Password reset for ${selected.name} in ${out.done.map(areaLabel).join(', ')}`
                      : summarize(out),
            );
            close();
            await reload();
        } catch (error) {
            setProblem(error.message || 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    const grant = async (row, area) => {
        const label = areaLabel(area);
        if (
            !(await confirmAction({
                title: `Give ${label} access?`,
                message: `${row.name} will be able to sign in to ${label} as a manager with the password they already use.${area === 'progress' ? ' They start view-only in JSR & billing.' : ''}`,
                confirmLabel: `Give ${label} access`,
            }))
        )
            return;
        setGranting(`${row.email}:${area}`);
        try {
            const r = await grantArea(row, area);
            toast.success(
                r === 'already'
                    ? `${row.name} already has ${label}`
                    : r === 'added-own-password'
                      ? `${row.name} can now use ${label} — with their existing sign-in password (the same as their admin login)`
                      : `${row.name} can now sign in to ${label} with their current password`,
            );
        } catch (error) {
            toast.error(`${label}: ${error.message || 'could not give access'} — you can also use Reset password.`);
        } finally {
            setGranting('');
            await reload();
        }
    };

    const revoke = async (row, area) => {
        const label = areaLabel(area);
        const last = AREAS.filter((a) => row[a.key]).length === 1;
        const consequence =
            area === 'hub'
                ? `${row.name} will no longer be able to sign in to the AKK Hub app as a manager.`
                : `${row.name} will no longer be able to use ${label} as a manager.`;
        if (
            !(await confirmAction({
                title: `Take away ${label} access?`,
                message: `${consequence}${last ? ' This is their last area, so they will be removed from Managers.' : ' Their other areas stay.'}${area === 'materials' && row.alsoAdmin ? ' Their Admin access stays.' : ''} You can give it back later.`,
                confirmLabel: `Take away ${label}`,
                destructive: true,
            }))
        )
            return;
        setGranting(`${row.email}:${area}`);
        try {
            await revokeArea(row, area);
            toast.success(`${row.name} no longer has ${label} access`);
        } catch (error) {
            toast.error(`${label}: ${error.message || 'could not take access away'}`);
        } finally {
            setGranting('');
            await reload();
        }
    };

    const remove = async (row) => {
        if (
            !(await confirmAction({
                title: 'Remove manager?',
                message: `${row.name} will no longer be able to sign in as a manager to the hub, Materials or Site work.${row.alsoAdmin ? ' Their Admin access stays.' : ''}`,
                confirmLabel: 'Remove manager',
                destructive: true,
            }))
        )
            return;
        const out = await removeManager(row);
        if (out.failed.length) toast.error(summarize(out, 'Removed from'));
        else toast.success(`${row.name} removed`);
        await reload();
    };

    const setAdmin = async (grant) => {
        const m = selected?.materials;
        if (!m) return;
        if (
            !(await confirmAction({
                title: grant ? 'Grant admin access?' : 'Remove admin access?',
                message: grant
                    ? `Give ${selected.name} full administrative permissions?`
                    : `Remove Admin access from ${selected.name}? Manager access stays.`,
                confirmLabel: grant ? 'Grant admin access' : 'Remove admin access',
                ...(grant ? { tone: 'admin' } : { destructive: true }),
            }))
        )
            return;
        setSaving(true);
        try {
            await invokeStaff({ action: grant ? 'grant_admin' : 'remove_admin', user_id: m.user_id });
            toast.success(grant ? 'Admin access granted' : 'Admin access removed');
            close();
            await reload();
        } catch (error) {
            toast.error(error.message || 'Failed');
        } finally {
            setSaving(false);
        }
    };

    const openActivities = async (row) => {
        setSelected(row);
        setMode('activity');
        setActivityLoading(true);
        try {
            const { data: rows, error } = await supabaseMaterials
                .from('staff_activity')
                .select('*')
                .eq('actor_id', row.materials.user_id)
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) throw error;
            setActivities(rows || []);
        } catch (error) {
            toast.error(error.message || 'Failed to load manager activity');
            setActivities([]);
        } finally {
            setActivityLoading(false);
        }
    };
    const visibleActivities = activities.filter((item) => {
        const matchesType =
            activityFilter === 'all' ||
            (activityFilter === 'transactions' && item.entity_type === 'transaction') ||
            (activityFilter === 'materials' && item.entity_type === 'material');
        if (!matchesType || activityDate === 'all') return matchesType;
        const days = (Date.now() - new Date(item.created_at).getTime()) / 86400000;
        return activityDate === 'week' ? days <= 7 : activityDate === 'month' ? days <= 31 : days <= 366;
    });

    const formMode = mode === 'add' || mode === 'edit' || mode === 'password';
    const missingHere = selected?.missing || [];

    return (
        <Card>
            <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2">
                            <UserCog className="h-5 w-5" /> Managers
                            <Badge variant="outline">{filtered.length} / {list.length}</Badge>
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500">One email and password for the hub, Materials and Site work.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search managers…" className="pl-9" />
                        </div>
                        <Button onClick={() => open('add')}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add manager
                        </Button>
                    </div>
                </div>
                {Object.keys(errors).length ? (
                    <p className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        Could not read {Object.keys(errors).map(areaLabel).join(', ')} — the list may be incomplete. ({Object.values(errors)[0]})
                    </p>
                ) : null}
                {incomplete ? (
                    <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {incomplete} manager{incomplete === 1 ? ' is' : 's are'} missing from an area. Click an amber area to give access — they keep their current password. Click a green one to take it away.
                    </p>
                ) : null}
            </CardHeader>
            <CardContent className="p-0">
                {loading ? (
                    <div className="py-10 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="py-10 text-center text-slate-400">No managers found.</p>
                ) : (
                    <ul className="divide-y divide-[var(--g-hairline)] border-t border-[var(--g-hairline)]">
                        {filtered.map((m) => (
                            <li key={m.email} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button type="button" className="truncate font-semibold text-slate-900 hover:underline" onClick={() => open('edit', m)}>
                                            {m.name}
                                        </button>
                                        {m.alsoAdmin ? <Badge variant="outline">Also Admin</Badge> : null}
                                        {m.siteWorkDisabled ? <Badge variant="secondary">Site work switched off</Badge> : null}
                                    </div>
                                    <p className="truncate text-sm text-slate-500">{m.email}</p>
                                </div>
                                <AreaChips row={m} busy={granting} onGrant={grant} onRevoke={revoke} />
                                <div className="flex shrink-0 gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => open('password', m)} title="Reset password (all areas)" aria-label={`Reset password for ${m.name}`}>
                                        <KeyRound className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => open('edit', m)} title="Edit name / email" aria-label={`Edit ${m.name}`}>
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    {m.materials ? (
                                        <Button variant="ghost" size="icon" onClick={() => openActivities(m)} title="Materials activity" aria-label={`Activity for ${m.name}`}>
                                            <Activity className="h-4 w-4" />
                                        </Button>
                                    ) : null}
                                    <Button variant="ghost" size="icon" onClick={() => remove(m)} title="Remove manager" aria-label={`Remove ${m.name}`}>
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="flex items-center gap-1.5 border-t border-[var(--g-hairline)] px-4 py-3 text-xs text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5" /> What each manager may do in JSR & billing is set on{' '}
                    <Link to={JSR_ACCESS} className="font-semibold text-[var(--g-brand-text)] hover:underline">
                        Manager JSR access
                    </Link>
                    .
                </p>
            </CardContent>

            <Dialog open={formMode} onOpenChange={(o) => !o && close()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{mode === 'add' ? 'Add manager' : mode === 'password' ? `Reset password — ${selected?.name}` : `Edit ${selected?.name}`}</DialogTitle>
                        <DialogDescription>
                            {mode === 'password'
                                ? 'The new password works for the hub, Materials and Site work.'
                                : 'The email is their login everywhere — hub, Materials and Site work.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form key={`${mode}-${selected?.email || 'new'}`} onSubmit={submit} className="space-y-4" autoComplete="off">
                        {mode !== 'password' ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Name</span>
                                    <Input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoComplete="off" />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Email (login)</span>
                                    <Input required type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} autoComplete="off" />
                                </label>
                            </div>
                        ) : null}
                        {selected && missingHere.length ? (
                            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                Not set up in {missingHere.map(areaLabel).join(', ')}.{' '}
                                {mode === 'password' ? 'Saving adds them there with this password.' : 'Enter a password to add them there — it becomes their password everywhere.'}
                            </p>
                        ) : null}
                        <PasswordFields form={form} setForm={setForm} required={mode !== 'edit'} label={mode === 'edit' ? 'New password (optional)' : mode === 'password' ? 'New password' : 'Password'} />
                        {problem ? <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{problem}</p> : null}
                        <DialogFooter className="gap-2 sm:justify-between">
                            <div>
                                {mode === 'edit' && selected?.materials ? (
                                    selected.alsoAdmin ? (
                                        <Button type="button" variant="destructive" disabled={saving} onClick={() => setAdmin(false)}>
                                            Remove admin access
                                        </Button>
                                    ) : (
                                        <Button type="button" variant="outline" disabled={saving} onClick={() => setAdmin(true)}>
                                            Grant admin access
                                        </Button>
                                    )
                                ) : null}
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={close}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {mode === 'add' ? 'Add manager' : mode === 'password' ? 'Reset password' : 'Save'}
                                </Button>
                            </div>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={mode === 'activity'} onOpenChange={(o) => !o && close()}>
                <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>{selected?.name} — Materials activity</DialogTitle>
                        <DialogDescription>Newest activity first.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap gap-2">
                        <Select value={activityFilter} onValueChange={setActivityFilter}>
                            <SelectTrigger className="w-52">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All activities</SelectItem>
                                <SelectItem value="transactions">Transactions</SelectItem>
                                <SelectItem value="materials">Materials</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={activityDate} onValueChange={setActivityDate}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All time</SelectItem>
                                <SelectItem value="week">Past week</SelectItem>
                                <SelectItem value="month">Past month</SelectItem>
                                <SelectItem value="year">Past year</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                        {activityLoading ? (
                            <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" />
                        ) : visibleActivities.length === 0 ? (
                            <p className="py-10 text-center text-slate-400">No activity found.</p>
                        ) : (
                            visibleActivities.map((item) => (
                                <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="font-medium">{item.summary}</p>
                                        <Badge variant="outline">{item.entity_type}</Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600">{activityDetails(item)}</p>
                                    <p className="mt-2 text-xs text-slate-400">{formatDisplayDateTime(item.created_at)}</p>
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
