import { useEffect, useRef } from 'react';

/**
 * "Smart heartbeat" — polls a cheap head value (e.g. the newest updated_at
 * timestamp) on an interval and only calls onChange() when it actually moved,
 * instead of unconditionally refetching a full list every tick. Mirrors
 * AKK-Timesheet-Manager-main's smartPolling.js pattern.
 *
 * headRef is compared with a plain ref (not state) so the interval doesn't
 * get torn down/recreated on every change.
 */
export function useHeartbeat({ enabled = true, intervalMs = 5000, paused = false, queryFn, onChange }) {
    const headRef = useRef(null);

    const initializedRef = useRef(false);

    // Read via a ref (not a dependency) so pausing/resuming doesn't tear down and
    // reinitialize the interval — that used to reset headRef/initializedRef on every
    // pause toggle, making the first tick after resuming silently re-baseline instead
    // of reporting a real change that happened while paused.
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    const queryFnRef = useRef(queryFn);
    queryFnRef.current = queryFn;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!enabled) return undefined;
        headRef.current = null;
        initializedRef.current = false;

        const tick = async () => {
            if (pausedRef.current) return;
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const head = await queryFnRef.current();
                const headStr = head ? String(head) : null;
                const isFirstCheck = !initializedRef.current;
                initializedRef.current = true;
                if (headStr !== headRef.current) {
                    headRef.current = headStr;
                    if (!isFirstCheck) onChangeRef.current();
                }
            } catch {
                /* transient network errors shouldn't spam the UI — just skip this tick */
            }
        };

        const onVisibility = () => {
            if (!document.hidden) void tick();
        };

        const id = setInterval(tick, intervalMs);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, intervalMs]);
}
