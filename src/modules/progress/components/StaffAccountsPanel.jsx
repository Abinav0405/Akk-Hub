import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Power, KeyRound, Trash2, SlidersHorizontal } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import {
    listAdmins, registerAdmin, setAdminActive, deleteAdmin,
    listManagers, createManager, setManagerActive, resetManagerPassword, deleteManager,
    setManagerJsrPermissions,
} from '@/modules/progress/lib/accounts';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { JSR_PERM_DEFAULTS, JSR_PERM_MIGRATION_HINT, normalizeJsrPerms } from '@/modules/progress/lib/jsrPermissions';
import JsrPermissionGrid from '@/modules/progress/components/JsrPermissionGrid';
import { UNIFIED, supabaseProgress } from '@/core/supabase'
import { Link } from 'react-router-dom';
import { paths } from '@/app/paths';
import { sectionHref } from '@/app/useHubSection';
import { RevealCredentialsDialog } from '@/modules/progress/components/WorkerAccountsPanel';

/** Admin-only — Manager never sees this (this whole panel only renders in AdminDashboard). */
export default function StaffAccountsPanel() {
    return (
        <div className="space-y-6">
            <ManagerAccountsSection />
            <AdminAccountsSection />
        </div>
    );
}

export function ManagerAccountsSection() {
    const [managers, setManagers] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [resetTarget, setResetTarget] = useState(null);
    const [permTarget, setPermTarget] = useState(null);
    const [revealed, setRevealed] = useState(null);
    const [busy, setBusy] = useState(false);
    const warnedMigration = useRef(false);

    const refresh = () => {
        listManagers().then((rows) => {
            setManagers(rows);
            if (
                !warnedMigration.current
                && Array.isArray(rows)
                && rows.some((m) => !m || typeof m.jsr_permissions !== 'object')
            ) {
                warnedMigration.current = true;
                toast.error(JSR_PERM_MIGRATION_HINT);
            }
        }).catch((e) => {
            toast.error(e?.message || 'Could not load manager accounts');
            setManagers([]);
        });
    };

    useEffect(refresh, []);

    const handleToggleActive = async (m) => {
        setBusy(true);
        try {
            await setManagerActive(m.id, !m.is_active);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update account'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (m) => {
        if (!window.confirm(`Delete the manager login for ${m.display_name} (${m.login_id})? They will not be able to sign in.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteManager(m.id);
            toast.success(`Deleted ${m.display_name}`);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete account'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-slate-900">Manager permissions</h3>
                    <p className="text-xs text-muted-foreground">
                        Use the sliders icon to set what each manager can do (JSR module, deleting package photos); the power icon switches Site work on/off for them.
                        {UNIFIED ? (
                            <>
                                {' '}Add managers and reset passwords on{' '}
                                <Link to={sectionHref(paths.materials.admin, 'managers')} className="font-semibold text-[var(--g-brand-text)] hover:underline">Managers</Link> — one login for every area.
                            </>
                        ) : (
                            ' Password set directly — no Supabase dashboard step.'
                        )}
                    </p>
                    {Array.isArray(managers) && managers.some((m) => !m || typeof m.jsr_permissions !== 'object') ? (
                        <p className="mt-2 text-xs text-amber-800">{JSR_PERM_MIGRATION_HINT}</p>
                    ) : null}
                </div>
                {!UNIFIED ? (
                    <Button size="sm" onClick={() => setShowAdd(true)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Add Manager
                    </Button>
                ) : null}
            </div>

            {managers === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : managers.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No manager accounts yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Login ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {managers.map((m) => (
                                <TableRow key={m.id}>
                                    <TableCell className="font-medium">{m.login_id}</TableCell>
                                    <TableCell>{m.display_name}</TableCell>
                                    <TableCell>
                                        <span className={m.is_active ? 'text-emerald-600' : 'text-slate-400'}>
                                            {m.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1.5">
                                            <Button size="sm" variant="outline" aria-label="Manager permissions" onClick={() => setPermTarget(m)}>
                                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                            </Button>
                                            {!UNIFIED ? (
                                                <Button size="sm" variant="outline" aria-label="Reset password" onClick={() => setResetTarget(m)}>
                                                    <KeyRound className="h-3.5 w-3.5" />
                                                </Button>
                                            ) : null}
                                            <Button size="sm" variant="outline" disabled={busy} aria-label={m.is_active ? 'Disable manager' : 'Enable manager'} onClick={() => handleToggleActive(m)}>
                                                <Power className="h-3.5 w-3.5" />
                                            </Button>
                                            {!UNIFIED ? (<Button
                                                size="sm"
                                                variant="outline"
                                                disabled={busy}
                                                aria-label="Delete manager login"
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={() => handleDelete(m)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>) : null}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {showAdd && (
                <AddManagerDialog
                    onClose={() => setShowAdd(false)}
                    onCreated={(vals) => {
                        setShowAdd(false);
                        refresh();
                        setRevealed({ employeeCode: vals.loginId, displayName: vals.displayName, password: vals.password });
                    }}
                />
            )}

            {resetTarget && (
                <ResetManagerPasswordDialog
                    manager={resetTarget}
                    onClose={() => setResetTarget(null)}
                    onReset={(password) => {
                        setResetTarget(null);
                        setRevealed({ employeeCode: resetTarget.login_id, displayName: resetTarget.display_name, password });
                    }}
                />
            )}

            {permTarget && (
                <EditManagerJsrDialog
                    manager={permTarget}
                    onClose={() => setPermTarget(null)}
                    onSaved={() => {
                        setPermTarget(null);
                        refresh();
                    }}
                />
            )}

            {revealed && <RevealCredentialsDialog {...revealed} onClose={() => setRevealed(null)} />}
        </Card>
    );
}

export function AddManagerDialog({ onClose, onCreated }) {
    const [loginId, setLoginId] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [perms, setPerms] = useState(() => ({ ...JSR_PERM_DEFAULTS }));
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const id = loginId.trim();
            const name = displayName.trim();
            await createManager({ loginId: id, displayName: name, password, jsrPermissions: perms });
            onCreated({ loginId: id, displayName: name, password });
        } catch (e2) {
            toast.error(e2.message || 'Could not create account');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Add Manager</DialogTitle>
                    <DialogDescription>View-only until you tick more boxes below.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Login ID</Label>
                        <Input value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Password</Label>
                        <Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Permissions</Label>
                        <JsrPermissionGrid value={perms} onChange={setPerms} />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={busy}>Create</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function EditManagerJsrDialog({ manager, onClose, onSaved }) {
    const [perms, setPerms] = useState(() => normalizeJsrPerms(manager.jsr_permissions));
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await setManagerJsrPermissions(manager.id, perms);
            toast.success(`Updated permissions for ${manager.display_name}`);
            onSaved();
        } catch (e2) {
            toast.error(e2.message || friendlyDbError(e2, 'Could not save permissions'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Permissions — {manager.display_name}</DialogTitle>
                    <DialogDescription>Login ID {manager.login_id}. Each capability is independent and enforced on the server.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <JsrPermissionGrid value={perms} onChange={setPerms} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={busy}>Save permissions</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function ResetManagerPasswordDialog({ manager, onClose, onReset }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await resetManagerPassword(manager.id, password);
            onReset(password);
        } catch (e2) {
            toast.error(e2.message || 'Could not reset password');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Reset Password — {manager.display_name}</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>New Password</Label>
                        <Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={busy}>Reset</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function AdminAccountsSection() {
    const [admins, setAdmins] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [busy, setBusy] = useState(false);
    const [myId, setMyId] = useState(null);

    const refresh = () => {
        listAdmins().then(setAdmins).catch(() => {
            toast.error('Could not load admin accounts');
            setAdmins([]);
        });
    };

    useEffect(refresh, []);

    useEffect(() => {
        supabaseProgress.auth.getUser().then(({ data }) => setMyId(data?.user?.id || null));
    }, []);

    const handleToggleActive = async (a) => {
        if (a.user_id === myId) {
            toast.error('You cannot disable your own account');
            return;
        }
        setBusy(true);
        try {
            await setAdminActive(a.user_id, !a.is_active);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update account'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (a) => {
        if (a.user_id === myId) {
            toast.error('You cannot delete your own account');
            return;
        }
        if (!window.confirm(`Delete the admin login for ${a.display_name} (${a.email})? They will not be able to open the Admin portal.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteAdmin(a.user_id);
            toast.success(`Deleted ${a.display_name}`);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete account'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-slate-900">Admin Logins</h3>
                    <p className="text-xs text-muted-foreground">Real Supabase Auth users — create the login in the dashboard first.</p>
                </div>
                <Button size="sm" onClick={() => setShowAdd(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Register Admin
                </Button>
            </div>

            {admins === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : admins.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No admin accounts registered yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {admins.map((a) => (
                                <TableRow key={a.user_id}>
                                    <TableCell className="font-medium">{a.email}</TableCell>
                                    <TableCell>{a.display_name}</TableCell>
                                    <TableCell>
                                        <span className={a.is_active ? 'text-emerald-600' : 'text-slate-400'}>
                                            {a.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1.5">
                                            <Button size="sm" variant="outline" disabled={busy || (a.is_active && a.user_id === myId)} aria-label={a.is_active ? 'Disable admin' : 'Enable admin'} onClick={() => handleToggleActive(a)}>
                                                <Power className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={busy || a.user_id === myId}
                                                aria-label="Delete admin login"
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={() => handleDelete(a)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {showAdd && (
                <RegisterAdminDialog
                    onClose={() => setShowAdd(false)}
                    onCreated={() => { setShowAdd(false); refresh(); }}
                />
            )}
        </Card>
    );
}

export function RegisterAdminDialog({ onClose, onCreated }) {
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await registerAdmin({ email: email.trim().toLowerCase(), displayName: displayName.trim() });
            toast.success('Admin account registered');
            onCreated();
        } catch (e2) {
            toast.error(e2.message || 'Could not register admin account');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Register Admin</DialogTitle>
                    <DialogDescription>
                        First create the login in Supabase's dashboard under Authentication → Users (email + password),
                        then enter that same email here to grant it admin access.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Email (must match the Supabase Auth user)</Label>
                        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={busy}>Register</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
