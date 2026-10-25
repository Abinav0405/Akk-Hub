/**
 * Admin → Admins: every hub admin (admin in Attendance, Materials and Site work — kept in step by the database).
 * Add an admin (a new sign-in, or an existing account such as a manager), reset an admin's password (their
 * manager logins get the same password), remove admin access (never yourself, never the last admin).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabaseCore } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { MIN_PASSWORD, areaLabel, invokeStaff, validEmail } from './managerAccounts';

const EMPTY = { name: '', email: '', password: '', confirm: '' };
const rpc = async (fn, args) => {
    const { data, error } = await supabaseCore.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
};
const when = (t) => (t ? new Date(t).toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never');

export default function AdminsManager() {
    const [admins, setAdmins] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState(null); // 'add' | 'password'
    const [target, setTarget] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState('');

    const reload = useCallback(async () => {
        try {
            setAdmins(await rpc('admin_list_admins'));
            setError('');
        } catch (e) {
            setError(e.message);
            setAdmins([]);
        }
    }, []);
    useEffect(() => {
        reload();
    }, [reload]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (admins || []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.email.includes(q));
    }, [admins, search]);

    const open = (m, row = null) => {
        setMode(m);
        setTarget(row);
        setForm(EMPTY);
        setShow(false);
        setProblem('');
    };
    const close = () => {
        setMode(null);
        setTarget(null);
        setProblem('');
    };

    const submit = async (event) => {
        event.preventDefault();
        setProblem('');
        const pw = form.password;
        if (pw !== form.confirm) return setProblem('The two passwords do not match.');
        if (pw && pw.length < MIN_PASSWORD) return setProblem(`The password must be at least ${MIN_PASSWORD} characters.`);
        setSaving(true);
        try {
            if (mode === 'password') {
                if (!pw) throw new Error('Enter the new password.');
                await rpc('admin_set_admin_password', { p_user_id: target.user_id, p_password: pw });
                toast.success(target.is_self ? 'Your password was changed' : `${target.name}'s password was reset — they are signed out on their other devices`);
            } else {
                const name = form.name.trim();
                const email = form.email.trim().toLowerCase();
                if (!name) throw new Error('Enter their name.');
                if (!validEmail(email)) throw new Error('Enter a valid email — it is their admin sign-in.');
                if ((admins || []).some((a) => a.email === email)) throw new Error(`${email} is already an admin.`);
                const exists = await rpc('admin_signin_exists', { p_email: email });
                if (!exists) {
                    if (!pw) throw new Error('This is a new sign-in — set a password for it.');
                    // The sign-in account is created through the staff function (it starts as a Materials manager)…
                    await invokeStaff({ action: 'create', display_name: name, email, password: pw });
                    // …then becomes admin everywhere; that temporary manager role is dropped.
                    await rpc('admin_grant_admin', { p_email: email, p_admin_only: true });
                } else {
                    const id = await rpc('admin_grant_admin', { p_email: email, p_admin_only: false });
                    if (pw) await rpc('admin_set_admin_password', { p_user_id: id, p_password: pw });
                }
                toast.success(`${name} is now an admin in Attendance, Materials and Site work`);
            }
            close();
            await reload();
        } catch (e) {
            setProblem(e.message || 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (row) => {
        if (
            !(await confirmAction({
                title: 'Remove admin?',
                message: `${row.name} will no longer be an admin anywhere and is signed out on their devices.${row.manager_areas?.length ? ' Their manager access stays.' : ''}`,
                confirmLabel: 'Remove admin',
                destructive: true,
            }))
        )
            return;
        try {
            await rpc('admin_revoke_admin', { p_user_id: row.user_id });
            toast.success(`${row.name} is no longer an admin`);
        } catch (e) {
            toast.error(e.message);
        }
        await reload();
    };

    return (
        <Card>
            <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5" /> Admins
                            {admins ? <Badge variant="outline">{admins.length}</Badge> : null}
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500">Admins have full control of Attendance, Materials and Site work.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search admins…" className="pl-9" />
                        </div>
                        <Button onClick={() => open('add')}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add admin
                        </Button>
                    </div>
                </div>
                {error ? (
                    <p className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                    </p>
                ) : null}
            </CardHeader>
            <CardContent className="p-0">
                {!admins ? (
                    <div className="py-10 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="py-10 text-center text-slate-400">No admins found.</p>
                ) : (
                    <ul className="divide-y divide-[var(--g-hairline)] border-t border-[var(--g-hairline)]">
                        {filtered.map((a) => (
                            <li key={a.user_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="truncate font-semibold text-slate-900">{a.name}</span>
                                        {a.is_self ? <Badge variant="secondary">You</Badge> : null}
                                        {a.manager_areas?.length ? <Badge variant="outline">Also manager</Badge> : null}
                                        {!a.materials_admin || !a.site_admin ? (
                                            <Badge variant="destructive" title="Should be admin everywhere — remove and add again to repair">
                                                Not admin in {[!a.materials_admin && 'Materials', !a.site_admin && 'Site work'].filter(Boolean).join(' / ')}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <p className="truncate text-sm text-slate-500">{a.email}</p>
                                    <p className="text-xs text-slate-400">
                                        Last signed in {when(a.last_sign_in_at)}
                                        {a.manager_areas?.length ? ` · manager in ${a.manager_areas.map(areaLabel).join(', ')}` : ''}
                                    </p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => open('password', a)} title={a.is_self ? 'Change your password' : 'Reset password'} aria-label={`Reset password for ${a.name}`}>
                                        <KeyRound className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={a.is_self || admins.length <= 1}
                                        onClick={() => remove(a)}
                                        title={a.is_self ? 'You cannot remove your own admin access' : 'Remove admin'}
                                        aria-label={`Remove admin ${a.name}`}
                                    >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>

            <Dialog open={Boolean(mode)} onOpenChange={(o) => !o && close()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{mode === 'add' ? 'Add admin' : target?.is_self ? 'Change your password' : `Reset password — ${target?.name}`}</DialogTitle>
                        <DialogDescription>
                            {mode === 'add'
                                ? 'A new email gets a new sign-in with this password. An existing account (for example a manager) becomes admin — leave the password blank to keep theirs.'
                                : 'This becomes their admin sign-in password, and the password of any manager logins they have.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form key={`${mode}-${target?.user_id || 'new'}`} onSubmit={submit} className="space-y-4" autoComplete="off">
                        {mode === 'add' ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Name</span>
                                    <Input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoComplete="off" />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Email (sign-in)</span>
                                    <Input required type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} autoComplete="off" />
                                </label>
                            </div>
                        ) : null}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block">
                                <span className="mb-1 block text-sm font-medium">{mode === 'add' ? 'Password' : 'New password'}</span>
                                <div className="relative">
                                    <Input
                                        type={show ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        value={form.password}
                                        onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                                        placeholder={`At least ${MIN_PASSWORD} characters`}
                                        className="pr-10"
                                    />
                                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
                                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-sm font-medium">Type it again</span>
                                <Input type={show ? 'text' : 'password'} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))} />
                            </label>
                        </div>
                        {mode === 'password' && !target?.is_self ? <p className="text-xs text-slate-500">They will be signed out on their other devices.</p> : null}
                        {problem ? <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{problem}</p> : null}
                        <DialogFooter className="gap-2">
                            <Button type="button" variant="outline" onClick={close}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {mode === 'add' ? 'Add admin' : 'Save password'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
