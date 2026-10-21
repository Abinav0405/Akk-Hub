import React, { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { supabaseTimesheet, DB_SCHEMA } from '@/core/supabase'
import { getJourneyPoints, getJourneyBreaks } from '@/modules/timesheet/lib/vehicleService';
import { Loader2 } from 'lucide-react';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

const vehicleIcon = new L.DivIcon({
    className: 'vehicle-map-marker',
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#dc6b2f;border:2px solid white;box-shadow:0 0 8px rgba(220,107,47,0.8)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
});

function fitMapToPoints(map, points) {
    if (!points?.length) return;
    const latLngs = points.map((p) => [Number(p.latitude), Number(p.longitude)]);
    if (latLngs.length === 1) {
        map.setView(latLngs[0], 15);
    } else {
        map.fitBounds(latLngs, { padding: [40, 40] });
    }
}

/** Re-fit whenever the point set changes (replay / non-follow live). */
function FitBounds({ points }) {
    const map = useMap();
    useEffect(() => {
        fitMapToPoints(map, points);
    }, [map, points]);
    return null;
}

/** Fit once when the first points arrive, then leave the camera to FollowLatest. */
function FitBoundsOnce({ points }) {
    const map = useMap();
    const fittedRef = useRef(false);
    useEffect(() => {
        if (fittedRef.current || !points?.length) return;
        fitMapToPoints(map, points);
        fittedRef.current = true;
    }, [map, points]);
    return null;
}

/** Maps rendered inside animated dialogs start with a zero-size container and show grey tiles. */
function InvalidateSizeOnMount() {
    const map = useMap();
    useEffect(() => {
        const timers = [60, 300, 800].map((ms) => window.setTimeout(() => map.invalidateSize(), ms));
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [map]);
    return null;
}

function FollowLatest({ latest }) {
    const map = useMap();
    useEffect(() => {
        if (!latest) return;
        map.panTo([Number(latest.latitude), Number(latest.longitude)], { animate: true });
    }, [map, latest?.latitude, latest?.longitude, latest?.recorded_at]);
    return null;
}

export default function VehicleLiveMap({
    journeyId,
    mode = 'live',
    height = '320px',
    followLatest = false,
    showBreaks = true,
    initialPoints = null,
    initialBreaks = null,
}) {
    const [points, setPoints] = useState(initialPoints || []);
    const [breaks, setBreaks] = useState(initialBreaks || []);
    const [loading, setLoading] = useState(!initialPoints);
    const pointsRef = useRef(points);
    pointsRef.current = points;
    // Driver mini-map and admin live track both need continuous updates.
    const isLiveUpdating = mode === 'live' || mode === 'mini';

    useEffect(() => {
        if (!journeyId) return;
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const [pts, brks] = await Promise.all([
                    initialPoints ? Promise.resolve(initialPoints) : getJourneyPoints(journeyId),
                    initialBreaks ? Promise.resolve(initialBreaks) : (showBreaks ? getJourneyBreaks(journeyId) : []),
                ]);
                if (!cancelled) {
                    setPoints(pts || []);
                    setBreaks(brks || []);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => { cancelled = true; };
    }, [journeyId, initialPoints, initialBreaks, showBreaks]);

    useEffect(() => {
        if (!isLiveUpdating || !journeyId) return;

        const channel = supabaseTimesheet
            .channel(`vehicle-map-${mode}-${journeyId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: DB_SCHEMA.timesheet,
                    table: 'vehicle_location_points',
                    filter: `journey_id=eq.${journeyId}`,
                },
                (payload) => {
                    const row = payload.new;
                    if (!row) return;
                    setPoints((prev) => {
                        if (prev.some((p) => p.id && row.id && p.id === row.id)) return prev;
                        return [...prev, row];
                    });
                }
            )
            .subscribe();

        // Fallback to realtime: fetch only points newer than the last one we have (a full
        // refetch every 5s is heavy on long rides and was capped at 1000 rows).
        const pollId = window.setInterval(async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const current = pointsRef.current;
                const lastRecorded = current.length ? current[current.length - 1].recorded_at : null;
                const fresh = await getJourneyPoints(journeyId, { after: lastRecorded });
                if (fresh.length) {
                    setPoints((prev) => {
                        const seen = new Set(prev.map((p) => p.id));
                        const add = fresh.filter((p) => !seen.has(p.id));
                        return add.length ? [...prev, ...add] : prev;
                    });
                }
                if (showBreaks) {
                    const brks = await getJourneyBreaks(journeyId);
                    setBreaks(brks || []);
                }
            } catch {
                /* ignore poll errors */
            }
        }, 5000);

        return () => {
            window.clearInterval(pollId);
            supabaseTimesheet.removeChannel(channel);
        };
    }, [journeyId, mode, isLiveUpdating, showBreaks]);

    const polyline = useMemo(
        () => points.map((p) => [Number(p.latitude), Number(p.longitude)]),
        [points]
    );

    const latest = points.length ? points[points.length - 1] : null;
    const center = latest
        ? [Number(latest.latitude), Number(latest.longitude)]
        : [1.3521, 103.8198];

    if (loading && !points.length) {
        return (
            <div
                className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50"
                style={{ height }}
            >
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 ring-1 ring-slate-900/5" style={{ height }}>
            <MapContainer
                center={center}
                zoom={14}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={mode !== 'mini'}
                zoomControl={mode !== 'mini'}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <InvalidateSizeOnMount />
                {polyline.length > 1 && (
                    <Polyline positions={polyline} pathOptions={{ color: '#dc6b2f', weight: 4, opacity: 0.85 }} />
                )}
                {latest && (
                    <Marker
                        position={[Number(latest.latitude), Number(latest.longitude)]}
                        icon={vehicleIcon}
                    />
                )}
                {showBreaks && breaks.map((b) => (
                    b.latitude != null && b.longitude != null ? (
                        <CircleMarker
                            key={b.id}
                            center={[Number(b.latitude), Number(b.longitude)]}
                            radius={7}
                            pathOptions={{ color: '#0ea5e9', fillColor: '#38bdf8', fillOpacity: 0.9 }}
                        />
                    ) : null
                ))}
                {followLatest ? (
                    <>
                        <FitBoundsOnce points={points} />
                        <FollowLatest latest={latest} />
                    </>
                ) : (
                    <FitBounds points={points} />
                )}
            </MapContainer>
        </div>
    );
}
