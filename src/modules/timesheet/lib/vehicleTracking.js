import { Capacitor } from '@capacitor/core';
import { calculateDistance } from '@/modules/timesheet/lib/timeUtils';
import { insertLocationPoint } from '@/modules/timesheet/lib/vehicleService';
import { storageKey } from '@/core/storage'
import {
    startVehicleTrackingNotification,
    stopVehicleTrackingNotification,
    isNativeAppVehicleTrackingDisabled,
    getUseWebsiteForDrivingMessage,
} from '@/modules/timesheet/lib/vehicleTrackingNotification';

export const VEHICLE_GPS_INTERVAL_MS = 5000;
const MIN_UPLOAD_DELTA_M = 5;
const MAX_ACCURACY_M = 100;

const STORAGE_KEY = storageKey('timesheet', 'akk_active_vehicle_journey_id');

let watchId = null;
let capWatchId = null;
let uploadTimer = null;
let lastUploaded = null;
let currentJourneyId = null;
let currentVehicleLabel = null;
let lastCoords = null;
let onErrorCallback = null;
let wakeLock = null;
let visibilityHandler = null;
/** True while driver is on a short break — must not auto-restart GPS on tab focus. */
let uploadsPaused = false;

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

function attachVisibilityResume() {
    if (visibilityHandler) return;
    visibilityHandler = () => {
        if (document.visibilityState !== 'visible' || !currentJourneyId || uploadsPaused) return;
        void requestWebWakeLock();
        const needsWatch = Capacitor.isNativePlatform() ? capWatchId == null : watchId == null;
        if (needsWatch) {
            if (Capacitor.isNativePlatform()) {
                void startCapacitorWatch();
            } else {
                void startBrowserWatch();
            }
        }
        if (!uploadTimer) startUploadInterval();
        void tickUpload();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
}

function detachVisibilityResume() {
    if (!visibilityHandler) return;
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
}

function shouldUpload(coords) {
    if (!coords || coords.accuracy > MAX_ACCURACY_M) return false;
    if (!lastUploaded) return true;
    const d = calculateDistance(
        lastUploaded.latitude,
        lastUploaded.longitude,
        coords.latitude,
        coords.longitude
    );
    return d >= MIN_UPLOAD_DELTA_M;
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

/** True while an insert is in flight, so a slow upload can't be duplicated by the next 5s tick. */
let uploadInFlight = false;

async function uploadCoords(journeyId, coords) {
    if (!journeyId || !coords) return;
    if (uploadInFlight) return;
    if (!shouldUpload(coords)) return;

    uploadInFlight = true;
    try {
        await insertLocationPoint(journeyId, coords);
        lastUploaded = { latitude: coords.latitude, longitude: coords.longitude };
    } catch (e) {
        console.error('Failed to upload vehicle location', e);
        if (isGoneJourneyUploadError(e) && currentJourneyId === journeyId) {
            void stopVehicleTracking();
        }
        onErrorCallback?.(e);
    } finally {
        uploadInFlight = false;
    }
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
}

async function tickUpload() {
    if (!currentJourneyId || !lastCoords) return;
    await uploadCoords(currentJourneyId, lastCoords);
}

function startUploadInterval() {
    stopUploadInterval();
    uploadTimer = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void tickUpload();
    }, VEHICLE_GPS_INTERVAL_MS);
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
                onErrorCallback?.(err);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
        resolve();
    });
}

async function startCapacitorWatch() {
    const { Geolocation } = await import('@capacitor/geolocation');
    capWatchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000 },
        (position, err) => {
            if (err) {
                console.error('Capacitor geolocation watch error', err);
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
            const { Geolocation } = await import('@capacitor/geolocation');
            await Geolocation.clearWatch({ id: capWatchId });
        } catch (e) {
            console.warn('clearWatch failed', e);
        }
        capWatchId = null;
    }
}

/**
 * Start GPS tracking for an active vehicle journey (website only).
 * Native Android/iOS apps must use https://timesheet-manager.akk.sg for driving.
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

    await stopVehicleTracking();

    currentJourneyId = journeyId;
    currentVehicleLabel = vehicleLabel;
    onErrorCallback = onError || null;
    lastUploaded = null;
    lastCoords = null;
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
        attachVisibilityResume();
        if (!Capacitor.isNativePlatform()) {
            await requestWebWakeLock();
        }
        void tickUpload();
    } catch (e) {
        // Don't leave a half-started tracker (notification / stored journey id) behind.
        await stopVehicleTracking();
        throw e;
    }
}

export async function stopVehicleTracking() {
    stopUploadInterval();
    detachVisibilityResume();
    await releaseWebWakeLock();
    stopBrowserWatch();
    await stopCapacitorWatch();
    await stopVehicleTrackingNotification();

    currentJourneyId = null;
    currentVehicleLabel = null;
    lastUploaded = null;
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

/**
 * Resume tracking after page reload / app reopen if worker still has an active journey in DB.
 * Works on website and APK — does not rely on session-only storage.
 */
export async function resumeVehicleTrackingIfNeeded(fetchActiveJourney) {
    // Native app: never auto-resume continuous GPS (Play FGS policy).
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
    attachVisibilityResume();
    if (!Capacitor.isNativePlatform()) {
        await requestWebWakeLock();
    }
    void tickUpload();
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
        let lastError = null;
        for (const opts of NATIVE_POSITION_ATTEMPTS) {
            try {
                const pos = await Geolocation.getCurrentPosition(opts);
                if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
                    return positionToCoords(pos);
                }
            } catch (e) {
                lastError = e;
                console.warn('captureCurrentPosition attempt failed', opts, e);
            }
        }
        throw lastError || new Error('Could not get GPS fix');
    }

    if (!navigator.geolocation) {
        throw new Error('Geolocation not supported');
    }

    let lastError = null;
    for (const opts of WEB_POSITION_ATTEMPTS) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, opts);
            });
            if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
                return positionToCoords(pos);
            }
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('Could not get GPS fix');
}
