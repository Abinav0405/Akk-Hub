import { Capacitor } from '@capacitor/core';
import { supabaseTimesheet } from '@/core/supabase'
import { SESSION_TOKEN_KEY } from '@/core/auth/timesheetSession';

// SECURITY: VITE_* values ship in the client bundle and are NOT secret.
// VITE_PUSH_REGISTER_SECRET is an optional soft rate-gate only. Real auth is:
// - admin: Supabase Auth JWT (attached automatically by supabaseTimesheet.functions.invoke)
// - worker/manager: x-akk-role-session (role_sessions UUID) matching the body subject
const registerSecret = import.meta.env.VITE_PUSH_REGISTER_SECRET;

let cachedFcmToken = null;
let actionListenerReady = false;

let registerChain = Promise.resolve();

function buildAuthHeaders() {
    const headers = {};
    if (registerSecret) {
        headers['x-akk-push-secret'] = registerSecret;
    }
    try {
        const roleSession = localStorage.getItem(SESSION_TOKEN_KEY);
        if (roleSession) {
            headers['x-akk-role-session'] = roleSession;
        }
    } catch {
        /* ignore */
    }
    return headers;
}

async function showForegroundPushToast(title, body) {
    try {
        const { toast } = await import('sonner');
        toast(title || 'Notification', { description: body || undefined });
    } catch {
        /* ignore */
    }
}

async function ensurePushActionListener() {
    if (!Capacitor.isNativePlatform() || actionListenerReady) return;
    if (!Capacitor.isPluginAvailable('PushNotifications')) return;
    actionListenerReady = true;
    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.addListener('pushNotificationReceived', (event) => {
            const title = event.notification?.title;
            const body = event.notification?.body;
            if (title || body) {
                void showForegroundPushToast(title, body);
            }
        });
        await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
            const path = event.notification?.data?.path;
            if (typeof path === 'string' && path.startsWith('/') && typeof window.__akkNavigatePush === 'function') {
                window.__akkNavigatePush(path);
            }
        });
    } catch (e) {
        actionListenerReady = false;
        console.warn('push listeners', e);
    }
}

/** Run on native app boot (e.g. from `main.jsx`) so cold-start notification taps route once `__akkNavigatePush` exists. */
export async function ensurePushTapListener() {
    try {
        await ensurePushActionListener();
    } catch (e) {
        console.warn('ensurePushTapListener', e);
    }
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runRegisterJob(buildBody) {
    if (!Capacitor.isNativePlatform()) return;
    if (!Capacitor.isPluginAvailable('PushNotifications')) return;

    // Let login navigation + dashboard mount finish first. FCM token fetch has
    // historically crashed some Android builds when called immediately after login.
    await delay(2500);

    try {
        await ensurePushActionListener();
        const { PushNotifications } = await import('@capacitor/push-notifications');

        const perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
            const req = await PushNotifications.requestPermissions();
            if (req.receive !== 'granted') return;
        }

        await new Promise((resolve) => {
            let finished = false;
            const done = () => {
                if (!finished) {
                    finished = true;
                    resolve();
                }
            };
            let regSub;
            let errSub;

            const cleanup = async () => {
                try {
                    await regSub?.remove?.();
                } catch {
                    /* ignore */
                }
                try {
                    await errSub?.remove?.();
                } catch {
                    /* ignore */
                }
            };

            const timeout = window.setTimeout(async () => {
                await cleanup();
                done();
            }, 22000);

            (async () => {
                try {
                    regSub = await PushNotifications.addListener('registration', async ({ value }) => {
                        window.clearTimeout(timeout);
                        cachedFcmToken = value;
                        try {
                            const { data, error } = await supabaseTimesheet.functions.invoke('register-device-token', {
                                body: buildBody(value),
                                headers: buildAuthHeaders(),
                            });
                            if (error) {
                                console.warn('register-device-token', error);
                            } else if (data?.error) {
                                console.warn('register-device-token rejected', data.error);
                            } else {
                                console.info('register-device-token ok');
                            }
                        } catch (e) {
                            console.warn('register-device-token invoke', e);
                        } finally {
                            await cleanup();
                            done();
                        }
                    });

                    errSub = await PushNotifications.addListener('registrationError', async (err) => {
                        console.warn('FCM registrationError', err);
                        window.clearTimeout(timeout);
                        await cleanup();
                        done();
                    });

                    // FCM token fetch can hard-crash some Android WebViews / Firebase
                    // builds (null exception NPE in Capacitor plugin). Defer enabling
                    // until the patched native plugin ships in a new APK.
                    const enableFcmRegister = import.meta.env.VITE_ENABLE_FCM_REGISTER === 'true';
                    if (!enableFcmRegister) {
                        console.info('FCM register skipped (set VITE_ENABLE_FCM_REGISTER=true after native patch)');
                        window.clearTimeout(timeout);
                        await cleanup();
                        done();
                        return;
                    }

                    await PushNotifications.register();
                } catch (e) {
                    console.warn('PushNotifications.register failed', e);
                    window.clearTimeout(timeout);
                    await cleanup();
                    done();
                }
            })();
        });
    } catch (e) {
        console.warn('runRegisterJob', e);
    }
}

function enqueueRegister(buildBody) {
    registerChain = registerChain
        .then(() => runRegisterJob(buildBody))
        .catch((e) => {
            console.warn('push register chain', e);
        });
    return registerChain;
}

export function registerPushForWorker(workerId) {
    if (!workerId) return Promise.resolve();
    const id = String(workerId).trim();
    if (!id) return Promise.resolve();
    return enqueueRegister((token) => ({
        fcm_token: token,
        worker_id: id,
        admin_email: null,
        manager_email: null,
        platform: Capacitor.getPlatform(),
    }));
}

export function registerPushForAdmin(adminEmail) {
    if (!adminEmail) return Promise.resolve();
    const email = String(adminEmail).trim().toLowerCase();
    if (!email) return Promise.resolve();
    return enqueueRegister((token) => ({
        fcm_token: token,
        worker_id: null,
        admin_email: email,
        manager_email: null,
        platform: Capacitor.getPlatform(),
    }));
}

export function registerPushForManager(managerEmail) {
    if (!managerEmail) return Promise.resolve();
    const email = String(managerEmail).trim().toLowerCase();
    if (!email) return Promise.resolve();
    return enqueueRegister((token) => ({
        fcm_token: token,
        worker_id: null,
        admin_email: null,
        manager_email: email,
        platform: Capacitor.getPlatform(),
    }));
}

export async function unregisterPushDevice() {
    if (!Capacitor.isNativePlatform() || !cachedFcmToken) return;
    const token = cachedFcmToken;
    cachedFcmToken = null;
    try {
        const { error } = await supabaseTimesheet.functions.invoke('register-device-token', {
            body: { unregister_token: token },
            headers: buildAuthHeaders(),
        });
        if (error) console.warn('unregister push token', error);
    } catch (e) {
        console.warn('unregister push invoke', e);
    }
}
