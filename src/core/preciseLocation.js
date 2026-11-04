import { Geolocation } from '@capacitor/geolocation';

/**
 * Best-of GPS fix: run a short high-accuracy watch (no cached positions) and keep
 * the fix with the smallest accuracy radius, instead of trusting the first —
 * usually coarse, network-based — fix. Used wherever coordinates get stamped.
 * Web uses navigator.geolocation under the hood; Android/iOS use the native plugin.
 */

const WATCH_OPTIONS = {
    enableHighAccuracy: true,
    maximumAge: 0,
    // Android: ask for ~1 s updates (the plugin default is one update per 5 s).
    interval: 1000,
    minimumUpdateInterval: 500,
};

function toFix(pos) {
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const accuracy = Number(pos.coords.accuracy);
    return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
        at: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
    };
}

function radius(fix) {
    return fix?.accuracy == null ? Infinity : fix.accuracy;
}

export function distanceMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Should `next` replace `prev`? Yes when it is at least as precise, when `prev`
 * is stale, or when the user has clearly moved (outside both accuracy circles).
 */
export function isBetterFix(prev, next, { staleMs = 15000 } = {}) {
    if (!next) return false;
    if (!prev) return true;
    if (radius(next) <= radius(prev)) return true;
    if (next.at - prev.at > staleMs) return true;
    return distanceMeters(prev, next) > radius(prev) + radius(next);
}

/**
 * Watch high-accuracy GPS for `windowMs` (from the first fix) and resolve with the
 * most precise fix seen; resolves early once a fix is within `targetAccuracyM`.
 * Rejects only when no fix arrives at all before `timeoutMs`.
 * `onFix` sees every improving fix so a UI can show progress meanwhile.
 */
export function getPreciseFix({
    windowMs = 6000,
    targetAccuracyM = 5,
    timeoutMs = 20000,
    onFix,
    signal,
} = {}) {
    return new Promise((resolve, reject) => {
        let best = null;
        let watchId = null;
        let settled = false;
        let windowTimer = null;
        const deadline = setTimeout(() => finish(), timeoutMs);

        function cleanup() {
            clearTimeout(deadline);
            if (windowTimer) clearTimeout(windowTimer);
            signal?.removeEventListener?.('abort', onAbort);
            if (watchId != null) {
                Geolocation.clearWatch({ id: watchId }).catch(() => {});
                watchId = null;
            }
        }

        function finish(err) {
            if (settled) return;
            settled = true;
            cleanup();
            if (best) resolve(best);
            else reject(err || new Error('GPS coordinates unavailable'));
        }

        function onAbort() {
            finish(new Error('aborted'));
        }

        if (signal?.aborted) {
            finish(new Error('aborted'));
            return;
        }
        signal?.addEventListener?.('abort', onAbort);

        Geolocation.watchPosition({ ...WATCH_OPTIONS, timeout: timeoutMs }, (pos, err) => {
            if (settled) return;
            if (err) {
                // Permission denied is final; transient timeouts keep the watch going.
                if (err.code === 1 || /denied|permission/i.test(String(err.message || ''))) finish(err);
                return;
            }
            const fix = toFix(pos);
            if (!fix) return;
            if (!best || radius(fix) <= radius(best)) {
                best = fix;
                onFix?.(fix);
            }
            if (!windowTimer) windowTimer = setTimeout(() => finish(), windowMs);
            if (radius(best) <= targetAccuracyM) finish();
        })
            .then((id) => {
                if (settled) Geolocation.clearWatch({ id }).catch(() => {});
                else watchId = id;
            })
            .catch((e) => finish(e));
    });
}
