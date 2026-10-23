import { Capacitor } from '@capacitor/core';

const TRACKING_CHANNEL_ID = 'akk_vehicle_tracking';
const TRACKING_NOTIFICATION_ID = 9001;

/**
 * Phone app: live vehicle GPS runs through the BackgroundGeolocation plugin (foreground service with a
 * "Vehicle tracking" notification, keeps working with the screen off). Only an older app build without
 * that plugin falls back to "use the website".
 */
export function isNativeBackgroundGpsAvailable() {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackgroundGeolocation');
}

export function isNativeAppVehicleTrackingDisabled() {
    return Capacitor.isNativePlatform() && !isNativeBackgroundGpsAvailable();
}

/**
 * The AKK Hub website address (VITE_PUBLIC_SITE_URL, else this page's own address on the web).
 * Never the old Timesheet Manager site: that one writes to the old database.
 */
export function getDrivingSiteUrl() {
    const configured = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    if (Capacitor.getPlatform() === 'web' && typeof window !== 'undefined') return window.location.origin;
    return null;
}

/** Open the AKK Hub website in the phone's browser (from the app). */
export function openDrivingSite() {
    const url = getDrivingSiteUrl();
    if (!url) return false;
    window.open(`${url}/`, '_blank', 'noopener');
    return true;
}

export function getUseWebsiteForDrivingMessage() {
    const url = getDrivingSiteUrl();
    return url
        ? `Live vehicle GPS is not available in the mobile app. Open ${url} in Chrome while driving (same login), then scan the vehicle QR there.`
        : 'Live vehicle GPS is not available in the mobile app. Open the AKK Hub website in Chrome while driving (same login), then scan the vehicle QR there.';
}

function isLocationGranted(perm) {
    if (!perm) return false;
    return (
        perm.location === 'granted' ||
        perm.coarseLocation === 'granted' ||
        perm.location === 'limited'
    );
}

function isPermissionDeniedError(err) {
    const code = err?.code;
    const msg = String(err?.message || err || '').toLowerCase();
    return code === 1 || msg.includes('denied') || msg.includes('permission');
}

/** User-facing message when GPS permission is missing. */
export function getLocationDeniedMessage() {
    if (Capacitor.isNativePlatform()) {
        return 'Allow Location in phone Settings → Apps → AKK Hub → Permissions → Location (Allow while using the app, Precise on), then scan again.';
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
        return 'Open this site via HTTPS so GPS can work.';
    }
    return 'Allow location access in your browser, then scan again.';
}

/** GPS fix failed but permission may be OK (indoors, slow satellite, etc.). */
export function getGpsUnavailableMessage() {
    if (Capacitor.isNativePlatform()) {
        return 'Could not get GPS right now. Turn on Location/GPS, move near a window or outdoors, wait a few seconds, then scan again.';
    }
    return 'Could not get your location. Check GPS is on and try again near a window.';
}

export function getGpsErrorMessage(err) {
    if (isPermissionDeniedError(err)) return getLocationDeniedMessage();
    return getGpsUnavailableMessage();
}

/** Request location permission only — does not require an immediate GPS fix. */
export async function ensureVehicleLocationPermission() {
    if (Capacitor.getPlatform() === 'web') {
        if (!navigator.geolocation) return false;
        if (!window.isSecureContext) return false;

        try {
            const perm = await navigator.permissions?.query?.({ name: 'geolocation' });
            if (perm?.state === 'granted') return true;
            if (perm?.state === 'denied') return false;
        } catch {
            /* optional */
        }

        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                () => resolve(true),
                (err) => resolve(!isPermissionDeniedError(err)),
                { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
            );
        });
    }

    try {
        const { Geolocation } = await import('@capacitor/geolocation');
        let perm = await Geolocation.checkPermissions();
        if (!isLocationGranted(perm)) {
            perm = await Geolocation.requestPermissions();
        }
        return isLocationGranted(perm);
    } catch (e) {
        console.warn('ensureVehicleLocationPermission failed', e);
        return false;
    }
}

/** Kept so the "tracking" notice can be dismissed when the ride ends (it is requireInteraction). */
let webTrackingNotification = null;

async function showWebTrackingNotification(vehicleLabel) {
    if (Capacitor.getPlatform() !== 'web' || typeof Notification === 'undefined') return;
    try {
        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        if (Notification.permission !== 'granted') return;
        closeWebTrackingNotification();
        webTrackingNotification = new Notification('AKK vehicle tracking', {
            body: vehicleLabel
                ? `Location is being tracked for ${vehicleLabel}. Keep this tab open for best results.`
                : 'Your vehicle location is being tracked. Keep this tab open for best results.',
            tag: 'akk-vehicle-tracking',
            requireInteraction: true,
        });
    } catch {
        /* optional */
    }
}

function closeWebTrackingNotification() {
    try {
        webTrackingNotification?.close();
    } catch {
        /* ignore */
    }
    webTrackingNotification = null;
}

/** Website tracking notice. In the app the background-GPS service shows its own notification. */
export async function startVehicleTrackingNotification(vehicleLabel) {
    if (Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() === 'web') {
        await showWebTrackingNotification(vehicleLabel);
    }
}

export async function stopVehicleTrackingNotification() {
    if (Capacitor.getPlatform() === 'web') {
        closeWebTrackingNotification();
        return;
    }
    // Native: no foreground service / ongoing tracking notification.
    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.cancel({ notifications: [{ id: TRACKING_NOTIFICATION_ID }] });
    } catch {
        /* ignore */
    }
}

/** Location permission for one-shot GPS (e.g. site QR). Not used to start FGS on Android. */
export async function requestVehicleTrackingPermissions() {
    if (isNativeAppVehicleTrackingDisabled()) {
        return false;
    }
    const locOk = await ensureVehicleLocationPermission();
    if (!locOk) return false;

    if (Capacitor.getPlatform() === 'web' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {});
    }

    return true;
}
