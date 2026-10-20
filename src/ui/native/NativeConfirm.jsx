/**
 * Promise-based confirmation sheet (Timesheet NativeConfirm API), used on web and native.
 *
 *   const ok = await confirmAction({ title, message, detail?, confirmLabel?, cancelLabel?, destructive? });
 *
 * `NativeConfirmHost` is mounted once at the app root. If it isn't mounted (tests, isolated
 * renders) this falls back to window.confirm. The dialog itself (NativeConfirmSheet) loads on
 * the first request and then stays mounted so it can animate open and closed.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';

const NativeConfirmSheet = lazy(() => import('@/ui/native/NativeConfirmSheet'));

let presentConfirm = null;

export function confirmAction(options) {
    const { title, message } = options || {};
    if (!presentConfirm) return Promise.resolve(window.confirm(message || title || 'Are you sure?'));
    return new Promise((resolve) => presentConfirm({ ...options, resolve }));
}

export function NativeConfirmHost() {
    const [request, setRequest] = useState(null);
    const [used, setUsed] = useState(false);
    const requestRef = useRef(null);

    useEffect(() => {
        presentConfirm = (next) => {
            requestRef.current?.resolve(false);
            requestRef.current = next;
            setUsed(true);
            setRequest(next);
        };
        return () => {
            presentConfirm = null;
        };
    }, []);

    const settle = (result) => {
        const current = requestRef.current;
        requestRef.current = null;
        setRequest(null);
        current?.resolve(result);
    };

    if (!used) return null;
    return (
        <Suspense fallback={null}>
            <NativeConfirmSheet request={request} onSettle={settle} />
        </Suspense>
    );
}

/** Material Tracker name for the same host. */
export const NativeDialogHost = NativeConfirmHost;
export default NativeConfirmHost;
