import React, { useEffect, useState, lazy, Suspense } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { Badge } from '@/ui/badge';
import { Loader2, Gauge, Route, Timer, Zap, Coffee } from 'lucide-react';
import { getJourneyBreaks, getJourneyPoints } from '@/modules/timesheet/lib/vehicleService';
import { formatDuration } from '@/modules/timesheet/lib/vehicleJourneyStats';

const VehicleLiveMap = lazy(() => import('@/modules/timesheet/components/VehicleLiveMap'));

export default function VehicleJourneyDetail({ journey, open, onOpenChange }) {
    const [breaks, setBreaks] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || !journey?.id) return;
        let cancelled = false;
        setLoading(true);
        getJourneyBreaks(journey.id)
            .then((data) => {
                if (!cancelled) setBreaks(data || []);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [open, journey?.id]);

    if (!journey) return null;

    const vehicleNumber = journey.vehicles?.vehicle_number || '—';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                        Journey — {vehicleNumber}
                        <Badge variant="secondary">{journey.worker_name}</Badge>
                    </DialogTitle>
                    <DialogDescription>
                        {journey.started_at && new Date(journey.started_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}
                        {journey.ended_at && (
                            <> → {new Date(journey.ended_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <Suspense
                    fallback={
                        <div className="flex h-[280px] items-center justify-center gap-2 text-slate-400">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Loading map…
                        </div>
                    }
                >
                    <VehicleLiveMap
                        journeyId={journey.id}
                        mode="replay"
                        height="280px"
                        showBreaks
                    />
                </Suspense>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard icon={Route} label="Distance" value={`${Number(journey.total_distance_km || 0).toFixed(2)} km`} />
                    <StatCard icon={Timer} label="Time travelled" value={formatDuration(journey.duration_seconds)} />
                    <StatCard icon={Gauge} label="Avg speed" value={`${Number(journey.avg_speed_kmh || 0).toFixed(1)} km/h`} />
                    <StatCard icon={Zap} label="Top speed" value={`${Number(journey.top_speed_kmh || 0).toFixed(1)} km/h`} />
                </div>

                {loading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                ) : breaks.length > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <Coffee className="h-4 w-4 text-sky-600" />
                            Breaks ({breaks.length})
                        </h4>
                        <ul className="space-y-2 text-sm">
                            {breaks.map((b, i) => (
                                <li key={b.id} className="flex flex-col gap-1 rounded-lg bg-white p-3 ring-1 ring-slate-200/80 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="font-medium text-slate-700">Break {i + 1}</span>
                                    <span className="text-slate-600">
                                        {new Date(b.break_start).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })}
                                        {b.break_end && (
                                            <> – {new Date(b.break_end).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })}</>
                                        )}
                                        {b.duration_seconds != null && (
                                            <span className="ml-2 text-slate-500">({formatDuration(b.duration_seconds)})</span>
                                        )}
                                    </span>
                                    {b.latitude != null && (
                                        <span className="font-mono text-xs text-slate-500">
                                            {Number(b.latitude).toFixed(5)}, {Number(b.longitude).toFixed(5)}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function StatCard({ icon: Icon, label, value }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <Icon className="mb-1 h-4 w-4 text-[#dc6b2f]" />
            <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
        </div>
    );
}

export async function prefetchJourneyPoints(journeyId) {
    return getJourneyPoints(journeyId);
}
