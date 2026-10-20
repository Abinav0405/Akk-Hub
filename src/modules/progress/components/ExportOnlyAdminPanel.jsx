import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Power, KeyRound, Trash2, FileDown, Undo2 } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import {
    listExporters, createExporter, setExporterActive, resetExporterPassword, deleteExporter,
    listPackageExportStatus, listPackageExportEvents,
} from '@/modules/progress/lib/accounts';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { formatDate, formatDateTime } from '@/modules/progress/lib/dates';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { sendPackagesToExport, unsendPackagesFromExport } from '@/modules/progress/lib/staffPackages';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import { RevealCredentialsDialog } from '@/modules/progress/components/WorkerAccountsPanel';
import StaffPanelIntro from '@/modules/progress/components/StaffPanelIntro';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';

const STATUS_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'not_sent', label: 'Not sent' },
    { id: 'sent', label: 'Sent to export' },
    { id: 'exported', label: 'Downloaded' },
    { id: 'not_exported', label: 'Not downloaded' },
];

export default function ExportOnlyAdminPanel() {
    return (
        <div className="space-y-6">
            <StaffPanelIntro
                title="Export queue"
                description="Export Only logins, packages waiting to be sent, and recent download activity."
            />
            <ExporterAccountsSection />
            <ExportStatusSection />
            <ExportActivitySection />
        </div>
    );
}

function ExporterAccountsSection() {
    const [exporters, setExporters] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [resetTarget, setResetTarget] = useState(null);
    const [revealed, setRevealed] = useState(null);
    const [busy, setBusy] = useState(false);

    const refresh = () => {
        listExporters().then(setExporters).catch(() => {
            toast.error('Could not load Export Only accounts');
            setExporters([]);
        });
    };

    useEffect(refresh, []);

    const handleToggleActive = async (row) => {
        setBusy(true);
        try {
            await setExporterActive(row.id, !row.is_active);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update account'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete the Export Only login for ${row.display_name}? They will not be able to sign in.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteExporter(row.id);
            toast.success(`Deleted ${row.display_name}`);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete account'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-base font-semibold text-slate-900">Export Only Logins</h3>
                    <p className="text-xs text-muted-foreground">Name and password only — no employee ID.</p>
                </div>
                <Button size="sm" onClick={() => setShowAdd(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add login
                </Button>
            </div>

            {exporters === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : exporters.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No Export Only accounts yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {exporters.map((row) => (
                                <TableRow key={row.id}>
                                    <TableCell className="font-medium">{row.display_name}</TableCell>
                                    <TableCell>
                                        <span className={row.is_active ? 'text-emerald-600' : 'text-slate-400'}>
                                            {row.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1.5">
                                            <Button size="sm" variant="outline" aria-label="Reset password" onClick={() => setResetTarget(row)}>
                                                <KeyRound className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={busy} aria-label={row.is_active ? 'Disable login' : 'Enable login'} onClick={() => handleToggleActive(row)}>
                                                <Power className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={busy}
                                                aria-label="Delete Export Only login"
                                                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={() => handleDelete(row)}
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
                <AddExporterDialog
                    onClose={() => setShowAdd(false)}
                    onCreated={(vals) => {
                        setShowAdd(false);
                        refresh();
                        setRevealed({
                            employeeCode: vals.displayName,
                            displayName: vals.displayName,
                            password: vals.password,
                            loginLabel: 'Name',
                        });
                    }}
                />
            )}

            {resetTarget && (
                <ResetExporterPasswordDialog
                    exporter={resetTarget}
                    onClose={() => setResetTarget(null)}
                    onReset={(password) => {
                        setResetTarget(null);
                        setRevealed({
                            employeeCode: resetTarget.display_name,
                            displayName: resetTarget.display_name,
                            password,
                            loginLabel: 'Name',
                        });
                    }}
                />
            )}

            {revealed && <RevealCredentialsDialog {...revealed} onClose={() => setRevealed(null)} />}
        </Card>
    );
}

function AddExporterDialog({ onClose, onCreated }) {
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const name = displayName.trim();
            await createExporter({ displayName: name, password });
            onCreated({ displayName: name, password });
        } catch (e2) {
            toast.error(e2.message || 'Could not create account');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Add Export Only login</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
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

function ResetExporterPasswordDialog({ exporter, onClose, onReset }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await resetExporterPassword(exporter.id, password);
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
                <DialogHeader><DialogTitle>Reset Password — {exporter.display_name}</DialogTitle></DialogHeader>
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

function ExportStatusSection() {
    const native = isNativeApp();
    const [rows, setRows] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [sending, setSending] = useState(false);
    const [unsending, setUnsending] = useState(false);
    const queueBusy = sending || unsending;

    const refresh = () => {
        listPackageExportStatus()
            .then(setRows)
            .catch(() => {
                toast.error('Could not load export status');
                setRows([]);
            });
    };

    useEffect(refresh, []);

    const counts = useMemo(() => {
        const list = rows || [];
        return {
            all: list.length,
            not_sent: list.filter((r) => !r.sent_to_export).length,
            sent: list.filter((r) => r.sent_to_export).length,
            exported: list.filter((r) => r.export_count > 0).length,
            not_exported: list.filter((r) => !(r.export_count > 0)).length,
        };
    }, [rows]);

    const filtered = useMemo(() => {
        return (rows || []).filter((r) => {
            if (filter === 'not_sent' && r.sent_to_export) return false;
            if (filter === 'sent' && !r.sent_to_export) return false;
            if (filter === 'exported' && !(r.export_count > 0)) return false;
            if (filter === 'not_exported' && r.export_count > 0) return false;
            return matchesQuery(
                [
                    r.site_name,
                    r.lcb_id,
                    r.section_label,
                    r.worker_display_name,
                    r.last_exported_by_name,
                    packageHeading({ site_name: r.site_name, section_label: r.section_label, lcb_id: r.lcb_id }),
                    formatDate(r.package_date),
                ],
                search
            );
        });
    }, [rows, filter, search]);

    const sendableVisible = useMemo(
        () => filtered.filter((r) => !r.sent_to_export),
        [filtered]
    );

    const unsendableVisible = useMemo(
        () => filtered.filter((r) => r.sent_to_export),
        [filtered]
    );

    const selectableVisible = useMemo(() => filtered, [filtered]);

    useEffect(() => {
        const allow = new Set(selectableVisible.map((r) => r.package_id));
        setSelectedIds((prev) => {
            let changed = false;
            const next = new Set();
            prev.forEach((id) => {
                if (allow.has(id)) next.add(id);
                else changed = true;
            });
            if (!changed && next.size === prev.size) return prev;
            return next;
        });
    }, [selectableVisible]);

    const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selectedIds.has(r.package_id));
    const selectedSendableIds = sendableVisible.filter((r) => selectedIds.has(r.package_id)).map((r) => r.package_id);
    const selectedUnsendableIds = unsendableVisible.filter((r) => selectedIds.has(r.package_id)).map((r) => r.package_id);

    const toggleSelect = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectVisible = () => {
        if (allVisibleSelected) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(selectableVisible.map((r) => r.package_id)));
    };

    const handleSendSelected = async () => {
        const ids = selectedSendableIds;
        if (!ids.length) {
            toast.error('Select at least one approved package that has not been sent');
            return;
        }
        setSending(true);
        try {
            const count = await sendPackagesToExport(ids);
            toast.success(count === 1 ? 'Sent 1 package to export' : `Sent ${count} packages to export`);
            setSelectedIds(new Set());
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not send packages to export'));
        } finally {
            setSending(false);
        }
    };

    const handleUnsendSelected = async () => {
        const ids = selectedUnsendableIds;
        if (!ids.length) {
            toast.error('Select at least one package that has already been sent');
            return;
        }
        if (!window.confirm('These packages will disappear from Export Only until sent again')) {
            return;
        }
        setUnsending(true);
        try {
            const count = await unsendPackagesFromExport(ids);
            toast.success(count === 1 ? 'Unsent 1 package from export' : `Unsent ${count} packages from export`);
            setSelectedIds(new Set());
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not unsend packages from export'));
        } finally {
            setUnsending(false);
        }
    };

    return (
        <Card className="p-5">
            <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Send packages to Export Only</h3>
                <p className="text-xs text-muted-foreground">
                    Send approved packages to Export Only, or unsend them. Approval does not change.
                </p>
            </div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={cn(
                                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                native && 'min-h-11 px-4',
                                filter === f.id
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-border bg-white text-slate-600 hover:border-slate-300'
                            )}
                        >
                            {f.label}
                            <span className={cn('ml-1.5 text-xs', filter === f.id ? 'text-white/70' : 'text-slate-400')}>
                                {counts[f.id] || 0}
                            </span>
                        </button>
                    ))}
                </div>
                <SearchField
                    id="export-status-search"
                    value={search}
                    onChange={setSearch}
                    placeholder="Search package, site, or name…"
                    native={native}
                    className="w-full sm:max-w-xs"
                />
            </div>
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-slate-900">
                    {selectedIds.size === 0
                        ? 'No packages selected'
                        : selectedIds.size === 1
                            ? '1 package selected'
                            : `${selectedIds.size} packages selected`}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                        type="button"
                        variant="outline"
                        className={cn('w-full sm:w-auto', native && 'min-h-11')}
                        disabled={queueBusy || selectableVisible.length === 0}
                        onClick={toggleSelectVisible}
                    >
                        {allVisibleSelected ? 'Clear selection' : 'Select these'}
                    </Button>
                    <Button
                        type="button"
                        className={cn('w-full sm:w-auto', native && 'min-h-11')}
                        disabled={queueBusy || selectedSendableIds.length === 0}
                        onClick={handleSendSelected}
                    >
                        {sending ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                            <FileDown className="mr-1.5 h-4 w-4" />
                        )}
                        Send selected to export
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(
                            'w-full border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 sm:w-auto',
                            native && 'min-h-11'
                        )}
                        disabled={queueBusy || selectedUnsendableIds.length === 0}
                        onClick={handleUnsendSelected}
                    >
                        {unsending ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                            <Undo2 className="mr-1.5 h-4 w-4" />
                        )}
                        Unsend selected
                    </Button>
                </div>
            </div>
            {rows === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No packages match this view.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10">
                                    <input
                                        type="checkbox"
                                        className={cn('h-4 w-4 accent-slate-900', native && 'h-5 w-5')}
                                        checked={allVisibleSelected}
                                        disabled={queueBusy || selectableVisible.length === 0}
                                        onChange={toggleSelectVisible}
                                        aria-label="Select these packages"
                                    />
                                </TableHead>
                                <TableHead>Package</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Sent to export</TableHead>
                                <TableHead>Last exported by</TableHead>
                                <TableHead>Last download</TableHead>
                                <TableHead>Format</TableHead>
                                <TableHead className="text-right">Times</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((r) => {
                                const sent = Boolean(r.sent_to_export);
                                return (
                                    <TableRow key={r.package_id}>
                                        <TableCell>
                                            <input
                                                type="checkbox"
                                                className={cn('h-4 w-4 accent-slate-900', native && 'h-5 w-5')}
                                                checked={selectedIds.has(r.package_id)}
                                                disabled={queueBusy}
                                                onChange={() => toggleSelect(r.package_id)}
                                                aria-label={sent ? 'Select to unsend from export' : 'Select to send to export'}
                                            />
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {packageHeading({ site: { name: r.site_name }, site_name: r.site_name, section_label: r.section_label, lcb_id: r.lcb_id })}
                                            {r.worker_display_name ? (
                                                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{r.worker_display_name}</span>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>{formatDate(r.package_date)}</TableCell>
                                        <TableCell>
                                            {sent ? (
                                                <span className="text-sky-800">
                                                    {r.sent_to_export_at ? formatDateTime(r.sent_to_export_at, { seconds: false }) : 'Sent'}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">Not sent</span>
                                            )}
                                        </TableCell>
                                        <TableCell>{r.last_exported_by_name || '—'}</TableCell>
                                        <TableCell>{r.last_exported_at ? formatDateTime(r.last_exported_at, { seconds: false }) : '—'}</TableCell>
                                        <TableCell>{r.last_exported_format ? String(r.last_exported_format).toUpperCase() : '—'}</TableCell>
                                        <TableCell className="text-right">{Number(r.export_count || 0)}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </Card>
    );
}

function ExportActivitySection() {
    const [events, setEvents] = useState(null);

    useEffect(() => {
        listPackageExportEvents()
            .then(setEvents)
            .catch(() => {
                toast.error('Could not load export activity');
                setEvents([]);
            });
    }, []);

    return (
        <Card className="p-5">
            <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Recent export activity</h3>
                <p className="text-xs text-muted-foreground">Every PDF or Excel download from the Export Only portal.</p>
            </div>
            {events === null ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No Export Only downloads yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>When</TableHead>
                                <TableHead>Exported by</TableHead>
                                <TableHead>Package</TableHead>
                                <TableHead>Format</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {events.map((e) => (
                                <TableRow key={e.id}>
                                    <TableCell>{formatDateTime(e.exported_at, { seconds: false })}</TableCell>
                                    <TableCell className="font-medium">{e.exporter_name}</TableCell>
                                    <TableCell>
                                        {packageHeading({ site: { name: e.site_name }, site_name: e.site_name, section_label: e.section_label, lcb_id: e.lcb_id })}
                                        <span className="mt-0.5 block text-xs text-muted-foreground">{formatDate(e.package_date)}</span>
                                    </TableCell>
                                    <TableCell>{String(e.format || '').toUpperCase()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </Card>
    );
}
