/**
 * Native (Capacitor) presentation shell — merged from the three source apps
 * (Timesheet nativeShell.js, SPT nativeBack.js / nativeBootstrap.js, Materials nativeBootstrap.js).
 *
 * Everything is a no-op on the website.
 *   - html.akk-native / data-platform classes the CSS keys off
 *   - keyboard awareness (html.akk-kb-open, --akk-kb)
 *   - status / system bar style for light or dark screens
 *   - one Android hardware-back stack shared by every module
 */
import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { APP_PREVIEW, isNativeApp } from '@/core/platform';

const KEYBOARD_THRESHOLD_PX = 120;
let shellReady = null;

function isEditable(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(type);
}

function trackKeyboard(root) {
    const vv = window.visualViewport;
    let baseHeight = window.innerHeight;
    let frame = 0;

    const update = () => {
        frame = 0;
        const layoutHeight = window.innerHeight;
        if (layoutHeight > baseHeight) baseHeight = layoutHeight;
        const overlay = vv ? Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop)) : 0;
        const shrunk = baseHeight - layoutHeight;
        const open =
            isEditable(document.activeElement) &&
            (overlay > KEYBOARD_THRESHOLD_PX || shrunk > KEYBOARD_THRESHOLD_PX);
        root.style.setProperty('--akk-kb', `${open ? overlay : 0}px`);
        root.classList.toggle('akk-kb-open', open);
    };
    const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
    };

    vv?.addEventListener('resize', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', () => window.setTimeout(schedule, 60));
    window.addEventListener('orientationchange', () => {
        window.setTimeout(() => {
            baseHeight = window.innerHeight;
            schedule();
        }, 350);
    });

    document.addEventListener('focusin', (event) => {
        const el = event.target;
        if (!isEditable(el) || typeof el.scrollIntoView !== 'function') return;
        window.setTimeout(() => {
            if (document.activeElement !== el) return;
            const rect = el.getBoundingClientRect();
            const visibleBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
            if (rect.bottom > visibleBottom - 24 || rect.top < 64) {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }, 320);
    });
}

function readSafeTopPx() {
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
        'padding-top:max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px));';
    document.body.appendChild(probe);
    const px = parseFloat(window.getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    return px;
}

let systemBarsSurface = 'light';
let edgeToEdge = false;

function applySystemBarsStyle() {
    if (!edgeToEdge) return;
    const style = systemBarsSurface === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
    void SystemBars?.setStyle?.({ style })?.catch?.(() => {});
}

function detectEdgeToEdge() {
    const next = readSafeTopPx() > 0;
    if (next === edgeToEdge) return;
    edgeToEdge = next;
    applySystemBarsStyle();
}

/** 'dark' surface behind the bars → light icons; 'light' → dark icons. */
export function setNativeSystemBarsSurface(surface) {
    if (!isNativeApp()) return;
    systemBarsSurface = surface === 'dark' ? 'dark' : 'light';
    applySystemBarsStyle();
}

/** SPT / Materials names for the same thing (kept for ported code). */
export async function setStatusBarLight() {
    setNativeSystemBarsSurface('light');
}
export async function setStatusBarDark() {
    setNativeSystemBarsSurface('dark');
}

let splashHidden = false;
export function hideNativeCapacitorSplash({ fadeOutDuration = 0, force = false } = {}) {
    if (!isNativeApp()) return;
    if (splashHidden && !force) return;
    splashHidden = true;
    const run = () => {
        if (!Capacitor.isPluginAvailable('SplashScreen')) return;
        void import('@capacitor/splash-screen')
            .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration }))
            .catch(() => {});
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
}

/** Call once before the first render. */
export function initNativeShell() {
    if (!isNativeApp()) {
        // Browser preview of the app version: same html classes, no native plugins.
        if (APP_PREVIEW) {
            document.documentElement.classList.add('akk-native', 'akk-app-preview');
            trackKeyboard(document.documentElement);
        }
        return Promise.resolve(false);
    }
    if (shellReady) return shellReady;

    const root = document.documentElement;
    root.classList.add('akk-native');
    root.dataset.platform = Capacitor.getPlatform();
    if (Capacitor.getPlatform() === 'android') root.classList.add('akk-android');

    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !/interactive-widget/.test(viewport.content)) {
        viewport.setAttribute('content', `${viewport.content}, interactive-widget=resizes-content`);
    }

    trackKeyboard(root);
    const runBarsDetection = () => {
        detectEdgeToEdge();
        window.setTimeout(detectEdgeToEdge, 400);
        window.setTimeout(detectEdgeToEdge, 1500);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runBarsDetection, { once: true });
    } else {
        runBarsDetection();
    }
    window.addEventListener('resize', detectEdgeToEdge);
    window.setTimeout(() => hideNativeCapacitorSplash({ force: true }), 4500);

    installNativeBackListener();
    shellReady = Promise.resolve(true);
    return shellReady;
}

/** Materials / SPT entry point name. */
export const bootstrapNativeShell = initNativeShell;

/* ------------------------------------------------------------------ */
/* Android hardware back: one stack for the whole hub.                 */
/* Handlers return true when they consumed the press (close a sheet,   */
/* a scanner, go back a tab…).                                         */
/* ------------------------------------------------------------------ */

const backHandlers = [];

export function registerNativeBackHandler(handler) {
    backHandlers.push(handler);
    return () => {
        const i = backHandlers.lastIndexOf(handler);
        if (i >= 0) backHandlers.splice(i, 1);
    };
}

/** SPT name for the same stack. */
export const pushNativeBackHandler = registerNativeBackHandler;

export function runNativeBackHandlers() {
    for (let i = backHandlers.length - 1; i >= 0; i -= 1) {
        try {
            if (backHandlers[i]() === true) return true;
        } catch {
            /* ignore a broken handler */
        }
    }
    return false;
}

/** Close the top-most Radix dialog / select / popover (they all dismiss on Escape). */
export function dismissTopLayer() {
    const open = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]',
    );
    if (!open) return false;
    const target = document.activeElement && open.contains(document.activeElement) ? document.activeElement : open;
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }),
    );
    return true;
}

let backListenerInstalled = false;
export function installNativeBackListener() {
    if (!isNativeApp() || backListenerInstalled) return () => {};
    backListenerInstalled = true;
    let handle;
    App.addListener('backButton', ({ canGoBack }) => {
        if (runNativeBackHandlers()) return;
        if (dismissTopLayer()) return;
        if (canGoBack && window.history.length > 1 && window.location.pathname !== '/') {
            window.history.back();
            return;
        }
        App.exitApp();
    }).then((h) => {
        handle = h;
    });
    return () => handle?.remove();
}
