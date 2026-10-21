import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseMaterials, FN } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Activity, KeyRound, Loader2, Pencil, Plus, Search, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { formatDisplayDateTime } from '@/modules/materials/lib/dates';

const EMPTY_FORM = { display_name: '', email: '', password: '' };

async function invokeStaff(body) {
    const { data: sessionData } = await supabaseMaterials.auth.getSession();
    const token = sessionData?.session?.access_token;
    const { data, error } = await supabaseMaterials.functions.invoke(FN.manageStaff, {
        body,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (error) {
        let message = error.message || 'Manager service request failed';
        try {
            const payload = await error.context?.json();
            message = payload?.error || payload?.message || message;
        } catch {
            /* response body was unavailable */
        }
        throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
}

function activityDetails(item) {
    const before = item.before_data || {};
    const after = item.after_data || {};
    if (item.action === 'transaction_approved' || item.action === 'transaction_declined') {
        return `${after.worker_name || before.worker_name || 'Worker'} · ${after.transaction_type || before.transaction_type || 'transaction'}`;
    }
    if (item.entity_type === 'material') {
        const name = after.name || before.name || 'Material';
        if (before.quantity !== after.quantity && after.quantity != null) {
            return `${name}: ${before.quantity ?? '—'} → ${after.quantity}`;
        }
        return name;
    }
    return '';
}

export default function ManagersManager() {
    const [managers, setManagers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [editOpen, setEditOpen] = useState(false);
    const [activityOpen, setActivityOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [activities, setActivities] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityFilter, setActivityFilter] = useState('all');
    const [activityDate, setActivityDate] = useState('all');

    const loadManagers = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabaseMaterials
                .from('staff_profiles')
                .select('user_id, display_name, email, role, roles, is_active, created_at, updated_at')
                .contains('roles', ['manager'])
                .order('display_name');
            if (error) throw error;
            setManagers(data || []);
        } catch (error) {
            toast.error(error.message || 'Failed to load managers');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadManagers(); }, [loadManagers]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return managers;
        return managers.filter((manager) =>
            manager.display_name.toLowerCase().includes(term) ||
            manager.email.toLowerCase().includes(term)
        );
    }, [managers, search]);

    const openCreate = () => {
        setSelected(null);
        setForm(EMPTY_FORM);
        setEditOpen(true);
    };

    const openEdit = (manager) => {
        setSelected(manager);
        setForm({ display_name: manager.display_name, email: manager.email, password: '' });
        setEditOpen(true);
    };

    const saveManager = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            await invokeStaff({
                action: selected ? 'update' : 'create',
                user_id: selected?.user_id,
                display_name: form.display_name.trim(),
                email: form.email.trim(),
                password: form.password,
            });
            toast.success(selected ? 'Manager login updated' : 'Manager created');
            setEditOpen(false);
            setSelected(null);
            await loadManagers();
        } catch (error) {
            toast.error(error.message || 'Failed to save manager');
        } finally {
            setSaving(false);
        }
    };

    const deleteManager = async (manager) => {
        if (!(await confirmAction({
            title: 'Remove manager access?',
            message: `Remove Manager access from "${manager.display_name}"? Admin access, if present, will remain.`,
            confirmLabel: 'Remove access',
            destructive: true,
        }))) return;
        try {
            await invokeStaff({ action: 'delete', user_id: manager.user_id });
            toast.success('Manager access removed');
            setSelected(null);
            await loadManagers();
        } catch (error) {
            toast.error(error.message || 'Failed to delete manager');
        }
    };

    const removeAdminAccess = async () => {
        if (!selected?.roles?.includes('admin')) return;
        if (!(await confirmAction({
            title: 'Remove admin access?',
            message: `Remove Admin access from "${selected.display_name}"? Manager access will remain.`,
            confirmLabel: 'Remove admin access',
            destructive: true,
        }))) return;
        setSaving(true);
        try {
            await invokeStaff({ action: 'remove_admin', user_id: selected.user_id });
            toast.success('Admin access removed');
            setEditOpen(false);
            setSelected(null);
            await loadManagers();
        } catch (error) {
            toast.error(error.message || 'Failed to remove Admin access');
        } finally {
            setSaving(false);
        }
    };

    const grantAdminAccess = async () => {
        if (!selected || selected.roles?.includes('admin')) return;
        if (!(await confirmAction({
            title: 'Grant admin access?',
            message: `Grant Admin access to "${selected.display_name}"? They will have full administrative permissions.`,
            confirmLabel: 'Grant admin access',
            tone: 'admin',
        }))) return;
        setSaving(true);
        try {
            await invokeStaff({ action: 'grant_admin', user_id: selected.user_id });
            toast.success('Admin access granted');
            setEditOpen(false);
            setSelected(null);
            await loadManagers();
        } catch (error) {
            toast.error(error.message || 'Failed to grant Admin access');
        } finally {
            setSaving(false);
        }
    };

    const openActivities = async (manager) => {
        setSelected(manager);
        setActivityOpen(true);
        setActivityLoading(true);
        try {
            const { data, error } = await supabaseMaterials
                .from('staff_activity')
                .select('*')
                .eq('actor_id', manager.user_id)
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) throw error;
            setActivities(data || []);
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
        const age = Date.now() - new Date(item.created_at).getTime();
        const days = age / 86400000;
        return activityDate === 'week' ? days <= 7 : activityDate === 'month' ? days <= 31 : days <= 366;
    });

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <UserCog className="h-5 w-5" /> Managers
                        <Badge variant="outline">{filtered.length} / {managers.length}</Badge>
                    </CardTitle>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search managers..." className="pl-9" />
                        </div>
                        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Manager</Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={4} className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow>
                            ) : filtered.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="py-10 text-center text-slate-400">No managers found.</TableCell></TableRow>
                            ) : filtered.map((manager) => (
                                <TableRow key={manager.user_id}>
                                    <TableCell>
                                        <button className="font-semibold text-slate-900 hover:text-brand hover:underline" onClick={() => setSelected(manager)}>
                                            {manager.display_name}
                                        </button>
                                    </TableCell>
                                    <TableCell>{manager.email}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            <Badge variant={manager.is_active ? 'success' : 'secondary'}>{manager.is_active ? 'Active' : 'Disabled'}</Badge>
                                            {manager.roles?.includes('admin') && <Badge variant="outline">Also Admin</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => setSelected(manager)} title="Manager options"><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => deleteManager(manager)} title="Delete manager"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            <Dialog open={!!selected && !editOpen && !activityOpen} onOpenChange={(open) => !open && setSelected(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{selected?.display_name}</DialogTitle><DialogDescription>Choose what you want to view.</DialogDescription></DialogHeader>
                    <div className="grid gap-3 py-2">
                        <Button variant="outline" className="h-auto justify-start p-4" onClick={() => openEdit(selected)}>
                            <KeyRound className="mr-3 h-5 w-5" /><span className="text-left"><strong className="block">View/change login details</strong><small className="text-slate-500">Update name, email, or replace password</small></span>
                        </Button>
                        <Button variant="outline" className="h-auto justify-start p-4" onClick={() => openActivities(selected)}>
                            <Activity className="mr-3 h-5 w-5" /><span className="text-left"><strong className="block">View activities</strong><small className="text-slate-500">Approvals, declines, edits, and material changes</small></span>
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{selected ? 'Login details' : 'Add manager access'}</DialogTitle><DialogDescription>Use an existing admin email to grant access to both portals. A password is required only for a brand-new account.</DialogDescription></DialogHeader>
                    <form onSubmit={saveManager} className="space-y-4">
                        <Input required value={form.display_name} onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} placeholder="Manager name" />
                        <Input required type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" />
                        <Input minLength={8} type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder={selected ? 'New password (optional)' : 'Password (only for a new account)'} />
                        <DialogFooter className="gap-2 sm:justify-between">
                            <div>
                                {selected?.roles?.includes('admin') ? (
                                    <Button type="button" variant="destructive" disabled={saving} onClick={removeAdminAccess}>
                                        Remove Admin Access
                                    </Button>
                                ) : selected ? (
                                    <Button type="button" variant="outline" disabled={saving} onClick={grantAdminAccess}>
                                        Grant Admin Access
                                    </Button>
                                ) : null}
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                                <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
                            </div>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
                <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
                    <DialogHeader><DialogTitle>{selected?.display_name} — Activities</DialogTitle><DialogDescription>Newest activity first.</DialogDescription></DialogHeader>
                    <div className="flex flex-wrap gap-2">
                        <Select value={activityFilter} onValueChange={setActivityFilter}>
                            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All activities</SelectItem><SelectItem value="transactions">Transactions</SelectItem><SelectItem value="materials">Materials</SelectItem></SelectContent>
                        </Select>
                        <Select value={activityDate} onValueChange={setActivityDate}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All time</SelectItem><SelectItem value="week">Past week</SelectItem><SelectItem value="month">Past month</SelectItem><SelectItem value="year">Past year</SelectItem></SelectContent>
                        </Select>
                    </div>
                    <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                        {activityLoading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" /> : visibleActivities.length === 0 ? (
                            <p className="py-10 text-center text-slate-400">No activity found.</p>
                        ) : visibleActivities.map((item) => (
                            <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                                <div className="flex items-start justify-between gap-3"><p className="font-medium">{item.summary}</p><Badge variant="outline">{item.entity_type}</Badge></div>
                                <p className="mt-1 text-sm text-slate-600">{activityDetails(item)}</p>
                                <p className="mt-2 text-xs text-slate-400">{formatDisplayDateTime(item.created_at)}</p>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
