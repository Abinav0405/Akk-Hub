/**
 * Employee tab bar: the centre Scan button.
 *
 *   PRESS & HOLD → water ripples pulse out across the screen
 *   DRAG UP      → the button follows the finger, a crimson "portal" grows from it
 *   PAST THE LINE (THRESHOLD px) → the portal fills the screen and the scanner opens
 *   RELEASE EARLY → everything springs back
 *
 * A plain tap never opens the scanner (it shows a short "Hold & drag up" hint). Keyboard
 * Enter / Space opens it directly. The scanner is the existing clock-in / break / clock-out
 * flow on the employee home (/me?scan=1) — opening it never clocks anyone in by itself.
 *
 * Gesture state lives in refs and every frame is written straight to transforms / opacity
 * (no React render per pointer move, at most one write per animation frame), so it stays smooth
 * on mid-range Android phones. See ScanWave for what the wave avoids.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNativeApp } from '@/core/platform';

export const SCAN_PATH = '/me?scan=1';
const THRESHOLD = 120; // px of upward drag that opens the scanner
const HOLD_MS = 160; // press this long (or start dragging up) to engage
const MAX_LIFT = 74; // how far the button itself follows the finger

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

async function haptic(kind) {
    if (!isNativeApp()) {
        try {
            navigator.vibrate?.(kind === 'heavy' ? 18 : 8);
        } catch {
            /* ignore */
        }
        return;
    }
    try {
        await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Medium : ImpactStyle.Light });
    } catch {
        /* no haptics */
    }
}

/** Circle radius that covers the whole viewport from (x, y). */
function coverRadius(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}

/**
 * The full-screen wave layer. Driven imperatively by ScanButton:
 *   begin(x, y) · hold() · progress(p) · commit(onCovered) · cancel() · end()
 *
 * Built to stay at 60 fps on mid-range Android WebViews:
 *   - the page underneath is never transformed (it is full of blur / glass layers); a flat dim
 *     layer fades over it instead
 *   - the portal is a small solid circle (FILL px) rasterised once and scaled on the GPU
 *   - only transform / opacity change per frame, written straight to the few elements that move
 *   - while the gesture runs, html.akk-scanning switches the tab bar's backdrop blur off (it sits
 *     over the moving wave and would otherwise be re-blurred every frame)
 */
const FILL = 160; // portal circle diameter before scaling

export const ScanWave = forwardRef(function ScanWave(_, ref) {
    const rootRef = useRef(null);
    const dimRef = useRef(null);
    const fillRef = useRef(null);
    const frameRef = useRef(null);
    const labelRef = useRef(null);
    const geo = useRef({ x: 0, y: 0, cover: 1 });
    const timers = useRef([]);

    const later = (fn, ms) => timers.current.push(window.setTimeout(fn, ms));
    const clearTimers = () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
    };
    const scanning = (on) => document.documentElement.classList.toggle('akk-scanning', on);
    useEffect(
        () => () => {
            clearTimers();
            scanning(false);
        },
        [],
    );

    const set = (el, transform, opacity, transition = 'none') => {
        if (!el) return;
        el.style.transition = transition;
        if (transform != null) el.style.transform = transform;
        if (opacity != null) el.style.opacity = String(opacity);
    };

    useImperativeHandle(ref, () => ({
        begin(x, y) {
            clearTimers();
            const root = rootRef.current;
            if (!root) return;
            geo.current = { x, y, cover: (coverRadius(x, y) * 2) / FILL + 0.1 };
            root.style.setProperty('--wx', `${x}px`);
            root.style.setProperty('--wy', `${y}px`);
            root.dataset.state = 'press';
            root.dataset.armed = 'false';
            scanning(true);
            set(dimRef.current, null, 0);
            set(fillRef.current, 'translate3d(-50%, -50%, 0) scale(0)', 1);
            set(frameRef.current, 'translate3d(-50%, -50%, 0) scale(0.4)', 0);
            set(labelRef.current, 'translate3d(-50%, 8px, 0)', 0);
        },
        hold() {
            if (rootRef.current) rootRef.current.dataset.state = 'hold';
        },
        /** p: 0 → 1 (threshold). */
        progress(p) {
            const k = Math.min(Math.max(p, 0), 1);
            // Grows to ~45% of the screen at the threshold; the rest happens on commit.
            const scale = 0.45 + k * Math.min(geo.current.cover * 0.42, 3.4);
            set(fillRef.current, `translate3d(-50%, -50%, 0) scale(${scale})`);
            set(frameRef.current, `translate3d(-50%, -50%, 0) scale(${0.4 + k * 0.6})`, Math.max(0, k * 1.3 - 0.3));
            set(labelRef.current, `translate3d(-50%, ${8 - k * 8}px, 0)`, Math.max(0, k * 2 - 0.6));
            set(dimRef.current, null, k * 0.28);
            if (rootRef.current) rootRef.current.dataset.armed = k >= 1 ? 'true' : 'false';
        },
        /** Fill the screen, call onCovered once it is (navigate there), then reveal. */
        commit(onCovered) {
            const root = rootRef.current;
            if (!root) return;
            root.dataset.state = 'commit';
            const quick = reducedMotion();
            const ease = 'cubic-bezier(0.2, 0.85, 0.25, 1)';
            set(fillRef.current, `translate3d(-50%, -50%, 0) scale(${geo.current.cover})`, 1, quick ? 'none' : `transform 420ms ${ease}`);
            set(frameRef.current, 'translate3d(-50%, -50%, 0) scale(1)', 1, `transform 420ms ${ease}, opacity 200ms ease-out`);
            if (labelRef.current) labelRef.current.textContent = 'Opening scanner…';
            set(labelRef.current, 'translate3d(-50%, 0, 0)', 1, 'opacity 200ms ease-out');
            later(() => onCovered?.(), quick ? 40 : 360);
            later(() => {
                root.dataset.state = 'reveal';
                const fade = 'opacity 380ms cubic-bezier(0.22, 0.8, 0.24, 1)';
                set(fillRef.current, null, 0, fade);
                set(frameRef.current, null, 0, fade);
                set(labelRef.current, null, 0, fade);
                set(dimRef.current, null, 0, fade);
            }, quick ? 100 : 600);
            later(() => this.end(), quick ? 360 : 1000);
        },
        cancel() {
            const root = rootRef.current;
            if (!root) return;
            root.dataset.state = 'cancel';
            const back = 'transform 300ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity 260ms ease-out';
            set(fillRef.current, 'translate3d(-50%, -50%, 0) scale(0)', null, back);
            set(frameRef.current, 'translate3d(-50%, -50%, 0) scale(0.4)', 0, back);
            set(labelRef.current, null, 0, back);
            set(dimRef.current, null, 0, back);
            later(() => this.end(), 320);
        },
        end() {
            clearTimers();
            const root = rootRef.current;
            if (root) {
                root.dataset.state = 'idle';
                root.dataset.armed = 'false';
            }
            if (labelRef.current) labelRef.current.textContent = 'Drag up to scan';
            scanning(false);
        },
    }));

    return createPortal(
        <div ref={rootRef} className="g-scanwave" data-state="idle" aria-hidden="true">
            <span ref={dimRef} className="g-scanwave__dim" />
            <span className="g-scanwave__ring g-scanwave__ring--1" />
            <span className="g-scanwave__ring g-scanwave__ring--2" />
            <span ref={fillRef} className="g-scanwave__fill" />
            <span ref={frameRef} className="g-scanwave__frame">
                <ScanLine strokeWidth={1.6} />
            </span>
            <p ref={labelRef} className="g-scanwave__label">
                Drag up to scan
            </p>
        </div>,
        document.body,
    );
});

export default function ScanButton({ onOpen, label = 'Scan', threshold = THRESHOLD }) {
    const navigate = useNavigate();
    const btnRef = useRef(null);
    const waveRef = useRef(null);
    const g = useRef({ state: 'idle', id: null, x: 0, y: 0, cx: 0, cy: 0, holdTimer: 0, raf: 0, lastDy: 0, armed: false });
    const [hint, setHint] = useState(false);
    const hintTimer = useRef(0);

    const open = useCallback(() => {
        if (onOpen) onOpen();
        else navigate(SCAN_PATH);
    }, [navigate, onOpen]);

    const setButton = (lift, scale, transition = 'none') => {
        const el = btnRef.current;
        if (!el) return;
        el.style.transition = transition;
        el.style.transform = `translate3d(0, ${-lift}px, 0) scale(${scale})`;
    };

    const finish = useCallback(() => {
        const s = g.current;
        window.clearTimeout(s.holdTimer);
        window.cancelAnimationFrame(s.raf);
        s.state = 'idle';
        s.id = null;
        s.armed = false;
        if (btnRef.current) btnRef.current.dataset.state = 'idle';
    }, []);

    useEffect(
        () => () => {
            finish();
            window.clearTimeout(hintTimer.current);
            waveRef.current?.end();
        },
        [finish],
    );

    const engage = () => {
        const s = g.current;
        if (s.state !== 'pressed') return;
        s.state = 'holding';
        if (btnRef.current) btnRef.current.dataset.state = 'holding';
        waveRef.current?.hold();
        void haptic('light');
    };

    const commit = () => {
        const s = g.current;
        if (s.state === 'committing') return;
        s.state = 'committing';
        window.clearTimeout(s.holdTimer);
        if (btnRef.current) btnRef.current.dataset.state = 'committing';
        void haptic('heavy');
        setButton(0, 1, 'transform 420ms cubic-bezier(0.22, 0.8, 0.24, 1)');
        waveRef.current?.commit(() => {
            open();
            finish();
        });
    };

    const onPointerDown = (e) => {
        const s = g.current;
        if (s.state !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const rect = btnRef.current.getBoundingClientRect();
        s.state = 'pressed';
        s.id = e.pointerId;
        s.x = e.clientX;
        s.y = e.clientY;
        s.cx = rect.left + rect.width / 2;
        s.cy = rect.top + rect.height / 2;
        s.lastDy = 0;
        s.armed = false;
        try {
            btnRef.current.setPointerCapture?.(e.pointerId);
        } catch {
            /* pointer already gone — moves still arrive while over the button */
        }
        btnRef.current.dataset.state = 'pressed';
        setButton(0, 0.92, 'transform 140ms cubic-bezier(0.22, 0.8, 0.24, 1)');
        waveRef.current?.begin(s.cx, s.cy);
        s.holdTimer = window.setTimeout(engage, HOLD_MS);
    };

    const onPointerMove = (e) => {
        const s = g.current;
        if (e.pointerId !== s.id || (s.state !== 'pressed' && s.state !== 'holding')) return;
        const dy = s.y - e.clientY; // upward is positive
        const dx = Math.abs(e.clientX - s.x);
        // Sliding sideways / down off the button before engaging = not this gesture.
        if (s.state === 'pressed' && (dx > 24 || dy < -16)) {
            window.clearTimeout(s.holdTimer);
            s.state = 'idle';
            setButton(0, 1, 'transform 220ms cubic-bezier(0.22, 0.8, 0.24, 1)');
            waveRef.current?.cancel();
            finish();
            return;
        }
        if (s.state === 'pressed' && dy > 12) {
            window.clearTimeout(s.holdTimer);
            engage();
        }
        if (s.state !== 'holding') return;
        s.lastDy = Math.max(0, dy);
        window.cancelAnimationFrame(s.raf);
        s.raf = window.requestAnimationFrame(() => {
            const p = s.lastDy / threshold;
            // Rubber-band the button: follows closely at first, then resists.
            const lift = MAX_LIFT * (1 - Math.exp(-s.lastDy / (MAX_LIFT * 1.4)));
            setButton(lift, 0.96 + Math.min(p, 1) * 0.1);
            waveRef.current?.progress(p);
            if (p >= 1 && !s.armed) {
                s.armed = true;
                commit();
            }
        });
    };

    const release = (e, cancelled = false) => {
        const s = g.current;
        if (e && e.pointerId !== s.id) return;
        if (s.state === 'committing') return; // finishes on its own
        const wasTap = s.state === 'pressed' && !cancelled;
        window.clearTimeout(s.holdTimer);
        window.cancelAnimationFrame(s.raf);
        setButton(0, 1, 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)');
        waveRef.current?.cancel();
        finish();
        if (wasTap) {
            setHint(true);
            window.clearTimeout(hintTimer.current);
            hintTimer.current = window.setTimeout(() => setHint(false), 1700);
        }
    };

    return (
        <div className="g-scanbtn-slot">
            <button
                ref={btnRef}
                type="button"
                className="g-scanbtn"
                data-state="idle"
                aria-label={`${label}. Press and hold, then drag up to open the scanner.`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => release(e)}
                onPointerCancel={(e) => release(e, true)}
                onLostPointerCapture={(e) => release(e, true)}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    open();
                }}
            >
                <span className="g-scanbtn__halo" aria-hidden />
                <span className="g-scanbtn__core">
                    <ScanLine strokeWidth={2.1} aria-hidden />
                </span>
            </button>
            <span className="g-scanbtn__label" aria-hidden>
                {label}
            </span>
            {hint ? (
                <span className="g-scanbtn__hint" role="status">
                    Hold &amp; drag up to scan
                </span>
            ) : null}
            <ScanWave ref={waveRef} />
        </div>
    );
}
