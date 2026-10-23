import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
    Car, Loader2, QrCode, Edit2, Trash2, MapPin, Navigation, Eye, Plus, Flag, AlertTriangle, FileSpreadsheet, RefreshCw,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    createVehicle,
    deleteVehicle,
    deleteJourney,
    listActiveJourneys,
    listCompletedJourneys,
    listVehicles,
    updateVehicle,
    getLatestLocationPoint,
    countVehicleJourneys,
    endJourney,
    regenerateVehicleQr,
    getJourneyGpsSummary,
} from '@/modules/timesheet/lib/vehicleService';
import { downloadJourneysExcel } from '@/modules/timesheet/lib/vehicleJourneyExport';
import { formatDuration } from '@/modules/timesheet/lib/vehicleJourneyStats';
import { glassPanel, glassDialog, glassInput } from '@/ui/PortalShell';
import { cn } from '@/modules/timesheet/lib/utils';

const VehicleLiveMap = lazy(() => import('@/modules/timesheet/components/VehicleLiveMap'));
const VehicleJourneyDetail = lazy(() => import('@/modules/timesheet/components/VehicleJourneyDetail'));

const sgDate = (d) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const minsAgo = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);
const agoText = (m) => (m == null ? 'no GPS yet' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`);

export default function VehiclesTab() {
    const queryClient = useQueryClient();
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [editVehicle, setEditVehicle] = useState(null);
    const [qrPreview, setQrPreview] = useState(null);
    const [trackJourney, setTrackJourney] = useState(null);
    const [viewJourney, setViewJourney] = useState(null);
    const [form, setForm] = useState({ vehicle_number: '', description: '' });
    const [journeyLocations, setJourneyLocations] = useState({});
    const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState(null);
    const [pendingDeleteJourney, setPendingDeleteJourney] = useState(null);
    const [deleteJourneyCount, setDeleteJourneyCount] = useState(0);
    const [pendingEndJourney, setPendingEndJourney] = useState(null);
    const [filter, setFilter] = useState(() => ({ from: sgDate(new Date(Date.now() - 30 * 864e5)), to: sgDate(new Date()), vehicleId: '' }));
    const [gpsSummary, setGpsSummary] = useState({});
    const [exporting, setExporting] = useState(false);

    const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
        queryKey: ['vehicles'],
        queryFn: listVehicles,
    });

    const { data: activeJourneys = [], isLoading: loadingActive } = useQuery({
        queryKey: ['vehicleJourneys', 'active'],
        queryFn: listActiveJourneys,
        refetchInterval: 15000,
    });

    const { data: completedJourneys = [], isLoading: loadingCompleted } = useQuery({
        queryKey: ['vehicleJourneys', 'completed', filter],
        queryFn: () => listCompletedJourneys({ limit: 300, from: filter.from || null, to: filter.to || null, vehicleId: filter.vehicleId || null }),
        refetchInterval: 60000,
    });

    // GPS point counts → flag journeys where tracking clearly did not run (e.g. app used instead of website).
    useEffect(() => {
        const ids = completedJourneys.slice(0, 120).map((j) => j.id).filter((id) => gpsSummary[id] == null);
        if (!ids.length) return;
        let cancelled = false;
        getJourneyGpsSummary(ids).then((m) => !cancelled && setGpsSummary((g) => ({ ...g, ...m }))).catch(() => {});
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completedJourneys]);

    const totals = completedJourneys.reduce(
        (t, j) => ({ km: t.km + Number(j.total_distance_km || 0), s: t.s + Number(j.duration_seconds || 0) }),
        { km: 0, s: 0 },
    );
    const lowGps = (j) => {
        const pts = gpsSummary[j.id]?.points;
        return pts != null && Number(j.duration_seconds || 0) > 30 * 60 && pts < Math.max(10, Number(j.duration_seconds) / 600);
    };

    useEffect(() => {
        if (!activeJourneys.length) return;
        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                activeJourneys.map(async (j) => {
                    try {
                        const pt = await getLatestLocationPoint(j.id);
                        return [j.id, pt];
                    } catch {
                        return [j.id, null];
                    }
                })
            );
            if (!cancelled) {
                setJourneyLocations(Object.fromEntries(entries));
            }
        })();
        return () => { cancelled = true; };
    }, [activeJourneys]);

    const createMutation = useMutation({
        mutationFn: createVehicle,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
            toast.success('Vehicle added');
            setShowAddDialog(false);
            setForm({ vehicle_number: '', description: '' });
        },
        onError: (e) => toast.error(e.message || 'Failed to add vehicle'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, patch }) => updateVehicle(id, patch),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
            toast.success('Vehicle updated');
            setEditVehicle(null);
        },
        onError: (e) => toast.error(e.message || 'Failed to update'),
    });

    const deleteMutation = useMutation({
        mutationFn: deleteVehicle,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
            queryClient.invalidateQueries({ queryKey: ['vehicleJourneys'] });
            toast.success('Vehicle deleted');
            setPendingDeleteVehicle(null);
        },
        onError: (e) => toast.error(e.message || 'Failed to delete vehicle'),
    });

    const endJourneyMutation = useMutation({
        mutationFn: (j) => {
            const loc = journeyLocations[j.id];
            return endJourney(j.id, loc ? { lat: Number(loc.latitude), lng: Number(loc.longitude) } : {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicleJourneys'] });
            queryClient.invalidateQueries({ queryKey: ['activeVehicleJourney'] });
            toast.success('Journey ended — it is now in Completed journeys');
            setPendingEndJourney(null);
        },
        onError: (e) => toast.error(e.message || 'Could not end the journey'),
    });

    const regenerateMutation = useMutation({
        mutationFn: regenerateVehicleQr,
        onSuccess: (v) => {
            queryClient.invalidateQueries({ queryKey: ['vehicles'] });
            toast.success(`New QR for ${v.vehicle_number} — print it; the old sticker no longer works`);
            setEditVehicle(null);
            void openQrPreview(v);
        },
        onError: (e) => toast.error(e.message || 'Could not make a new QR'),
    });

    const exportJourneys = async () => {
        setExporting(true);
        try {
            const missing = completedJourneys.map((j) => j.id).filter((id) => gpsSummary[id] == null);
            const extra = missing.length ? await getJourneyGpsSummary(missing) : {};
            await downloadJourneysExcel(completedJourneys, { ...gpsSummary, ...extra }, `AKK-Vehicle-Journeys-${filter.from || 'all'}-to-${filter.to || 'now'}.xlsx`);
        } catch (e) {
            toast.error(e.message || 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    const deleteJourneyMutation = useMutation({
        mutationFn: deleteJourney,
        onSuccess: (_data, journeyId) => {
            queryClient.invalidateQueries({ queryKey: ['vehicleJourneys'] });
            queryClient.invalidateQueries({ queryKey: ['activeVehicleJourney'] });
            toast.success('Journey deleted');
            setTrackJourney((t) => (t?.id === journeyId ? null : t));
            setViewJourney((v) => (v?.id === journeyId ? null : v));
            setPendingDeleteJourney(null);
        },
        onError: (e) => toast.error(e.message || 'Failed to delete journey'),
    });

    const openDeleteVehicleDialog = async (vehicle) => {
        try {
            const count = await countVehicleJourneys(vehicle.id);
            setDeleteJourneyCount(count);
            setPendingDeleteVehicle(vehicle);
        } catch {
            toast.error('Could not load vehicle details');
        }
    };

    const openQrPreview = async (vehicle) => {
        try {
            const dataUrl = await QRCode.toDataURL(vehicle.qr_token, { margin: 2, width: 512 });
            setQrPreview({ ...vehicle, dataUrl });
        } catch {
            toast.error('Could not generate QR');
        }
    };

    const downloadQr = async (vehicle) => {
        try {
            const dataUrl = await QRCode.toDataURL(vehicle.qr_token, { margin: 2, width: 512 });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${vehicle.vehicle_number}-qr.png`;
            a.click();
        } catch {
            toast.error('Download failed');
        }
    };

    return (
        <div className="space-y-4">
            {/* Fleet registry */}
            <section className={cn(glassPanel, 'p-5 sm:p-6')}>
                    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-sm ring-1 ring-orange-100/80">
                                    <Car className="h-6 w-6 text-[#dc6b2f]" />
                                </div>
                                <div>
                                <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                                    Vehicles
                                    {vehicles.length > 0 && (
                                        <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                                            {vehicles.length}
                                        </span>
                                    )}
                                </h2>
                                <p className="mt-0.5 max-w-xl text-sm text-slate-500">
                                    Register fleet vehicles, generate QR stickers, and track live journeys.
                                </p>
                                </div>
                            </div>
                        <Button
                            className="h-11 rounded-xl bg-slate-900/90 px-5 shadow-lg shadow-slate-900/15 hover:bg-slate-900"
                            onClick={() => setShowAddDialog(true)}
                        >
                            <Plus className="mr-1.5 h-4 w-4" />
                            Add vehicle
                        </Button>
                    </div>
                    {loadingVehicles ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                        </div>
                    ) : vehicles.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-14 text-center text-sm text-slate-500">
                            No vehicles yet. Add one to generate a driver scan QR.
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {vehicles.map((v) => (
                                        <div key={v.id} className={cn(glassPanel, 'flex flex-col p-4')}>
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="break-words text-base font-semibold leading-snug text-slate-900">{v.vehicle_number}</p>
                                                    <p className="mt-0.5 text-sm text-slate-500">{v.description || 'No description'}</p>
                                                </div>
                                                <Badge variant={v.is_active ? 'default' : 'secondary'}>
                                                    {v.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </div>
                                            <p className="mt-2 break-all font-mono text-xs text-slate-500">{v.qr_token}</p>
                                            <div className="mt-auto flex flex-col gap-2 pt-3">
                                                    <Button type="button" variant="outline" size="sm" className="h-9 w-full rounded-xl border-slate-200 bg-white" onClick={() => openQrPreview(v)}>
                                                        <QrCode className="mr-1.5 h-4 w-4" />
                                                        QR
                                                    </Button>
                                                    <div className="flex gap-2">
                                                    <Button type="button" variant="outline" size="sm" className="h-9 flex-1 rounded-xl border-slate-200 bg-white" onClick={() => setEditVehicle(v)}>
                                                        <Edit2 className="mr-1.5 h-4 w-4" />
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="sm"
                                                        className="h-9 flex-1 rounded-xl"
                                                        title="Delete vehicle"
                                                        onClick={() => openDeleteVehicleDialog(v)}
                                                    >
                                                        <Trash2 className="mr-1.5 h-4 w-4" />
                                                        Delete
                                                    </Button>
                                                    </div>
                                            </div>
                                        </div>
                                    ))}
                        </div>
                    )}
            </section>

            {/* Active journeys */}
            <section className={cn(glassPanel, 'p-4 sm:p-5')}>
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                        <Navigation className="h-5 w-5 text-emerald-600" />
                        Active journeys
                    </h2>
                    {loadingActive ? (
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />
                    ) : activeJourneys.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-500">
                            No vehicles on the road right now.
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {activeJourneys.map((j) => {
                                const loc = journeyLocations[j.id];
                                return (
                                    <div
                                        key={j.id}
                                        className={cn(glassPanel, 'flex flex-col p-4')}
                                    >
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <p className="break-words text-base font-semibold leading-snug text-slate-900">{j.vehicles?.vehicle_number}</p>
                                                <Badge className={j.status === 'on_break' ? 'bg-amber-500' : 'bg-emerald-600'}>
                                                    {j.status === 'on_break' ? 'On break' : 'Driving'}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-sm text-slate-700">
                                                {j.worker_name} · {j.worker_id}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                Started {new Date(j.started_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}
                                            </p>
                                            {loc && (
                                                <p className="mt-1 flex items-center gap-1 font-mono text-xs text-slate-600">
                                                    <MapPin className="h-3 w-3" />
                                                    {Number(loc.latitude).toFixed(5)}, {Number(loc.longitude).toFixed(5)}
                                                </p>
                                            )}
                                            {(() => {
                                                const m = minsAgo(loc?.recorded_at);
                                                const stale = j.status !== 'on_break' && (m == null || m > 10);
                                                const hours = (Date.now() - new Date(j.started_at).getTime()) / 3600000;
                                                return (
                                                    <>
                                                        <p className={cn('mt-1 text-xs', stale ? 'font-semibold text-amber-700' : 'text-slate-500')}>
                                                            Last GPS update: {agoText(m)}
                                                        </p>
                                                        {stale ? (
                                                            <p className="mt-1 flex items-start gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                                                GPS not updating — the driver may be using the app or has closed the website.
                                                            </p>
                                                        ) : null}
                                                        {hours >= 12 ? (
                                                            <p className="mt-1 text-xs font-semibold text-red-700">Running for {Math.floor(hours)} h — the driver may have forgotten to finish.</p>
                                                        ) : null}
                                                    </>
                                                );
                                            })()}
                                        <div className="mt-auto flex flex-col gap-2 pt-3">
                                            <Button
                                                className="h-9 rounded-xl bg-slate-800 hover:bg-slate-900"
                                                onClick={() => setTrackJourney(j)}
                                            >
                                                <Navigation className="mr-1.5 h-4 w-4" />
                                                Track
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl border-slate-200 bg-white" onClick={() => setPendingEndJourney(j)}>
                                                <Flag className="mr-1.5 h-4 w-4" />
                                                End journey
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="sm"
                                                className="h-9 rounded-xl"
                                                onClick={() => setPendingDeleteJourney(j)}
                                            >
                                                <Trash2 className="mr-1.5 h-4 w-4" />
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
            </section>

            {/* Completed */}
            <section className={cn(glassPanel, 'p-4 sm:p-5')}>
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Completed journeys</h2>
                            <p className="text-sm text-slate-500">
                                {completedJourneys.length} journey{completedJourneys.length === 1 ? '' : 's'} · {totals.km.toFixed(1)} km · {formatDuration(totals.s)}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                            <label className="text-xs font-medium text-slate-600">
                                From
                                <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                            </label>
                            <label className="text-xs font-medium text-slate-600">
                                To
                                <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" />
                            </label>
                            <label className="text-xs font-medium text-slate-600">
                                Vehicle
                                <select value={filter.vehicleId} onChange={(e) => setFilter((f) => ({ ...f, vehicleId: e.target.value }))} className="mt-1 block h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                                    <option value="">All vehicles</option>
                                    {vehicles.map((v) => (
                                        <option key={v.id} value={v.id}>
                                            {v.vehicle_number}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <Button type="button" variant="outline" className="h-9 rounded-lg border-slate-200 bg-white" onClick={exportJourneys} disabled={exporting || !completedJourneys.length}>
                                {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}
                                Export Excel
                            </Button>
                        </div>
                    </div>
                    {loadingCompleted ? (
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />
                    ) : completedJourneys.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-500">
                            No completed journeys yet.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90">
                            <table className="w-full min-w-[640px] text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                                        <th className="px-4 py-3">Date</th>
                                        <th className="px-4 py-3">Vehicle</th>
                                        <th className="px-4 py-3">Driver</th>
                                        <th className="px-4 py-3">Distance</th>
                                        <th className="px-4 py-3">Duration</th>
                                        <th className="px-4 py-3">GPS</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {completedJourneys.map((j) => (
                                        <tr key={j.id} className="hover:bg-slate-50/80">
                                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                                                {new Date(j.started_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-slate-900">{j.vehicles?.vehicle_number}</td>
                                            <td className="px-4 py-3 text-slate-700">{j.worker_name}</td>
                                            <td className="px-4 py-3 tabular-nums text-slate-800">{Number(j.total_distance_km || 0).toFixed(2)} km</td>
                                            <td className="px-4 py-3 text-slate-700">{formatDuration(j.duration_seconds)}</td>
                                            <td className="px-4 py-3 text-xs">
                                                {gpsSummary[j.id] == null ? (
                                                    <span className="text-slate-400">…</span>
                                                ) : lowGps(j) ? (
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800" title="Very few GPS points for this long a journey — tracking was not running most of the time, so distance is under-counted.">
                                                        Low · {gpsSummary[j.id].points} pts
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500">{gpsSummary[j.id].points} pts</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-1.5">
                                                    <Button variant="outline" size="sm" className="h-8 rounded-lg border-slate-200" onClick={() => setViewJourney(j)}>
                                                        <Eye className="mr-1 h-4 w-4" />
                                                        View
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                                                        onClick={() => setPendingDeleteJourney(j)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
            </section>

            {/* Add dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className={glassDialog}>
                    <DialogHeader>
                        <DialogTitle>Add vehicle</DialogTitle>
                        <DialogDescription>Vehicle number is printed on the QR sticker for drivers.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input
                            placeholder="e.g. SGA1234A"
                            value={form.vehicle_number}
                            onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
                            className={glassInput}
                        />
                        <Input
                            placeholder="Description (optional)"
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className={glassInput}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="h-10 rounded-xl" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                        <Button
                            className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                            disabled={!form.vehicle_number.trim() || createMutation.isPending}
                            onClick={() => createMutation.mutate(form)}
                        >
                            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit dialog */}
            <Dialog open={!!editVehicle} onOpenChange={(o) => !o && setEditVehicle(null)}>
                <DialogContent className={glassDialog}>
                    <DialogHeader>
                        <DialogTitle>Edit {editVehicle?.vehicle_number}</DialogTitle>
                    </DialogHeader>
                    {editVehicle && (
                        <div className="space-y-3">
                            <Input
                                defaultValue={editVehicle.description || ''}
                                placeholder="Description"
                                id="edit-vehicle-desc"
                                className={glassInput}
                            />
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                <input type="checkbox" id="edit-vehicle-active" defaultChecked={editVehicle.is_active !== false} className="h-4 w-4" />
                                Active — drivers can scan this vehicle
                            </label>
                            <div className="rounded-xl border border-slate-200 bg-white/70 p-3 text-sm">
                                <p className="font-medium text-slate-800">QR sticker lost or copied?</p>
                                <p className="text-xs text-slate-500">Make a new QR. The old sticker stops working immediately.</p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-2 h-9 rounded-lg"
                                    disabled={regenerateMutation.isPending}
                                    onClick={() => regenerateMutation.mutate(editVehicle)}
                                >
                                    {regenerateMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                                    Make a new QR
                                </Button>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                            onClick={() => {
                                const desc = document.getElementById('edit-vehicle-desc')?.value;
                                const active = document.getElementById('edit-vehicle-active')?.checked;
                                updateMutation.mutate({ id: editVehicle.id, patch: { description: desc, is_active: active !== false } });
                            }}
                        >
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete vehicle */}
            <Dialog
                open={!!pendingDeleteVehicle}
                onOpenChange={(o) => {
                    if (!o) setPendingDeleteVehicle(null);
                }}
            >
                <DialogContent className={cn(glassDialog, 'max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>Delete {pendingDeleteVehicle?.vehicle_number}?</DialogTitle>
                        <DialogDescription>
                            This permanently removes the vehicle and its QR code.
                            {deleteJourneyCount > 0 ? (
                                <> It will also delete {deleteJourneyCount} journey record{deleteJourneyCount !== 1 ? 's' : ''} (routes, breaks, and GPS history).</>
                            ) : (
                                <> No journey history is linked to this vehicle.</>
                            )}
                            {' '}This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setPendingDeleteVehicle(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => pendingDeleteVehicle && deleteMutation.mutate(pendingDeleteVehicle.id)}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Delete vehicle'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* End journey (admin) */}
            <Dialog open={!!pendingEndJourney} onOpenChange={(o) => !o && setPendingEndJourney(null)}>
                <DialogContent className={cn(glassDialog, 'max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>End this journey?</DialogTitle>
                        <DialogDescription>
                            <strong>{pendingEndJourney?.vehicles?.vehicle_number}</strong> · {pendingEndJourney?.worker_name}. It is finished now at the last
                            GPS position, and distance / time are worked out from the route recorded so far. The driver&apos;s card clears on their next refresh.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setPendingEndJourney(null)}>
                            Cancel
                        </Button>
                        <Button disabled={endJourneyMutation.isPending} onClick={() => pendingEndJourney && endJourneyMutation.mutate(pendingEndJourney)}>
                            {endJourneyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'End journey'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete journey */}
            <Dialog
                open={!!pendingDeleteJourney}
                onOpenChange={(o) => {
                    if (!o) setPendingDeleteJourney(null);
                }}
            >
                <DialogContent className={cn(glassDialog, 'max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>Delete journey?</DialogTitle>
                        <DialogDescription>
                            {pendingDeleteJourney?.status === 'completed' ? (
                                <>
                                    Remove the completed journey for{' '}
                                    <strong>{pendingDeleteJourney?.vehicles?.vehicle_number}</strong>
                                    {' '}({pendingDeleteJourney?.worker_name}) — including route, breaks, and GPS history.
                                </>
                            ) : (
                                <>
                                    <strong className="text-red-700">This journey is still active.</strong>
                                    {' '}Deleting it removes the route from admin tracking. The driver card
                                    clears on their next refresh (within ~20s) and GPS uploads stop automatically.
                                    {' '}
                                    Vehicle: <strong>{pendingDeleteJourney?.vehicles?.vehicle_number}</strong>
                                    {' '}· Driver: <strong>{pendingDeleteJourney?.worker_name}</strong>
                                </>
                            )}
                            {' '}This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setPendingDeleteJourney(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={deleteJourneyMutation.isPending}
                            onClick={() =>
                                pendingDeleteJourney && deleteJourneyMutation.mutate(pendingDeleteJourney.id)
                            }
                        >
                            {deleteJourneyMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Delete journey'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* QR preview */}
            <Dialog open={!!qrPreview} onOpenChange={(o) => !o && setQrPreview(null)}>
                <DialogContent className={cn(glassDialog, 'max-w-md')}>
                    <DialogHeader>
                        <DialogTitle>{qrPreview?.vehicle_number}</DialogTitle>
                        <DialogDescription>Stick this QR inside the vehicle for driver scans.</DialogDescription>
                    </DialogHeader>
                    {qrPreview?.dataUrl && (
                        <img src={qrPreview.dataUrl} alt="Vehicle QR" className="mx-auto h-56 w-56" />
                    )}
                    <Button className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900" onClick={() => downloadQr(qrPreview)}>Download PNG</Button>
                </DialogContent>
            </Dialog>

            {/* Live track */}
            <Dialog open={!!trackJourney} onOpenChange={(o) => !o && setTrackJourney(null)}>
                <DialogContent className={cn(glassDialog, 'max-w-4xl')}>
                    <DialogHeader>
                        <DialogTitle>
                            Live track — {trackJourney?.vehicles?.vehicle_number}
                        </DialogTitle>
                        <DialogDescription>
                            {trackJourney?.worker_name} · updates every few seconds
                        </DialogDescription>
                    </DialogHeader>
                    {trackJourney && (
                        <Suspense
                            fallback={
                                <div className="flex h-[420px] items-center justify-center gap-2 text-slate-500">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    Loading map…
                                </div>
                            }
                        >
                            <VehicleLiveMap
                                journeyId={trackJourney.id}
                                mode="live"
                                height="420px"
                                followLatest
                                showBreaks
                            />
                        </Suspense>
                    )}
                </DialogContent>
            </Dialog>

            {viewJourney && (
                <Suspense fallback={null}>
                    <VehicleJourneyDetail
                        journey={viewJourney}
                        open={!!viewJourney}
                        onOpenChange={(o) => !o && setViewJourney(null)}
                    />
                </Suspense>
            )}
        </div>
    );
}
