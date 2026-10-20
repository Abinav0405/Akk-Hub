/**
 * Android push notifications for the whole hub (Capacitor Push Notifications + FCM).
 *
 * One app → one FCM token. After sign-in the token is registered with every back-end the person
 * uses, through each back-end's existing endpoint:
 *   Attendance  (Timesheet DB)  edge fn `register-device-token`  worker_id | manager_email | admin_email
 *   Site work   (Progress DB)   rpc worker_/staff_register_device_token
 *   Materials   (Materials DB)  edge fn `register-device-token`  staff JWT | worker id + password (once)
 * All three back-ends must send with the AKK Hub Firebase project's credentials (see
 * ANDROID_PUSH.md) — FCM only delivers a token through the project that issued it.
 *
 * Off unless VITE_ENABLE_FCM_REGISTER=true and android/app/google-services.json exists (without it
 * the native plugin has no Firebase app). Web: every function is a safe no-op.
 *
 * Taps: notification `data.path` (a hub path like "/timesheet/admin?section=leaves", or an old page
 * name like "AdminDashboard") opens that screen — also on cold start (queued until the router is up).
 */
import { Capacitor } from '@capacitor/core';
import { supabaseMaterials, supabaseProgress, supabaseTimesheet } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { legacyPath } from '@/app/paths';

const TOKEN_KEY = storageKey('hub', 'fcmToken');
const REGISTER_DELAY_MS = 2500; // let the post-login screen mount first (FCM token fetch is heavy)
const CHANNELS = [
    // Same ids the source apps' server payloads use, so closed-app notifications land in a channel.
    { id: 'akk_updates', name: 'AKK Hub updates', description: 'Shifts, leave, materials and site work' },
    { id: 'spt_updates', name: 'Site work updates', description: 'Photo packages and approvals' },
];

let listenersReady = false;
let navigator = null;
let pendingPath = null;
let registerGen = 0;
let pendingMaterialsPassword = null;
let lastRegisteredKey = '';

const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications');
export const pushEnabled = () =>
    native() && String(import.meta.env.VITE_ENABLE_FCM_REGISTER || '').toLowerCase() === 'true';

const delay = (ms) => new Promise((r) => window.setTimeout(r, ms));
const quiet = (label) => (e) => console.warn(`[push] ${label}`, e?.message || e);

function storedToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}
function storeToken(token) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        /* ignore */
    }
}

/* ------------------------------------------------------------------ */
/* Taps → screens                                                      */
/* ------------------------------------------------------------------ */

/** Only in-app destinations; never open URLs from a payload. */
function safePath(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || /^[a-z]+:/i.test(value) || value.startsWith('//')) return null;
    const path = legacyPath(value.replace(/^#/, ''));
    return path.startsWith('/') ? path : null;
}

function openPath(path) {
    if (!path) return;
    if (navigator) navigator(path);
    else pendingPath = path;
}

/** HubLayout / app root registers the router's navigate; replays a cold-start tap. */
export function setPushNavigator(fn) {
    navigator = fn || null;
    if (navigator && pendingPath) {
        const path = pendingPath;
        pendingPath = null;
        navigator(path);
    }
}

async function foregroundToast(notification) {
    const title = notification?.title || notification?.data?.title;
    const body = notification?.body || notification?.data?.body;
    if (!title && !body) return;
    try {
        const { toast } = await import('sonner');
        const path = safePath(notification?.data?.path);
        toast(title || 'AKK Hub', {
            description: body || undefined,
            action: path ? { label: 'Open', onClick: () => openPath(path) } : undefined,
        });
    } catch {
        /* ignore */
    }
}

/** Call once at app boot (main.jsx). Attaches tap / foreground listeners and the channels. */
export async function initPush() {
    if (!native() || listenersReady) return;
    listenersReady = true;
    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        for (const channel of CHANNELS) {
            await PushNotifications.createChannel({ importance: 5, visibility: 1, vibration: true, ...channel }).catch(() => {});
        }
        await PushNotifications.addListener('pushNotificationReceived', (n) => void foregroundToast(n));
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const data = action?.notification?.data || {};
            openPath(safePath(data.path || data.route));
        });
    } catch (e) {
        listenersReady = false;
        quiet('listeners')(e);
    }
}

/* ------------------------------------------------------------------ */
/* Registration per back-end                                           */
/* ------------------------------------------------------------------ */

async function registerTimesheet(token, identity) {
    const body = { fcm_token: token, worker_id: null, admin_email: null, manager_email: null, platform: 'android' };
    if (identity.role === 'worker') body.worker_id = String(identity.id || '').trim();
    else if (identity.role === 'manager') body.manager_email = String(identity.email || identity.id || '').toLowerCase();
    else if (identity.role === 'admin') body.admin_email = String(identity.email || identity.id || '').toLowerCase();
    else return; // supervisors: the Timesheet push function has no supervisor subject yet
    const headers = {};
    const { getRoleSessionToken } = await import('@/core/auth/timesheetSession');
    const roleSession = getRoleSessionToken();
    if (roleSession) headers['x-akk-role-session'] = roleSession;
    const secret = import.meta.env.VITE_PUSH_REGISTER_SECRET;
    if (secret) headers['x-akk-push-secret'] = secret;
    const { data, error } = await supabaseTimesheet.functions.invoke('register-device-token', { body, headers });
    if (error || data?.error) throw error || new Error(data.error);
}

async function registerProgress(token, identity) {
    const { moduleConnection } = await import('@/core/auth/bridges');
    if (moduleConnection(identity.role, 'progress') !== 'connected') return;
    if (identity.role === 'worker') {
        const { getWorkerSessionToken } = await import('@/core/auth/progress/workerSession');
        const session = getWorkerSessionToken();
        if (!session) return;
        const { error } = await supabaseProgress.rpc('worker_register_device_token', {
            p_session_token: session,
            p_fcm_token: token,
            p_platform: 'android',
        });
        if (error) throw error;
        return;
    }
    const { getManagerSessionToken } = await import('@/core/auth/progress/managerSession');
    const { error } = await supabaseProgress.rpc('staff_register_device_token', {
        p_manager_token: identity.role === 'manager' ? getManagerSessionToken() : null,
        p_fcm_token: token,
        p_platform: 'android',
    });
    if (error) throw error;
}

async function registerMaterials(token, identity) {
    const { moduleConnection } = await import('@/core/auth/bridges');
    if (moduleConnection(identity.role, 'materials') !== 'connected') return;
    const materials = await import('@/core/auth/materialsSession');
    const secret = import.meta.env.VITE_FCM_REGISTER_SECRET;
    const headers = secret ? { 'x-mt-register-secret': secret } : {};
    if (identity.role === 'worker') {
        const worker = materials.getWorkerSession();
        if (!worker?.workerId || !pendingMaterialsPassword) return; // their endpoint needs the password once
        const password = pendingMaterialsPassword;
        pendingMaterialsPassword = null;
        const { data, error } = await supabaseMaterials.functions.invoke('register-device-token', {
            body: { action: 'register', fcm_token: token, platform: 'android', role: 'worker', worker_id: worker.workerId, password },
            headers,
        });
        if (error || data?.error) throw error || new Error(data.error);
        return;
    }
    const staff = await materials.getStaffSession();
    const { data: s } = await supabaseMaterials.auth.getSession();
    if (!staff?.email || !s?.session?.access_token) return;
    const { data, error } = await supabaseMaterials.functions.invoke('register-device-token', {
        body: { action: 'register', fcm_token: token, platform: 'android', role: identity.role, admin_email: staff.email },
        headers: { ...headers, Authorization: `Bearer ${s.session.access_token}` },
    });
    if (error || data?.error) throw error || new Error(data.error);
}

/** Get (or reuse) this phone's FCM token. Resolves null when push is unavailable / declined. */
async function fetchToken() {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return null;

    return new Promise((resolve) => {
        const subs = [];
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            subs.forEach((s) => s?.remove?.().catch?.(() => {}));
            resolve(value);
        };
        const timer = window.setTimeout(() => finish(storedToken()), 20000);
        (async () => {
            subs.push(await PushNotifications.addListener('registration', ({ value }) => finish(value || null)));
            subs.push(
                await PushNotifications.addListener('registrationError', (err) => {
                    quiet('registrationError')(err);
                    finish(null);
                }),
            );
            await PushNotifications.register();
        })().catch((e) => {
            quiet('register')(e);
            finish(null);
        });
    });
}

/**
 * Register this phone for the signed-in person. Safe to call often (after login, on app start,
 * after linking a module); newer calls supersede older ones and repeats are skipped.
 * @param {{role: string, id?: string, email?: string}} [identity] defaults to the current hub identity
 */
export async function registerPushDevice(identity) {
    if (!pushEnabled()) return false;
    const gen = ++registerGen;
    await delay(REGISTER_DELAY_MS);
    if (gen !== registerGen) return false;
    try {
        const who = identity || (await import('@/core/auth/identity')).getIdentity();
        if (!who?.role) return false;
        await initPush();
        const token = await fetchToken();
        if (!token || gen !== registerGen) return false;
        storeToken(token);

        const { moduleConnection } = await import('@/core/auth/bridges');
        const key = [token, who.role, who.id, moduleConnection(who.role, 'materials'), moduleConnection(who.role, 'progress'), !!pendingMaterialsPassword].join('|');
        if (key === lastRegisteredKey) return true;

        const results = await Promise.allSettled([
            registerTimesheet(token, who),
            registerProgress(token, who),
            registerMaterials(token, who),
        ]);
        results.forEach((r, i) => r.status === 'rejected' && quiet(['attendance', 'site work', 'materials'][i])(r.reason));
        lastRegisteredKey = key;
        return results.some((r) => r.status === 'fulfilled');
    } catch (e) {
        quiet('registerPushDevice')(e);
        return false;
    }
}

/** Sign-out: stop this phone receiving the person's notifications (best effort, every back-end). */
export async function unregisterPushDevice() {
    registerGen += 1;
    lastRegisteredKey = '';
    pendingMaterialsPassword = null;
    if (!native()) return false;
    const token = storedToken();
    storeToken(null);
    if (!token) return false;
    const tasks = [
        supabaseTimesheet.functions.invoke('register-device-token', { body: { unregister_token: token } }),
        supabaseMaterials.functions.invoke('register-device-token', { body: { action: 'unregister', fcm_token: token } }),
        (async () => {
            const { getWorkerSessionToken } = await import('@/core/auth/progress/workerSession');
            const session = getWorkerSessionToken();
            if (session) {
                return supabaseProgress.rpc('worker_unregister_device_token', { p_session_token: session, p_fcm_token: token });
            }
            const { portalManagerToken } = await import('@/core/auth/progress/portalAuth');
            return supabaseProgress.rpc('staff_unregister_device_token', { p_manager_token: portalManagerToken(), p_fcm_token: token });
        })(),
    ];
    await Promise.allSettled(tasks);
    return true;
}

/** Materials' worker endpoint needs the password once; ConnectForm / auto-link hand it over in memory. */
export function setPendingWorkerPassword(password) {
    pendingMaterialsPassword = password || null;
}

/** Old names used by ported module code. */
export const unregisterPushToken = unregisterPushDevice;
export const registerPushForCurrentSession = () => registerPushDevice();
export function schedulePushRegistrationAfterLogin() {
    void registerPushDevice();
}
