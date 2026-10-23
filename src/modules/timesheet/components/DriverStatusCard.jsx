import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Car, MapPin, Coffee, Gauge, Route, Timer, LogOut, Play, Loader2, Globe, AlertTriangle, CloudUpload } from 'lucide-react';
import { getVehicleTrackingHealth } from '@/modules/timesheet/lib/vehicleTracking';
import { getDrivingSiteUrl, isNativeAppVehicleTrackingDisabled, openDrivingSite } from '@/modules/timesheet/lib/vehicleTrackingNotification';
import { getJourneyBreaks, getJourneyPoints } from '@/modules/timesheet/lib/vehicleService';
import { computeRouteDistanceKm, formatDuration } from '@/modules/timesheet/lib/vehicleJourneyStats';

const VehicleLiveMap = lazy(() => import('@/modules/timesheet/components/VehicleLiveMap'));

const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
};

/** Website drivers: is GPS answering, and are points reaching the office? */
function useTrackingHealth(enabled) {
    const [h, setH] = useState(() => getVehicleTrackingHealth());
    useEffect(() => {
        if (!enabled) return undefined;
        const tick = () => setH(getVehicleTrackingHealth());
        tick();
        const id = window.setInterval(tick, 5000);
        return () => window.clearInterval(id);
    }, [enabled]);
    return h;
}

function JourneyTimer({ startedAt, isOnBreak, breakStartedAt }) {
    const [elapsed, setElapsed] = useState(0);
    const [breakElapsed, setBreakElapsed] = useState(0);

    useEffect(() => {
        const compute = () => {
            const nowMs = Date.now();
            const startMs = new Date(startedAt).getTime();
            setElapsed(Math.max(0, Math.floor((nowMs - startMs) / 1000)));
            if (isOnBreak && breakStartedAt) {
                setBreakElapsed(
                    Math.max(0, Math.floor((nowMs - new Date(breakStartedAt).getTime()) / 1000))
                );
            } else {
                setBreakElapsed(0);
            }
        };
        compute();
        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            compute();
        };
        const id = window.setInterval(tick, 1000);
        const onVisibility = () => {
            if (!document.hidden) compute();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [startedAt, isOnBreak, breakStartedAt]);

    return (
        <div className="space-y-1">
            <p className="font-mono text-2xl font-bold tabular-nums tracking-tight text-white sm:text-3xl">
                {formatDuration(elapsed)}
            </p>
            {isOnBreak && (
                <p className="text-xs text-amber-200">
                    Break {formatDuration(breakElapsed)}
                </p>
            )}
        </div>
    );
}

export default function DriverStatusCard({
    journey,
    onExpand,
    expanded = false,
    onFinish,
    onBreak,
    onResume,
    actionBusy = false,
}) {
    const [distanceKm, setDistanceKm] = useState(null);
    const [openBreak, setOpenBreak] = useState(null);
    const routeRef = useRef({ journeyId: null, points: [] });
    const vehicleNumber = journey?.vehicles?.vehicle_number || 'Vehicle';
    const isOnBreak = journey?.status === 'on_break';

    useEffect(() => {
        if (!journey?.id || isOnBreak) return;
        let cancelled = false;
        // Keep the points already fetched and only ask for newer ones each tick, instead of
        // re-downloading the whole route every 8s (and hitting the 1000-row page limit).
        if (routeRef.current.journeyId !== journey.id) {
            routeRef.current = { journeyId: journey.id, points: [] };
        }
        const refresh = async () => {
            try {
                const route = routeRef.current;
                const last = route.points.length ? route.points[route.points.length - 1].recorded_at : null;
                const fresh = await getJourneyPoints(journey.id, { after: last });
                if (cancelled || routeRef.current !== route) return;
                if (fresh.length) route.points.push(...fresh);
                setDistanceKm(computeRouteDistanceKm(route.points));
            } catch {
                /* ignore */
            }
        };
        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void refresh();
        };
        refresh();
        const id = window.setInterval(tick, 8000);
        const onVisibility = () => {
            if (!document.hidden) void refresh();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [journey?.id, isOnBreak]);

    useEffect(() => {
        if (!journey?.id) return;
        let cancelled = false;
        getJourneyBreaks(journey.id).then((breaks) => {
            if (cancelled) return;
            const ongoing = breaks?.find((b) => !b.break_end);
            setOpenBreak(ongoing || null);
        });
        return () => { cancelled = true; };
    }, [journey?.id, journey?.status]);

    if (!journey) return null;

    const isWebDriver = Capacitor.getPlatform() === 'web';
    // GPS is recorded on this device: the website, or the phone app with background GPS.
    const liveGps = isWebDriver || !isNativeAppVehicleTrackingDisabled();
    const health = useTrackingHealth(liveGps && !isOnBreak);
    const hoursOn = (Date.now() - new Date(journey.started_at).getTime()) / 3600000;
    const siteUrl = getDrivingSiteUrl();
    const gpsStale = liveGps && !isOnBreak && (!health.lastFixAt || Date.now() - health.lastFixAt > 60000);

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border border-slate-800/20 shadow-sm"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-[#dc6b2f]/40" />
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#dc6b2f]/20 blur-2xl" />
            <button
                type="button"
                onClick={onExpand}
                className="relative w-full p-5 text-left sm:p-6"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                            {!isOnBreak && (
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            )}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isOnBreak ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                        </span>
                        <Badge className={`border-0 ${isOnBreak ? 'bg-amber-500/90' : 'bg-emerald-500/90'} text-white`}>
                            {isOnBreak ? 'ON BREAK' : 'EN ROUTE'}
                        </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-sm font-semibold text-white backdrop-blur">
                        <Car className="h-4 w-4 text-orange-200" />
                        {vehicleNumber}
                    </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-orange-100/80">Journey time</p>
                        <JourneyTimer
                            startedAt={journey.started_at}
                            isOnBreak={isOnBreak}
                            breakStartedAt={openBreak?.break_start}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-white/90">
                        <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                            <Route className="mb-1 h-4 w-4 text-orange-200" />
                            <p className="text-lg font-bold tabular-nums">
                                {distanceKm != null ? `${distanceKm.toFixed(1)} km` : '—'}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-orange-100/70">Distance</p>
                        </div>
                        <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                            <MapPin className="mb-1 h-4 w-4 text-orange-200" />
                            <p className="text-xs font-medium">Live GPS</p>
                            <p className="text-[10px] text-orange-100/70">Updates every few sec</p>
                        </div>
                    </div>
                </div>

                <p className="mt-4 text-center text-xs text-orange-100/80">
                    Tap the card for map &amp; details
                </p>
                {liveGps && !isOnBreak ? (
                    <div
                        className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-snug ${gpsStale ? 'bg-amber-400/20 text-amber-100' : 'bg-white/10 text-emerald-100'}`}
                        role="status"
                    >
                        {gpsStale ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CloudUpload className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span>
                            {gpsStale
                                ? isWebDriver
                                    ? 'Waiting for GPS — keep this page open with the screen on (GPS pauses when the browser is in the background).'
                                    : 'Waiting for GPS — check Location is on. Tracking keeps running with the screen off.'
                                : health.lastSentAt
                                    ? `GPS sent ${ago(health.lastSentAt)}`
                                    : 'GPS on — first update going out'}
                            {health.queued > 0 ? ` · ${health.queued} point${health.queued === 1 ? '' : 's'} waiting for signal` : ''}
                        </span>
                    </div>
                ) : null}
                {!liveGps ? (
                    <p className="mt-2 text-center text-[11px] leading-relaxed text-amber-100/90">
                        This app version can’t record GPS — update AKK Hub, or tap “Open website” below and keep it open while driving.
                    </p>
                ) : !isWebDriver ? (
                    <p className="mt-2 text-center text-[11px] leading-relaxed text-orange-100/80">
                        GPS keeps recording with the screen off — you’ll see a “driving” notification until you finish.
                    </p>
                ) : null}
                {hoursOn >= 10 ? (
                    <p className="mt-2 rounded-xl bg-amber-400/20 px-3 py-2 text-center text-[12px] font-medium text-amber-100">
                        Driving for over {Math.floor(hoursOn)} hours — tap Finish ride once the vehicle is parked for the day.
                    </p>
                ) : null}
            </button>

            {!liveGps && siteUrl ? (
                <div className="relative px-5 pb-2 sm:px-6">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full rounded-xl border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white"
                        onClick={() => openDrivingSite()}
                    >
                        <Globe className="mr-2 h-4 w-4" />
                        Open website for live GPS
                    </Button>
                </div>
            ) : null}
            <div className="relative grid grid-cols-2 gap-2 px-5 pb-5 sm:px-6">
                {isOnBreak ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white"
                        disabled={actionBusy}
                        onClick={onResume}
                    >
                        <Play className="mr-2 h-4 w-4" />
                        Resume
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white"
                        disabled={actionBusy}
                        onClick={onBreak}
                    >
                        <Coffee className="mr-2 h-4 w-4" />
                        Break
                    </Button>
                )}
                <Button
                    type="button"
                    className="h-11 rounded-xl bg-white text-slate-900 hover:bg-slate-100"
                    disabled={actionBusy}
                    onClick={onFinish}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Finish ride
                </Button>
            </div>

            {expanded && (
                <div className="relative border-t border-white/10 bg-slate-900/80 p-4">
                    <Suspense
                        fallback={
                            <div className="flex h-[200px] items-center justify-center gap-2 text-slate-400">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Loading map…
                            </div>
                        }
                    >
                        <VehicleLiveMap journeyId={journey.id} mode="mini" height="200px" followLatest />
                    </Suspense>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
                        <span className="inline-flex items-center gap-1">
                            <Timer className="h-3.5 w-3.5" />
                            Started {new Date(journey.started_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}
                        </span>
                        {isOnBreak && (
                            <span className="inline-flex items-center gap-1 text-amber-200">
                                <Coffee className="h-3.5 w-3.5" />
                                On break — tap Resume when ready
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                            <Gauge className="h-3.5 w-3.5" />
                            {isOnBreak
                                ? 'GPS paused on break'
                                : liveGps
                                    ? 'GPS tracking active'
                                    : 'Use website for live GPS'}
                        </span>
                    </div>
                </div>
            )}
        </motion.div>
    );
}
