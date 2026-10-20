/**
 * AKK Hub app intro — a short brand film played once per app launch (Capacitor app, or the
 * ?app=1 preview). Never on the website.
 *
 * The real app renders underneath from the first frame, so routing, the auth check and the first
 * data loads happen while this plays. The native Android launch screen is the intro's first frame
 * (same deep crimson, no icon), so there's no flash between them.
 *
 *   0 ms     solid crimson (= native launch screen) → the hero gradient and a soft light bloom
 *            fade up
 *   150 ms   logo tile: blur → sharp, small scale-up, then a light sweep across it
 *   550 ms   "AKK Hub" rises in, then "AKK Engineering"
 *   1150 ms  brand moment: the composition breathes very slightly
 *   ≥1500 ms exit as soon as the screen behind is ready (never later than MAX_WAIT_MS)
 *
 * Exit, chosen from what's on screen:
 *   app Home (signed out) — the crimson shrinks into the Home header (identical gradient) while the
 *     logo tile and name glide into their exact places there, then the Home cards rise in.
 *   anything else (signed in) — the crimson lifts away upwards while the logo settles back,
 *     revealing the role home.
 * Reduced motion: a plain 200 ms cross-fade, no movement.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hideNativeCapacitorSplash, setNativeSystemBarsSurface } from '@/core/nativeShell';
import { isLoginCurtainOpen } from '@/core/auth/loginCurtain';
import './intro.css';

const MIN_MS = 1500; // the film itself
const SLOW_MS = 2300; // still not ready: show the quiet loading line
const MAX_WAIT_MS = 6000; // never hold the person longer than this
const EXIT_MS = 620;
const PLAYED_KEY = 'akk.hub.introPlayed';

/** Once per launch: sessionStorage lives as long as the WebView (cleared when the app is killed). */
function alreadyPlayed() {
    try {
        return sessionStorage.getItem(PLAYED_KEY) === '1';
    } catch {
        return false;
    }
}
function markPlayed() {
    try {
        sessionStorage.setItem(PLAYED_KEY, '1');
    } catch {
        /* ignore */
    }
}

const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The screen behind has painted something real (not a loader) and its images are in. */
function screenReady() {
    if (isLoginCurtainOpen()) return false;
    const homeLogo = document.querySelector('.hxa-mark img');
    if (homeLogo) return homeLogo.complete;
    return Boolean(document.querySelector('.g-shell .g-topbar, .g-shell .wh-page, .akk-login, .g-auth, .g-page main, .hxa'));
}

/** Rect of `el` relative to the viewport, or null. */
const rectOf = (el) => (el ? el.getBoundingClientRect() : null);

/** Transform that moves/scales `from` onto `to` (both DOMRects), origin top-left. */
function flip(from, to, scale = to.width / from.width) {
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
}

/** Text glides by font-size ratio (the Home name is a full-width block, so widths don't compare). */
function flipText(fromEl, toEl) {
    const ratio = parseFloat(getComputedStyle(toEl).fontSize) / parseFloat(getComputedStyle(fromEl).fontSize);
    return flip(rectOf(fromEl), rectOf(toEl), ratio || 1);
}

export default function AppIntro({ enabled }) {
    const [phase, setPhase] = useState(() => (enabled && !alreadyPlayed() ? 'play' : 'done'));
    const [slow, setSlow] = useState(false);
    const rootRef = useRef(null);
    const tileRef = useRef(null);
    const nameRef = useRef(null);
    const subRef = useRef(null);
    const started = useRef(0);

    // First frame is up → drop the native launch screen (same colour, so nothing visibly changes).
    useLayoutEffect(() => {
        if (phase !== 'play') return;
        started.current = performance.now();
        markPlayed();
        document.documentElement.classList.add('akk-intro-on');
        setNativeSystemBarsSurface('dark');
        hideNativeCapacitorSplash({ force: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Wait for: the film's minimum length AND the screen behind being ready (or the safety cap).
    useEffect(() => {
        if (phase !== 'play') return undefined;
        const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
        // A timer, not requestAnimationFrame: frames pause while the app is in the background, and
        // the safety cap must still fire.
        const poll = window.setInterval(() => {
            // Dev only: sessionStorage 'akk.hub.introHold' = '1' freezes the intro for frame review.
            if (import.meta.env.DEV && sessionStorage.getItem('akk.hub.introHold') === '1') return;
            const elapsed = performance.now() - started.current;
            if ((elapsed >= MIN_MS && screenReady()) || elapsed >= MAX_WAIT_MS) {
                window.clearInterval(poll);
                setPhase('exit');
            }
        }, 50);
        return () => {
            window.clearInterval(poll);
            window.clearTimeout(slowTimer);
        };
    }, [phase]);

    // Exit choreography.
    useLayoutEffect(() => {
        if (phase !== 'exit') return undefined;
        const root = rootRef.current;
        const html = document.documentElement;
        const homeLogo = document.querySelector('.hxa-mark img');
        const homeHero = document.querySelector('.hxa-hero');
        const toHome = Boolean(homeLogo && homeHero) && !reducedMotion();

        if (reducedMotion()) {
            root.dataset.exit = 'fade';
        } else if (toHome) {
            // Shrink the crimson into the Home header and glide the logo / name into their places.
            const hero = rectOf(homeHero);
            root.style.setProperty('--intro-clip-bottom', `${Math.max(0, window.innerHeight - hero.bottom)}px`);
            const tile = tileRef.current;
            const name = nameRef.current;
            const sub = subRef.current;
            tile.style.transform = flip(rectOf(tile), rectOf(homeLogo));
            const homeName = document.querySelector('.hxa-mark__name');
            const homeSub = document.querySelector('.hxa-mark__sub');
            if (homeName) name.style.transform = flipText(name, homeName);
            if (homeSub) sub.style.transform = flipText(sub, homeSub);
            root.dataset.exit = 'home';
        } else {
            root.dataset.exit = 'lift';
        }
        // Let the screen behind start its own entrance just as the curtain opens.
        html.classList.add('akk-intro-leaving');

        const done = window.setTimeout(() => {
            html.classList.remove('akk-intro-on', 'akk-intro-leaving');
            setNativeSystemBarsSurface(toHome ? 'dark' : 'light');
            setPhase('done');
        }, reducedMotion() ? 220 : EXIT_MS);
        return () => window.clearTimeout(done);
    }, [phase]);

    if (phase === 'done') return null;

    return (
        <div ref={rootRef} className="akk-intro" data-phase={phase} data-slow={slow || undefined} aria-hidden="true">
            <div className="akk-intro__bg">
                <div className="akk-intro__glow akk-intro__glow--rose" />
                <div className="akk-intro__glow akk-intro__glow--bronze" />
                <div className="akk-intro__bloom" />
            </div>
            <div className="akk-intro__stage">
                <div className="akk-intro__lockup">
                    {/* Outer elements glide on exit; inner ones play the entrance (a running CSS
                        animation would override the exit transform). */}
                    <div ref={tileRef} className="akk-intro__tile">
                        <div className="akk-intro__tile-in">
                            <img src="/Akk-logo.png" alt="" className="akk-intro__logo" draggable="false" />
                            <span className="akk-intro__sweep" />
                        </div>
                    </div>
                    <p ref={nameRef} className="akk-intro__name">
                        <span className="akk-intro__name-in">AKK Hub</span>
                    </p>
                    <p ref={subRef} className="akk-intro__sub">
                        <span className="akk-intro__sub-in">AKK Engineering</span>
                    </p>
                    <span className="akk-intro__loading" />
                </div>
            </div>
        </div>
    );
}
