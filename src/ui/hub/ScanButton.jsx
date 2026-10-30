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
 * (no React render per pointer move), so it stays smooth on mid-range Android phones.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
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
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
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
 * The full-screen wave layer. Driven imperatively by ScanButton (and the first-launch intro):
 *   begin(x, y) · hold() · progress(p) · commit(onCovered) · cancel() · end()
 */
export const ScanWave = forwardRef(function ScanWave(_, ref) {
    const rootRef = useRef(null);
    const fillRef = useRef(null);
    const labelRef = useRef(null);
    const geo = useRef({ x: 0, y: 0, r: 1 });
    const timers = useRef([]);

    const later = (fn, ms) => timers.current.push(window.setTimeout(fn, ms));
    const clearTimers = () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
    };
    useEffect(() => clearTimers, []);

    const page = () => document.querySelector('.g-shell__body');

    useImperativeHandle(ref, () => ({
        begin(x, y) {
            clearTimers();
            const root = rootRef.current;
            const fill = fillRef.current;
            if (!root || !fill) return;
            const r = coverRadius(x, y);
            geo.current = { x, y, r };
            root.style.setProperty('--wx', `${x}px`);
            root.style.setProperty('--wy', `${y}px`);
            fill.style.width = fill.style.height = `${r * 2}px`;
            fill.style.left = `${x - r}px`;
            fill.style.top = `${y - r}px`;
            fill.style.transition = 'none';
            fill.style.transform = 'scale(0)';
            fill.style.opacity = '1';
            root.dataset.state = 'press';
        },
        hold() {
            if (rootRef.current) rootRef.current.dataset.state = 'hold';
        },
        /** p: 0 → 1 (threshold). */
        progress(p) {
            const fill = fillRef.current;
            const root = rootRef.current;
            if (!fill || !root) return;
            const { r } = geo.current;
            const radius = 34 + Math.min(p, 1.15) * Math.min(r * 0.42, 260);
            fill.style.transition = 'none';
            fill.style.transform = `scale(${radius / r})`;
            root.style.setProperty('--p', String(Math.min(p, 1)));
            root.dataset.armed = p >= 1 ? 'true' : 'false';
            const body = page();
            if (body) {
                body.style.transition = 'none';
                body.style.transformOrigin = '50% 100%';
                body.style.transform = `scale(${1 - Math.min(p, 1) * 0.045})`;
                body.style.opacity = String(1 - Math.min(p, 1) * 0.25);
            }
        },
        /** Fill the screen, call onCovered once it is (navigate there), then reveal. */
        commit(onCovered) {
            const fill = fillRef.current;
            const root = rootRef.current;
            if (!fill || !root) return;
            root.dataset.state = 'commit';
            const quick = reducedMotion();
            fill.style.transition = quick
                ? 'opacity 160ms ease-out'
                : 'transform 460ms cubic-bezier(0.2, 0.85, 0.25, 1)';
            fill.style.transform = 'scale(1.02)';
            if (labelRef.current) labelRef.current.textContent = 'Opening scanner…';
            later(() => {
                onCovered?.();
                const body = page();
                if (body) {
                    body.style.transition = 'none';
                    body.style.transform = '';
                    body.style.opacity = '';
                }
            }, quick ? 60 : 380);
            later(() => {
                root.dataset.state = 'reveal';
                fill.style.transition = 'opacity 420ms cubic-bezier(0.22, 0.8, 0.24, 1), transform 520ms cubic-bezier(0.22, 0.8, 0.24, 1)';
                fill.style.opacity = '0';
                fill.style.transform = 'scale(1.12)';
            }, quick ? 120 : 620);
            later(() => this.end(), quick ? 420 : 1100);
        },
        cancel() {
            const fill = fillRef.current;
            const root = rootRef.current;
            if (!fill || !root) return;
            root.dataset.state = 'cancel';
            fill.style.transition = 'transform 320ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity 320ms ease-out';
            fill.style.transform = 'scale(0)';
            const body = page();
            if (body) {
                body.style.transition = 'transform 320ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity 320ms ease-out';
                body.style.transform = '';
                body.style.opacity = '';
            }
            later(() => this.end(), 340);
        },
        end() {
            clearTimers();
            const root = rootRef.current;
            if (root) {
                root.dataset.state = 'idle';
                root.dataset.armed = 'false';
                root.style.setProperty('--p', '0');
            }
            if (labelRef.current) labelRef.current.textContent = 'Drag up to scan';
            const body = page();
            if (body) {
                body.style.transition = '';
                body.style.transform = '';
                body.style.opacity = '';
                body.style.transformOrigin = '';
            }
        },
    }));

    return createPortal(
        <div ref={rootRef} className="g-scanwave" data-state="idle" aria-hidden="true">
            <span className="g-scanwave__ring g-scanwave__ring--1" />
            <span className="g-scanwave__ring g-scanwave__ring--2" />
            <span className="g-scanwave__ring g-scanwave__ring--3" />
            <div ref={fillRef} className="g-scanwave__fill">
                <span className="g-scanwave__frame">
                    <ScanLine strokeWidth={1.6} />
                </span>
            </div>
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
