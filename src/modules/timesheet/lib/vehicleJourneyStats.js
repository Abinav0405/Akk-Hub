import { calculateDistance } from '@/modules/timesheet/lib/timeUtils';

const MAX_REASONABLE_SPEED_KMH = 150;
const MIN_MOVING_SPEED_KMH = 2;
const MIN_SEGMENT_METERS = 5;

/** Sum Haversine distance between consecutive points (km). */
export function computeRouteDistanceKm(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;

    let totalMeters = 0;
    for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const lat1 = Number(prev.latitude);
        const lng1 = Number(prev.longitude);
        const lat2 = Number(curr.latitude);
        const lng2 = Number(curr.longitude);
        if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) continue;

        const segmentM = calculateDistance(lat1, lng1, lat2, lng2);
        if (segmentM < MIN_SEGMENT_METERS) continue;

        const dtSec =
            (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
        if (dtSec <= 0) continue;

        const speedKmh = (segmentM / 1000) / (dtSec / 3600);
        if (speedKmh < MIN_MOVING_SPEED_KMH) continue;

        totalMeters += segmentM;
    }

    return Math.round((totalMeters / 1000) * 1000) / 1000;
}

/** Max segment speed from consecutive points (km/h), capped. */
export function computeTopSpeedKmh(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;

    let top = 0;
    for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const lat1 = Number(prev.latitude);
        const lng1 = Number(prev.longitude);
        const lat2 = Number(curr.latitude);
        const lng2 = Number(curr.longitude);
        if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) continue;

        const segmentM = calculateDistance(lat1, lng1, lat2, lng2);
        const dtSec =
            (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
        if (dtSec <= 0 || segmentM < MIN_SEGMENT_METERS) continue;

        const speedKmh = Math.min(MAX_REASONABLE_SPEED_KMH, (segmentM / 1000) / (dtSec / 3600));
        if (speedKmh > top) top = speedKmh;
    }

    return Math.round(top * 10) / 10;
}

/**
 * Total break duration in seconds from break rows.
 * Open breaks (no break_end) count through openBreakEndAt when provided (journey end).
 */
export function computeTotalBreakSeconds(breaks, openBreakEndAt = null) {
    if (!Array.isArray(breaks)) return 0;
    return breaks.reduce((sum, b) => {
        if (b.break_start && b.break_end) {
            if (b.duration_seconds != null) return sum + Number(b.duration_seconds);
            return sum + Math.max(0, Math.floor((new Date(b.break_end) - new Date(b.break_start)) / 1000));
        }
        if (b.break_start && !b.break_end && openBreakEndAt) {
            return sum + Math.max(
                0,
                Math.floor((new Date(openBreakEndAt) - new Date(b.break_start)) / 1000)
            );
        }
        return sum;
    }, 0);
}

/** Moving time = wall clock minus breaks. */
export function computeMovingSeconds(startedAt, endedAt, breaks = []) {
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(endedAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    const wall = Math.floor((endMs - startMs) / 1000);
    return Math.max(0, wall - computeTotalBreakSeconds(breaks, endedAt));
}

export function computeAvgSpeedKmh(distanceKm, movingSeconds) {
    if (!movingSeconds || !distanceKm) return 0;
    const hours = movingSeconds / 3600;
    if (hours <= 0) return 0;
    return Math.round((distanceKm / hours) * 10) / 10;
}

/** Full stats bundle for journey completion. */
export function computeJourneyStats({ points, startedAt, endedAt, breaks = [] }) {
    const totalDistanceKm = computeRouteDistanceKm(points);
    const topSpeedKmh = computeTopSpeedKmh(points);
    const durationSeconds = computeMovingSeconds(startedAt, endedAt, breaks);
    const avgSpeedKmh = computeAvgSpeedKmh(totalDistanceKm, durationSeconds);

    return {
        total_distance_km: totalDistanceKm,
        top_speed_kmh: topSpeedKmh,
        duration_seconds: durationSeconds,
        avg_speed_kmh: avgSpeedKmh,
    };
}

export function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}
