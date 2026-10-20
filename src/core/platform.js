import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/** True inside the Android/iOS Capacitor shell — not the website. */
export function isNativeApp() {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

/**
 * App-version preview in a normal browser: open any page with `?app=1` (sticks for the tab,
 * `?app=0` turns it off). Only changes which UI is drawn — native plugins stay off.
 */
const PREVIEW_KEY = 'akk.hub.appPreview';
function readAppPreview() {
    if (typeof window === 'undefined') return false;
    try {
        const q = new URLSearchParams(window.location.search).get('app');
        if (q === '1') sessionStorage.setItem(PREVIEW_KEY, '1');
        if (q === '0') sessionStorage.removeItem(PREVIEW_KEY);
        return sessionStorage.getItem(PREVIEW_KEY) === '1';
    } catch {
        return false;
    }
}
export const APP_PREVIEW = readAppPreview();

/** Draw the app version (Capacitor app, or the ?app=1 preview) instead of the website. */
export function isAppUI() {
    return isNativeApp() || APP_PREVIEW;
}

export function nativePlatform() {
    try {
        return Capacitor.getPlatform();
    } catch {
        return 'web';
    }
}

const NARROW_QUERY = '(max-width: 767px)';

/** Phone width or the native app — use bottom sheets / full-screen flows. */
export function useSheetLayout() {
    const [narrow, setNarrow] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia(NARROW_QUERY).matches;
    });

    useEffect(() => {
        const mq = window.matchMedia(NARROW_QUERY);
        const apply = () => setNarrow(mq.matches);
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, []);

    return isNativeApp() || narrow;
}

/** Desktop layout (≥1024px): sidebar navigation instead of the bottom tab bar. */
export function useWideLayout() {
    const [wide, setWide] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(min-width: 1024px)').matches;
    });
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const apply = () => setWide(mq.matches);
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, []);
    return wide;
}

/* Motion presets shared by all three source apps (kept under the same names). */
export const sheetSpring = { type: 'spring', stiffness: 230, damping: 28, mass: 0.9 };
export const nativeSheetSpring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.62 };
export const easeSoft = { duration: 0.52, ease: [0.22, 1, 0.36, 1] };
export const easeOut = [0.22, 1, 0.36, 1];
