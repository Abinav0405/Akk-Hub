import { Capacitor } from '@capacitor/core';

/**
 * Sends a browser notification when a new request is created.
 * No-ops on Capacitor native (Web Notification API is unreliable / not wired for push).
 */
export function sendBrowserNotification(transaction) {
    try {
        if (Capacitor.isNativePlatform()) return;

        if (!('Notification' in window)) {
            return;
        }

        if (Notification.permission === 'granted') {
            showNotification(transaction);
        } else if (Notification.permission === 'default') {
            Notification.requestPermission()
                .then((permission) => {
                    if (permission === 'granted') {
                        showNotification(transaction);
                    }
                })
                .catch(() => {
                    /* denied or unsupported — ignore */
                });
        }
    } catch (error) {
        console.error('Error sending browser notification:', error);
    }
}

/**
 * Request permission once (web only). Never throws.
 */
export function requestBrowserNotificationPermission() {
    try {
        if (Capacitor.isNativePlatform()) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') return;
        Notification.requestPermission().catch(() => {});
    } catch {
        /* ignore */
    }
}

function showNotification(transaction) {
    if (!transaction) return;

    try {
        const materialsCount = transaction.materials?.length || 0;
        const materialsText =
            transaction.materials
                ?.slice(0, 2)
                .map((m) => `${m?.name || 'Material'} (${m?.quantity ?? 0} ${m?.unit || ''})`.trim())
                .join(', ') || '';
        const moreMaterials = materialsCount > 2 ? ` and ${materialsCount - 2} more` : '';

        const kind = transaction.transaction_type === 'take' ? 'Take' : 'Return';
        const title = `New ${kind} Request`;
        const workerName = transaction.worker_name || 'Worker';
        const workerId = transaction.worker_id || '—';
        const body = `${workerName} (ID: ${workerId})\n${materialsText}${moreMaterials}`;

        const notification = new Notification(title, {
            body: body,
            icon: '/Akk-logo.jpg',
            badge: '/Akk-logo.jpg',
            tag: `request-${transaction.id}`,
            requireInteraction: false,
            silent: false,
        });

        notification.onclick = () => {
            try {
                window.focus();
            } catch {
                /* ignore */
            }
            notification.close();
        };

        setTimeout(() => {
            try {
                notification.close();
            } catch {
                /* ignore */
            }
        }, 5000);
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}
