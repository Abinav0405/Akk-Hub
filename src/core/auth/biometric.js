/**
 * Device biometric login (Face ID / Touch ID / Android fingerprint & face).
 *
 * Biometrics never "log in" by themselves. They unlock a credential that is stored in the
 * platform secure store — iOS Keychain / Android Keystore — with biometric access control
 * (BIOMETRY_CURRENT_SET). The OS only releases it after a live biometric match, and the
 * item is destroyed if the device's biometric enrollment changes, which forces the worker
 * back to their password. Nothing secret is ever written to localStorage.
 *
 * Only the non-secret preference (enabled, chosen mode, which worker) lives in localStorage.
 */
import { Capacitor } from '@capacitor/core';
import {
    AccessControl,
    BiometricAuthError,
    BiometryType,
    NativeBiometric,
} from '@capgo/capacitor-native-biometric';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { isNativeApp } from '@/core/platform';

/** Keychain / Keystore item name for the worker credential. */
const CREDENTIAL_SERVER = 'sg.akk.hub.worker-login';
const PREFS_KEY = 'akk.hub.biometricLogin';
const DECLINED_KEY = 'akk.hub.biometricOfferDeclined';

/** After this many failed matches in one prompt, only the password fallback is offered. */
export const MAX_BIOMETRIC_ATTEMPTS = 3;

/** @typedef {'face' | 'fingerprint'} BiometricMode */

const isIOS = () => Capacitor.getPlatform() === 'ios';

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

function modesForType(type) {
    switch (type) {
        case BiometryType.FACE_ID:
        case BiometryType.FACE_AUTHENTICATION:
        case BiometryType.IRIS_AUTHENTICATION:
            return ['face'];
        case BiometryType.TOUCH_ID:
        case BiometryType.FINGERPRINT:
            return ['fingerprint'];
        case BiometryType.MULTIPLE:
            return ['face', 'fingerprint'];
        default:
            return [];
    }
}

/**
 * What this device can do, right now.
 * `available` is true only when a *strong* biometric is enrolled — the Keystore key that
 * protects the credential requires Class 3 biometrics, so weak-only face unlock can't use it.
 *
 * @returns {Promise<{ available: boolean, modes: BiometricMode[], primary: BiometricMode | null, reason: string | null }>}
 */
export async function getBiometricSupport() {
    const none = (reason) => ({ available: false, modes: [], primary: null, reason });
    if (!isNativeApp()) return none('web');

    try {
        const result = await NativeBiometric.isAvailable({ useFallback: false });
        const modes = modesForType(result.biometryType);

        if (!result.isAvailable || modes.length === 0) {
            return none(errorCodeToReason(result.errorCode) || 'unavailable');
        }
        if (!result.strongBiometryIsAvailable) return none('weak');

        // Face is primary when it's the only option, or on iOS. On Android "MULTIPLE" usually
        // means a Class 2 face sensor next to a Class 3 fingerprint, and the secure prompt will
        // only accept the fingerprint — so fingerprint leads there and Face stays selectable.
        const primary =
            modes.length === 1 ? modes[0] : isIOS() ? 'face' : 'fingerprint';
        return { available: true, modes, primary, reason: null };
    } catch {
        return none('unavailable');
    }
}

// ---------------------------------------------------------------------------
// Preferences (non-secret)
// ---------------------------------------------------------------------------

/** @returns {{ enabled: boolean, mode: BiometricMode, workerId: string, workerType: string, workerName: string }} */
export function getBiometricPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
        if (raw && raw.enabled && raw.workerId) {
            return {
                enabled: true,
                mode: raw.mode === 'face' ? 'face' : 'fingerprint',
                workerId: String(raw.workerId),
                workerType: raw.workerType === 'local' ? 'local' : 'foreign',
                workerName: raw.workerName || '',
            };
        }
    } catch {
        /* ignore */
    }
    return { enabled: false, mode: 'fingerprint', workerId: '', workerType: 'foreign', workerName: '' };
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

/** Change which glyph / copy the login prompt uses. */
export function setBiometricMode(mode) {
    const prefs = getBiometricPrefs();
    if (prefs.enabled) savePrefs({ ...prefs, mode });
}

/** True when the login screen should offer to turn biometric login on for this worker. */
export function shouldOfferBiometric(workerId) {
    try {
        const declined = JSON.parse(localStorage.getItem(DECLINED_KEY) || '[]');
        return !declined.includes(String(workerId));
    } catch {
        return true;
    }
}

/** Remember "Not Now" so the post-login offer isn't shown on every login. */
export function markBiometricOfferDeclined(workerId) {
    try {
        const declined = new Set(JSON.parse(localStorage.getItem(DECLINED_KEY) || '[]'));
        declined.add(String(workerId));
        localStorage.setItem(DECLINED_KEY, JSON.stringify([...declined]));
    } catch {
        /* ignore */
    }
}

function clearDeclined(workerId) {
    try {
        const declined = JSON.parse(localStorage.getItem(DECLINED_KEY) || '[]');
        localStorage.setItem(DECLINED_KEY, JSON.stringify(declined.filter((id) => id !== String(workerId))));
    } catch {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// Secure credential
// ---------------------------------------------------------------------------

/**
 * Store the worker's credential behind biometrics. On Android this shows the system prompt
 * (the Keystore key must be unlocked once to encrypt).
 */
export async function enableBiometricLogin({ workerId, workerType, workerName, password, mode }) {
    try {
        await NativeBiometric.setCredentials({
            server: CREDENTIAL_SERVER,
            username: JSON.stringify({ workerId: String(workerId), workerType }),
            password,
            // Invalidated when a fingerprint/face is added or removed → re-prompt for password.
            accessControl: AccessControl.BIOMETRY_CURRENT_SET,
            title: 'Turn on biometric login',
            negativeButtonText: 'Cancel',
        });
    } catch (error) {
        throw normalizeBiometricError(error);
    }
    savePrefs({ enabled: true, mode, workerId: String(workerId), workerType, workerName: workerName || '' });
    clearDeclined(workerId);
}

/**
 * Show the system biometric prompt and release the stored credential on a match.
 * @returns {Promise<{ workerId: string, workerType: string, password: string }>}
 * @throws {{ biometric: true, code: string }} a normalized biometric error (see normalizeBiometricError)
 */
export async function unlockBiometricCredential({ mode }) {
    let creds;
    try {
        creds = await NativeBiometric.getSecureCredentials({
            server: CREDENTIAL_SERVER,
            reason: 'Log in to AKK Hub',
            title: mode === 'face' ? 'Log in with Face ID' : 'Log in with fingerprint',
            subtitle: 'AKK Hub',
            // Android reports this button as a plain cancel; the prompt then offers "Use Password".
            negativeButtonText: 'Cancel',
        });
    } catch (error) {
        const normalized = normalizeBiometricError(error);
        // The credential is gone (enrollment changed or never stored) — drop the preference so
        // the login screen goes back to the password and can offer to set it up again.
        if (normalized.code === 'invalidated') await disableBiometricLogin({ keepDeclined: true });
        throw normalized;
    }

    try {
        const { workerId, workerType } = JSON.parse(creds.username);
        return { workerId, workerType: workerType === 'local' ? 'local' : 'foreign', password: creds.password };
    } catch {
        await disableBiometricLogin({ keepDeclined: true });
        throw { biometric: true, code: 'invalidated' };
    }
}

/** Delete the stored credential and preference. */
export async function disableBiometricLogin({ keepDeclined = false } = {}) {
    const { workerId } = getBiometricPrefs();
    try {
        await NativeBiometric.deleteCredentials({ server: CREDENTIAL_SERVER });
    } catch {
        /* nothing stored */
    }
    try {
        localStorage.removeItem(PREFS_KEY);
    } catch {
        /* ignore */
    }
    if (!keepDeclined && workerId) clearDeclined(workerId);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function errorCodeToReason(code) {
    switch (Number(code)) {
        case BiometricAuthError.BIOMETRICS_NOT_ENROLLED:
            return 'not_enrolled';
        case BiometricAuthError.PASSCODE_NOT_SET:
            return 'passcode_not_set';
        case BiometricAuthError.USER_LOCKOUT:
            return 'lockout';
        case BiometricAuthError.USER_TEMPORARY_LOCKOUT:
            return 'lockout_temporary';
        case BiometricAuthError.BIOMETRICS_UNAVAILABLE:
            return 'unavailable';
        default:
            return null;
    }
}

/**
 * Map a plugin rejection to one of:
 * 'failed' | 'cancel' | 'fallback' | 'lockout' | 'lockout_temporary' | 'not_enrolled' |
 * 'passcode_not_set' | 'unavailable' | 'invalidated' | 'unknown'
 */
export function normalizeBiometricError(error) {
    if (error?.biometric) return error;
    const result = (c) => ({ biometric: true, code: c });
    const code = Number(error?.code ?? error?.errorCode);
    const message = String(error?.message || '');

    switch (code) {
        case BiometricAuthError.AUTHENTICATION_FAILED:
            return result('failed');
        case BiometricAuthError.USER_TEMPORARY_LOCKOUT:
            // Android reports a single non-matching touch (we allow one per prompt) with the
            // same code as a real lockout, distinguished only by this message.
            return result(message.includes('Too many failed attempts') ? 'failed' : 'lockout_temporary');
        case BiometricAuthError.USER_CANCEL:
        case BiometricAuthError.SYSTEM_CANCEL:
        case BiometricAuthError.APP_CANCEL:
            return result('cancel');
        case BiometricAuthError.USER_FALLBACK:
            return result('fallback');
        case BiometricAuthError.NO_PROTECTED_CREDENTIALS_FOUND:
            return result('invalidated');
        default:
            return result(errorCodeToReason(code) || 'unknown');
    }
}

// ---------------------------------------------------------------------------
// Copy & haptics
// ---------------------------------------------------------------------------

/** User-facing strings for a mode. */
export function getBiometricCopy(mode) {
    if (mode === 'face') {
        return {
            name: 'Face ID',
            scanning: 'Looking for your face…',
            failed: 'Face ID not recognized',
            useLabel: 'Use Face ID',
        };
    }
    const name = isIOS() ? 'Touch ID' : 'Fingerprint';
    return {
        name,
        scanning: 'Touch the sensor to log in',
        failed: 'Fingerprint not recognized. Try again.',
        useLabel: isIOS() ? 'Use Touch ID' : 'Use Fingerprint',
    };
}

/** Clear message for each non-match error. */
export function getBiometricErrorMessage(code, mode) {
    const { name } = getBiometricCopy(mode);
    switch (code) {
        case 'failed':
            return getBiometricCopy(mode).failed;
        case 'cancel':
            return `${name} was cancelled.`;
        case 'lockout':
            return `${name} is locked after too many attempts. Unlock your phone with its passcode, or use your password.`;
        case 'lockout_temporary':
            return 'Too many attempts. Wait 30 seconds, or use your password.';
        case 'not_enrolled':
            return `${name} isn't set up on this phone. Add it in your phone's Settings, or use your password.`;
        case 'passcode_not_set':
            return 'Set a screen lock on this phone to use biometric login.';
        case 'unavailable':
            return `${name} isn't available right now. Use your password.`;
        case 'invalidated':
            return 'Face or fingerprint settings changed on this phone. Log in with your password to turn biometric login back on.';
        default:
            return 'Something went wrong. Use your password to log in.';
    }
}

/** Why biometric login can't be turned on (from getBiometricSupport().reason). */
export function getUnsupportedMessage(reason) {
    switch (reason) {
        case 'not_enrolled':
            return 'Add a fingerprint or face in your phone’s Settings first.';
        case 'passcode_not_set':
            return 'Set a screen lock on this phone first.';
        case 'weak':
            return 'This phone’s face unlock isn’t secure enough to protect your password.';
        case 'web':
            return 'Available in the AKK mobile app.';
        default:
            return 'This phone doesn’t support biometric login.';
    }
}

/** Success / error notification haptic (no-op on web). */
export function biometricHaptic(kind) {
    if (!isNativeApp()) return;
    void Haptics.notification({
        type: kind === 'success' ? NotificationType.Success : NotificationType.Error,
    }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Remembered phone for one-tap Face ID (camera face check, no password)
// The server-issued key lives in the platform secure store (Keychain / Keystore-encrypted);
// only the worker's name/ID for the "Welcome back" line is kept in localStorage.
// One worker per phone: saving a new one replaces the previous one.
// ---------------------------------------------------------------------------

const FACE_DEVICE_KEY = 'akk.hub.face-login-device';
const FACE_DEVICE_PREFS = 'akk.hub.faceLoginDevice';

/** { workerId, workerType, workerName } of the worker remembered on this phone, or null. */
export function getFaceLoginDevicePrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(FACE_DEVICE_PREFS) || 'null');
        return raw?.workerId ? raw : null;
    } catch {
        return null;
    }
}

export async function getFaceLoginDeviceToken() {
    if (!isNativeApp()) return null;
    try {
        const { value } = await NativeBiometric.getData({ key: FACE_DEVICE_KEY });
        return value || null;
    } catch {
        return null;
    }
}

export async function saveFaceLoginDevice({ token, workerId, workerType, workerName }) {
    await NativeBiometric.setData({ key: FACE_DEVICE_KEY, value: token });
    try {
        localStorage.setItem(
            FACE_DEVICE_PREFS,
            JSON.stringify({ workerId: String(workerId), workerType, workerName: workerName || '' }),
        );
    } catch {
        /* ignore */
    }
}

export async function clearFaceLoginDevice() {
    try {
        await NativeBiometric.deleteData({ key: FACE_DEVICE_KEY });
    } catch {
        /* nothing stored */
    }
    try {
        localStorage.removeItem(FACE_DEVICE_PREFS);
    } catch {
        /* ignore */
    }
}
