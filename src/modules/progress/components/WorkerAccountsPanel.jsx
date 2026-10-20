import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, KeyRound, Power, Copy, Check, Trash2 } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import StaffPanelIntro from '@/modules/progress/components/StaffPanelIntro';
import { listWorkers, createWorker, setWorkerActive, resetWorkerPassword, deleteWorker } from '@/modules/progress/lib/accounts';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { isNativeApp } from '@/core/platform';

export default function WorkerAccountsPanel({ embedded = false }) {
    const [workers, setWorkers] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [resetTarget, setResetTarget] = useState(null);
    const [revealed, setRevealed] = useState(null); // { employeeCode, displayName, password }
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const native = isNativeApp();

    const filtered = useMemo(
        () => (workers || []).filter((w) => matchesQuery([w.display_name, w.employee_code], search)),
        [workers, search]
    );
    const searchActive = Boolean(search.trim());

    const refresh = () => {
        listWorkers().then(setWorkers).catch(() => {
            toast.error('Could not load employee/technician accounts');
            setWorkers([]);
        });
    };

    useEffect(refresh, []);

    const handleDelete = async (w) => {
        const label = `${w.display_name} (${w.employee_code})`;
        if (!window.confirm(`Delete the login for ${label}? They will not be able to sign in. Existing submissions stay in Packages.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteWorker(w.id);
            toast.success(`Deleted ${label}`);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete account'));
        } finally {
            setBusy(false);
        }
    };

    const handleToggleActive = async (w) => {
        setBusy(true);
        try {
            await setWorkerActive(w.id, !w.is_active);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update account'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            {!embedded ? (
                <StaffPanelIntro
                    title="Employees"
                    description="Technicians who sign in to the site app with an employee ID."
                    actions={
                        <Button size="sm" className={native ? 'min-h-11' : undefined} onClick={() => setShowAdd(true)}>
                            <Plus className="mr-1.5 h-4 w-4" /> Add Employee/Technician
                        </Button>
                    }
                />
            ) : null}
        <Card className="p-5">
            {embedded ? (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold text-slate-900">Employee/Technician Logins</h3>
                <Button size="sm" className={native ? 'min-h-11' : undefined} onClick={() => setShowAdd(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add Employee/Technician
                </Button>
            </div>
            ) : null}

            {workers !== null && workers.length > 0 && (
                <SearchField
                    id="employee-search"
                    value={search}
                    onChange={setSearch}
                    placeholder="Search name or employee ID…"
                    native={native}
                    className="mb-4 w-full sm:max-w-xs"
                />
            )}

            {workers === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : workers.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No employee/technician accounts yet.</p>
            ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    {searchActive ? 'No employees match this search.' : 'No employee/technician accounts yet.'}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Employee ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((w) => (
                                <TableRow key={w.id}>
                                    <TableCell className="font-medium">{w.employee_code}</TableCell>
                                    <TableCell>{w.display_name}</TableCell>
                                    <TableCell>
                                        <span className={w.is_active ? 'text-emerald-600' : 'text-slate-400'}>
                                            {w.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1.5">
                                            <Button size="sm" variant="outline" aria-label="Reset password" onClick={() => setResetTarget(w)}>
                                                <KeyRound className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={busy}
                                                aria-label={w.is_active ? 'Disable employee/technician' : 'Enable employee/technician'}
                                                onClick={() => handleToggleActive(w)}
                                            >
                                                <Power className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={busy}
                                                aria-label="Delete employee/technician login"
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={() => handleDelete(w)}
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
                <AddWorkerDialog
                    onClose={() => setShowAdd(false)}
                    onCreated={(vals) => {
                        setShowAdd(false);
                        refresh();
                        setRevealed({ employeeCode: vals.employeeCode, displayName: vals.displayName, password: vals.password });
                    }}
                />
            )}

            {resetTarget && (
                <ResetPasswordDialog
                    worker={resetTarget}
                    onClose={() => setResetTarget(null)}
                    onReset={(password) => {
                        setResetTarget(null);
                        setRevealed({ employeeCode: resetTarget.employee_code, displayName: resetTarget.display_name, password });
                    }}
                />
            )}

            {revealed && <RevealCredentialsDialog {...revealed} onClose={() => setRevealed(null)} />}
        </Card>
        </div>
    );
}

export function AddWorkerDialog({ onClose, onCreated }) {
    const [employeeCode, setEmployeeCode] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const code = employeeCode.trim();
            const name = displayName.trim();
            await createWorker({ employeeCode: code, displayName: name, password });
            onCreated({ employeeCode: code, displayName: name, password });
        } catch (e2) {
            toast.error(e2.message || 'Could not create account');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Add Employee/Technician</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Employee ID</Label>
                        <Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Password</Label>
                        <Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
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

export function ResetPasswordDialog({ worker, onClose, onReset }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await resetWorkerPassword(worker.id, password);
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
                <DialogHeader><DialogTitle>Reset Password — {worker.display_name}</DialogTitle></DialogHeader>
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

/** Passwords are bcrypt-hashed at rest and can never be looked up again — this is the one time it's shown. */
export function RevealCredentialsDialog({ employeeCode, displayName, password, onClose, loginLabel = 'ID' }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(`${employeeCode} / ${password}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy — copy it manually below');
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Share these login details with {displayName}</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                    This password is stored securely and can't be viewed again after you close this — write it down or share it now.
                </p>
                <div className="space-y-2 rounded-xl border border-border bg-slate-50 p-4 font-mono text-sm">
                    <p>{loginLabel}: <span className="font-semibold">{employeeCode}</span></p>
                    <p>Password: <span className="font-semibold">{password}</span></p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleCopy}>
                        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button onClick={onClose}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
