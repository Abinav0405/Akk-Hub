/**
 * Sends a browser notification when a new shift is recorded
 * @param {Object} shift - The shift data
 */
export function sendBrowserNotification(shift) {
    try {
        // Check if browser supports notifications
        if (!("Notification" in window)) {
            console.warn("This browser does not support desktop notification");
            return;
        }

        if (Notification.permission === "granted") {
            showNotification(shift);
        }
    } catch (error) {
        console.error('Error sending browser notification:', error);
    }
}

/**
 * Shows the actual browser notification
 */
function showNotification(shift) {
    const title = `New Shift Recorded`;
    const body = `${shift.worker_name} (ID: ${shift.worker_id})\n${shift.site_name}\n${shift.action || 'Clocked In'}`;

    const notification = new Notification(title, {
        body: body,
        icon: '/akk logo.jpg', // Your logo
        badge: '/akk logo.jpg',
        tag: `shift-${shift.id}`, // Prevents duplicate notifications
        requireInteraction: false,
        silent: false
    });

    // Optional: Click handler to focus the window
    notification.onclick = () => {
        window.focus();
        notification.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => {
        notification.close();
    }, 5000);
}
