import { useEffect } from 'react';
import { storageKey } from '@/core/storage';
import { Outlet } from 'react-router-dom';

function readWorkerId() {
    try {
        return (localStorage.getItem(storageKey('timesheet', 'workerId')) || '').trim();
    } catch {
        return '';
    }
}

function readWorkerType() {
    try {
        return localStorage.getItem(storageKey('timesheet', 'workerType')) || 'foreign';
    } catch {
        return 'foreign';
    }
}

/**
 * Keeps worker Supabase Realtime + FCM registration alive across WorkerPortal,
 * WorkerTimesheets, LeaveHistory, and ShiftHistory. Without this, leaving the portal unsubscribes
 * and in-app notifications become unreliable until you return.
 */
export default function WorkerNotificationLayout() {
    const workerId = readWorkerId();

    useEffect(() => {
        if (!workerId) return undefined;
        let cancelled = false;
        import('@/modules/timesheet/lib/realtimeSubscriptions').then((m) => {
            if (!cancelled) void m.startWorkerRealtimeNotifications(workerId);
        });
        return () => {
            cancelled = true;
            import('@/modules/timesheet/lib/realtimeSubscriptions').then((m) => m.stopWorkerRealtimeNotifications());
        };
    }, [workerId]);

    useEffect(() => {
        if (!workerId) return undefined;
        import('@/modules/timesheet/lib/pushRegistration')
            .then(({ registerPushForWorker }) => {
                void registerPushForWorker(workerId);
            })
            .catch((e) => console.warn('worker push register', e));
        return undefined;
    }, [workerId]);

    useEffect(() => {
        if (!workerId) return undefined;
        const workerType = readWorkerType();
        let cancelled = false;
        (async () => {
            try {
                const { getActiveJourneyForWorker } = await import('@/modules/timesheet/lib/vehicleService');
                const { resumeVehicleTrackingIfNeeded } = await import('@/modules/timesheet/lib/vehicleTracking');
                if (cancelled) return;
                await resumeVehicleTrackingIfNeeded(() =>
                    getActiveJourneyForWorker(workerId, workerType)
                );
            } catch (e) {
                console.warn('resume vehicle tracking', e);
            }
        })();
        return () => { cancelled = true; };
    }, [workerId]);

    return <Outlet />;
}
