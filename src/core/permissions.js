/**
 * Camera / location / notification permissions (from Timesheet permissionManager.js,
 * permissionsFlags.js and firstBootPermissions.js).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { local } from '@/core/storage';

let PermissionPlugin = null;
try {
    PermissionPlugin = registerPlugin('PermissionManager');
} catch {
    PermissionPlugin = null;
}

/* ---- one-time wizard flag ---- */

export function isNativePermissionsWizardComplete() {
    return local.get('hub', 'permissionsWizardV1') === '1';
}

export function setNativePermissionsWizardComplete() {
    local.set('hub', 'permissionsWizardV1', '1');
}

/* ---- camera ---- */

export async function requestCameraPermission() {
    try {
        if (!PermissionPlugin) return { granted: true };
        return await PermissionPlugin.requestCameraPermission();
    } catch {
        return { granted: true };
    }
}

export async function checkCameraPermission() {
    try {
        if (!PermissionPlugin) return { granted: true };
        return await PermissionPlugin.checkCameraPermission();
    } catch {
        return { granted: true };
    }
}

async function toastError(message) {
    try {
        const { toast } = await import('sonner');
        toast.error(message);
    } catch {
        console.error(message);
    }
}

export async function requestCameraPermissionWithFallback() {
    try {
        const result = isNativePermissionsWizardComplete()
            ? await checkCameraPermission()
            : await requestCameraPermission();
        if (!result.granted) {
            await toastError('Camera permission denied. Please enable camera permissions in your device settings.');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error requesting camera permission:', error);
        return false;
    }
}

/* ---- first launch ---- */

async function requestNativeGeolocationOnce() {
    try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
            await Geolocation.requestPermissions();
        }
        await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    } catch {
        /* user may deny — continue */
    }
}

let firstLaunchRunning = false;

/** One-time (per install) native flow: notifications, location, camera. */
export async function runNativeFirstLaunchPermissionsIfNeeded() {
    if (!Capacitor.isNativePlatform()) return;
    if (isNativePermissionsWizardComplete() || firstLaunchRunning) return;
    firstLaunchRunning = true;
    try {
        try {
            const { PushNotifications } = await import('@capacitor/push-notifications');
            const pp = await PushNotifications.checkPermissions();
            if (pp.receive !== 'granted') await PushNotifications.requestPermissions();
        } catch {
            /* ignore */
        }
        await requestNativeGeolocationOnce();
        await requestCameraPermission();
    } finally {
        setNativePermissionsWizardComplete();
        firstLaunchRunning = false;
    }
}
