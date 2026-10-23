import { Capacitor, registerPlugin } from '@capacitor/core';
import { calculateDistance } from '@/modules/timesheet/lib/timeUtils';
import { insertLocationPoints } from '@/modules/timesheet/lib/vehicleService';
import { storageKey } from '@/core/storage'
import {
    startVehicleTrackingNotification,
    stopVehicleTrackingNotification,
    isNativeAppVehicleTrackingDisabled,
    isNativeBackgroundGpsAvailable,
    getUseWebsiteForDrivingMessage,
} from '@/modules/timesheet/lib/vehicleTrackingNotification';

/** Native background GPS (foreground service). Registered lazily: the web build never calls it. */
let BackgroundGeolocation = null;
const bgGps = () => (BackgroundGeolocation ||= registerPlugin('BackgroundGeolocation'));

/**
 * Live GPS for a driver's vehicle journey — website (browser GPS while the page is open) and phone app
 * (background GPS service: keeps recording with the screen off or another app open).
 *
 * Every good GPS fix goes into a small on-device queue first (saved in localStorage), and the queue is
 * uploaded in batches. So a weak signal, a tunnel or a slow network no longer loses points — they are
 * sent as soon as the connection is back (also after a reload). A stationary vehicle still sends a
 * heartbeat point every 2 minutes, so the office can tell "parked" from "GPS stopped".
 */
export const VEHICLE_GPS_INTERVAL_MS = 5000;
const MIN_MOVE_M = 5; // queue a point once the vehicle moved this far …
const HEARTBEAT_MS = 2 * 60 * 1000; // … or this long passed (parked / traffic)
const MIN_GAP_MS = 4000; // never more than one point every 4 s
const MAX_ACCURACY_M = 100;
const MAX_QUEUE = 3000;
const BATCH = 200;

const STORAGE_KEY = storageKey('timesheet', 'akk_active_vehicle_journey_id');
const QUEUE_KEY = storageKey('timesheet', 'akk_vehicle_point_queue');

let watchId = null;
let capWatchId = null;
let uploadTimer = null;
let currentJourneyId = null;
let currentVehicleLabel = null;
let lastCoords = null;
let lastQueued = null; // { latitude, longitude, at }
let onErrorCallback = null;
let wakeLock = null;
let visibilityHandler = null;
let onlineHandler = null;
/** True while driver is on a short break — must not auto-restart GPS on tab focus. */
let uploadsPaused = false;
let lastFixAt = null;
let lastSentAt = null;
let lastError = null;
let lastFlushAt = 0;

/* ---------------- queue (survives reloads) ---------------- */
let queue = loadQueue(); // [{ journeyId, coords }]

function loadQueue() {
    try {
        const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        return Array.isArray(q) ? q : [];
    } catch {
        return [];
    }
}
function persistQueue() {
    try {
        if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
        if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        else localStorage.removeItem(QUEUE_KEY);
    } catch {
        /* storage full / blocked — keep in memory */
    }
}

function saveActiveJourneyId(id) {
    try {
        if (id) localStorage.setItem(STORAGE_KEY, id);
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

export function getStoredActiveJourneyId() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

async function requestWebWakeLock() {
    if (Capacitor.isNativePlatform() || !('wakeLock' in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
        });
    } catch {
        /* optional — e.g. low battery */
    }
}

async function releaseWebWakeLock() {
    try {
        await wakeLock?.release();
    } catch {
        /* ignore */
    }
    wakeLock = null;
}

function attachResumeHandlers() {
    if (!visibilityHandler) {
        visibilityHandler = () => {
            if (document.visibilityState !== 'visible' || !currentJourneyId || uploadsPaused) return;
            void requestWebWakeLock();
            const needsWatch = Capacitor.isNativePlatform() ? capWatchId == null : watchId == null;
            if (needsWatch) {
                if (Capacitor.isNativePlatform()) void startCapacitorWatch();
                else void startBrowserWatch();
            }
            if (!uploadTimer) startUploadInterval();
            void flushVehicleTrackingQueue();
        };
        document.addEventListener('visibilitychange', visibilityHandler);
    }
    if (!onlineHandler && typeof window !== 'undefined') {
        onlineHandler = () => void flushVehicleTrackingQueue();
        window.addEventListener('online', onlineHandler);
    }
}

function detachResumeHandlers() {
    if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
    if (onlineHandler) {
        window.removeEventListener('online', onlineHandler);
        onlineHandler = null;
    }
}

function shouldQueue(coords, now) {
    if (!coords || !(coords.accuracy <= MAX_ACCURACY_M)) return false;
    if (!lastQueued) return true;
    if (now - lastQueued.at < MIN_GAP_MS) return false;
    const d = calculateDistance(lastQueued.latitude, lastQueued.longitude, coords.latitude, coords.longitude);
    return d >= MIN_MOVE_M || now - lastQueued.at >= HEARTBEAT_MS;
}

function isGoneJourneyUploadError(error) {
    const code = error?.code;
    const msg = String(error?.message || '');
    // Deleted journey → FK violation; missing row / RLS denials after admin delete.
    return (
        code === '23503' ||
        code === 'PGRST116' ||
        /foreign key|violates foreign key/i.test(msg) ||
        /could not find|not found|does not exist/i.test(msg)
    );
}

let flushInFlight = null;

/** Upload everything queued for the current journey (batches). Safe to call any time. */
export async function flushVehicleTrackingQueue() {
    if (flushInFlight) return flushInFlight;
    flushInFlight = (async () => {
        try {
            while (queue.length) {
                const journeyId = queue[0].journeyId;
                const batch = [];
                for (const item of queue) {
                    if (item.journeyId !== journeyId || batch.length >= BATCH) break;
                    batch.push(item.coords);
                }
                try {
                    await insertLocationPoints(journeyId, batch);
                } catch (e) {
                    if (isGoneJourneyUploadError(e)) {
                        // Journey deleted by an admin: drop its points and stop tracking it.
                        queue = queue.filter((x) => x.journeyId !== journeyId);
                        persistQueue();
                        if (currentJourneyId === journeyId) void stopVehicleTracking({ flush: false });
                        continue;
                    }
                    lastError = e;
                    onErrorCallback?.(e);
                    return; // offline / server busy: keep the queue, retry on the next tick
                }
                queue = queue.slice(batch.length);
                persistQueue();
                lastSentAt = Date.now();
                lastError = null;
            }
        } finally {
            flushInFlight = null;
        }
    })();
    return flushInFlight;
}

function handlePosition(position) {
    const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        heading: position.coords.heading,
        timestamp: position.timestamp,
    };
    lastCoords = coords;
    lastFixAt = Date.now();
    if (!currentJourneyId || uploadsPaused) return;
    const now = Number(position.timestamp) || Date.now();
    if (shouldQueue(coords, now)) {
        queue.push({ journeyId: currentJourneyId, coords });
        lastQueued = { latitude: coords.latitude, longitude: coords.longitude, at: now };
        persistQueue();
        // In the background the app's timers are slowed down a lot; GPS callbacks still arrive, so
        // send from here too.
        if (queue.length >= 6 || Date.now() - lastFlushAt > 30000) {
            lastFlushAt = Date.now();
            void flushVehicleTrackingQueue();
        }
    }
}

function startUploadInterval() {
    stopUploadInterval();
    // Runs while the page is hidden too (the browser slows it down, it doesn't stop it), so queued
    // points still go out when the network is back.
    uploadTimer = window.setInterval(() => void flushVehicleTrackingQueue(), VEHICLE_GPS_INTERVAL_MS);
}

function stopUploadInterval() {
    if (uploadTimer) {
        window.clearInterval(uploadTimer);
        uploadTimer = null;
    }
}

async function startBrowserWatch() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }
        watchId = navigator.geolocation.watchPosition(
            (pos) => handlePosition(pos),
            (err) => {
                console.error('Browser geolocation watch error', err);
                lastError = err;
                onErrorCallback?.(err);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
        resolve();
    });
}

async function startCapacitorWatch() {
    if (isNativeBackgroundGpsAvailable()) {
        const label = currentVehicleLabel ? ` ${currentVehicleLabel}` : '';
        capWatchId = await bgGps().addWatcher(
            {
                backgroundTitle: `AKK Hub — driving${label}`,
                backgroundMessage: 'Vehicle location is being recorded. Tap Finish ride in AKK Hub when you park.',
                requestPermissions: true,
                stale: false,
                distanceFilter: 10,
            },
            (location, err) => {
                if (err) {
                    console.error('Background GPS error', err);
                    lastError = err;
                    if (err.code === 'NOT_AUTHORIZED') {
                        err.message = 'Location permission is off for AKK Hub. Allow it in phone Settings so the journey can be tracked.';
                    }
                    onErrorCallback?.(err);
                    return;
                }
                if (!location) return;
                handlePosition({
                    coords: {
                        latitude: location.latitude,
                        longitude: location.longitude,
                        accuracy: location.accuracy,
                        speed: location.speed,
                        heading: location.bearing,
                    },
                    timestamp: location.time || Date.now(),
                });
            },
        );
        return;
    }
    const { Geolocation } = await import('@capacitor/geolocation');
    capWatchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000 },
        (position, err) => {
            if (err) {
                console.error('Capacitor geolocation watch error', err);
                lastError = err;
                onErrorCallback?.(err);
                return;
            }
            if (position) handlePosition(position);
        }
    );
}

function stopBrowserWatch() {
    if (watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

async function stopCapacitorWatch() {
    if (capWatchId != null) {
        try {
            if (isNativeBackgroundGpsAvailable()) {
                await bgGps().removeWatcher({ id: capWatchId });
            } else {
                const { Geolocation } = await import('@capacitor/geolocation');
                await Geolocation.clearWatch({ id: capWatchId });
            }
        } catch (e) {
            console.warn('clearWatch failed', e);
        }
        capWatchId = null;
    }
}

/** Phone app: open AKK Hub's settings page (e.g. after location was denied). */
export async function openAppLocationSettings() {
    if (!isNativeBackgroundGpsAvailable()) return;
    try {
        await bgGps().openSettings();
    } catch {
        /* ignore */
    }
}

/**
 * Start GPS tracking for an active vehicle journey (website only — see vehicleTrackingNotification).
 */
export async function startVehicleTracking({ journeyId, vehicleLabel = '', onError }) {
    if (!journeyId) return;

    if (isNativeAppVehicleTrackingDisabled()) {
        const err = new Error(getUseWebsiteForDrivingMessage());
        if (onError) onError(err);
        throw err;
    }

    if (currentJourneyId === journeyId && (watchId != null || capWatchId != null)) {
        return;
    }

    await stopVehicleTracking({ flush: false });

    currentJourneyId = journeyId;
    currentVehicleLabel = vehicleLabel;
    onErrorCallback = onError || null;
    lastQueued = null;
    lastCoords = null;
    lastError = null;
    uploadsPaused = false;
    saveActiveJourneyId(journeyId);

    try {
        await startVehicleTrackingNotification(vehicleLabel);

        if (Capacitor.isNativePlatform()) {
            await startCapacitorWatch();
        } else {
            await startBrowserWatch();
        }

        startUploadInterval();
        attachResumeHandlers();
        if (!Capacitor.isNativePlatform()) {
            await requestWebWakeLock();
        }
        void flushVehicleTrackingQueue();
    } catch (e) {
        // Don't leave a half-started tracker (notification / stored journey id) behind.
        await stopVehicleTracking({ flush: false });
        throw e;
    }
}

export async function stopVehicleTracking({ flush = true } = {}) {
    if (flush && queue.length) {
        try {
            await Promise.race([flushVehicleTrackingQueue(), new Promise((r) => setTimeout(r, 8000))]);
        } catch {
            /* the rest stays queued and goes out next time */
        }
    }
    stopUploadInterval();
    detachResumeHandlers();
    await releaseWebWakeLock();
    stopBrowserWatch();
    await stopCapacitorWatch();
    await stopVehicleTrackingNotification();

    currentJourneyId = null;
    currentVehicleLabel = null;
    lastQueued = null;
    lastCoords = null;
    onErrorCallback = null;
    uploadsPaused = false;
    saveActiveJourneyId(null);
}

export function isVehicleTrackingActive() {
    return Boolean(currentJourneyId && (watchId != null || capWatchId != null || uploadTimer));
}

export function getCurrentTrackingJourneyId() {
    return currentJourneyId;
}

/** Last GPS sample from the active watch, if any. Used when finishing a ride indoors. */
export function getLastKnownCoords() {
    return lastCoords;
}

/** For the driver card: when GPS last answered, when points last reached the office, how many wait. */
export function getVehicleTrackingHealth() {
    return {
        active: isVehicleTrackingActive(),
        paused: uploadsPaused,
        lastFixAt,
        lastSentAt,
        queued: queue.length,
        error: lastError ? String(lastError.message || lastError) : null,
    };
}

/**
 * Resume tracking after page reload / app reopen if worker still has an active journey in DB.
 */
export async function resumeVehicleTrackingIfNeeded(fetchActiveJourney) {
    // Points recorded before a reload are still in the queue — send them.
    if (queue.length) void flushVehicleTrackingQueue();

    // Old app build without background GPS: nothing to resume.
    if (isNativeAppVehicleTrackingDisabled()) {
        const journey = await fetchActiveJourney();
        return journey?.status === 'completed' ? null : journey;
    }

    if (isVehicleTrackingActive()) {
        const journey = await fetchActiveJourney();
        return journey?.status === 'completed' ? null : journey;
    }

    const journey = await fetchActiveJourney();
    if (!journey || journey.status === 'completed') {
        saveActiveJourneyId(null);
        return null;
    }

    const label = journey.vehicles?.vehicle_number || journey.vehicles?.description || '';
    saveActiveJourneyId(journey.id);

    if (journey.status === 'active') {
        await startVehicleTracking({ journeyId: journey.id, vehicleLabel: label });
    }
    return journey;
}

/** Pause uploads during break but keep notification until full stop. */
export async function pauseVehicleTrackingUploads() {
    void flushVehicleTrackingQueue();
    uploadsPaused = true;
    stopUploadInterval();
    stopBrowserWatch();
    await stopCapacitorWatch();
}

/** Resume uploads after break ends. */
export async function resumeVehicleTrackingUploads(journeyId, vehicleLabel) {
    if (!journeyId) return;
    if (isNativeAppVehicleTrackingDisabled()) return;

    currentJourneyId = journeyId;
    currentVehicleLabel = vehicleLabel;
    uploadsPaused = false;
    lastQueued = null;
    saveActiveJourneyId(journeyId);

    // Never stack a second GPS watch on top of one that is still running.
    stopBrowserWatch();
    await stopCapacitorWatch();
    if (Capacitor.isNativePlatform()) {
        await startCapacitorWatch();
    } else {
        await startBrowserWatch();
    }
    startUploadInterval();
    attachResumeHandlers();
    if (!Capacitor.isNativePlatform()) {
        await requestWebWakeLock();
    }
    void flushVehicleTrackingQueue();
}

function positionToCoords(pos) {
    return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
    };
}

const NATIVE_POSITION_ATTEMPTS = [
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
    { enableHighAccuracy: true, timeout: 25000, maximumAge: 60000 },
    { enableHighAccuracy: true, timeout: 35000, maximumAge: 0 },
];

const WEB_POSITION_ATTEMPTS = [
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
];

export async function captureCurrentPosition() {
    if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        let lastErr = null;
        for (const opts of NATIVE_POSITION_ATTEMPTS) {
            try {
                const pos = await Geolocation.getCurrentPosition(opts);
                if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
                    return positionToCoords(pos);
                }
            } catch (e) {
                lastErr = e;
                console.warn('captureCurrentPosition attempt failed', opts, e);
            }
        }
        throw lastErr || new Error('Could not get GPS fix');
    }

    if (!navigator.geolocation) {
        throw new Error('Geolocation not supported');
    }

    let lastErr = null;
    for (const opts of WEB_POSITION_ATTEMPTS) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, opts);
            });
            if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
                return positionToCoords(pos);
            }
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('Could not get GPS fix');
}
