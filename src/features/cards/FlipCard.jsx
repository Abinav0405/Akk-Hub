/**
 * 3D card holder.
 *   - drag sideways: the card turns with your finger; let go past ~¼ of its width (or flick) and it
 *     flips over in that direction, otherwise it springs back. Vertical swipes still scroll the page.
 *   - tap / Enter / Space flips it too
 *   - the card tilts towards the mouse (and the phone's tilt) with a soft glare
 * Everything is written straight to style / CSS variables (no React re-render per frame), and only
 * transform / opacity animate.
 */
import { useEffect, useRef } from 'react';

const MAX_TILT = 7; // degrees
const FLIP_MS = 460;
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const sideOf = (deg) => ((Math.round(deg / 180) % 2) + 2) % 2 === 1; // true = back showing

export default function FlipCard({ front, back, flipped = false, onFlip, tilt = true, className = '', label = 'Identification card' }) {
    const rootRef = useRef(null);
    const innerRef = useRef(null);
    const frame = useRef(0);
    const rot = useRef(flipped ? 180 : 0);
    const drag = useRef(null);
    const suppressClick = useRef(false);

    const apply = (deg, ms) => {
        const el = innerRef.current;
        if (!el) return;
        el.style.transition = ms && !reduceMotion() ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : 'none';
        el.style.transform = `rotateY(${deg}deg)`;
    };

    // Follow the `flipped` prop (taps, keyboard, parent) — turn the short way in the last direction.
    const lastDir = useRef(1);
    useEffect(() => {
        if (sideOf(rot.current) !== flipped) {
            rot.current += 180 * lastDir.current;
            apply(rot.current, FLIP_MS + 120);
        }
    }, [flipped]);
    useEffect(() => apply(rot.current, 0), []);

    const setVars = (rx, ry, gx, gy, go) => {
        const el = rootRef.current;
        if (!el) return;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
            el.style.setProperty('--rx', `${rx}deg`);
            el.style.setProperty('--ry', `${ry}deg`);
            el.style.setProperty('--gx', `${gx}%`);
            el.style.setProperty('--gy', `${gy}%`);
            el.style.setProperty('--go', String(go));
        });
    };

    useEffect(() => {
        if (!tilt || typeof window === 'undefined' || reduceMotion()) return undefined;
        const onOrient = (e) => {
            if (e.beta == null || e.gamma == null || drag.current) return;
            const ry = Math.max(-MAX_TILT, Math.min(MAX_TILT, e.gamma / 4));
            const rx = Math.max(-MAX_TILT, Math.min(MAX_TILT, (e.beta - 45) / -6));
            setVars(rx, ry, 50 + ry * 6, 40 - rx * 6, 0.9);
        };
        const coarse = window.matchMedia?.('(pointer: coarse)').matches;
        if (coarse && 'DeviceOrientationEvent' in window && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
            window.addEventListener('deviceorientation', onOrient, { passive: true });
        }
        return () => {
            window.removeEventListener('deviceorientation', onOrient);
            cancelAnimationFrame(frame.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tilt]);

    /* ---- drag to flip ---- */
    const onPointerDown = (e) => {
        if (!onFlip || e.button > 0) return;
        if (e.target.closest?.('button, a, input, select, textarea')) return; // QR / Show buttons stay buttons
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), start: rot.current, active: false, w: rootRef.current?.offsetWidth || 320 };
    };
    const onPointerMove = (e) => {
        const d = drag.current;
        if (d && d.id === e.pointerId) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.active) {
                if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
                    if (Math.abs(dy) > 12) drag.current = null; // a vertical swipe: let the page scroll
                    return;
                }
                d.active = true;
                rootRef.current?.setPointerCapture?.(e.pointerId);
                setVars(0, 0, 30, 20, 0);
            }
            d.lastX = e.clientX;
            d.lastT = performance.now();
            // ~0.6 of the card width = half a turn; a little resistance past it
            const turn = (dx / (d.w * 0.6)) * 180;
            const eased = Math.abs(turn) > 180 ? Math.sign(turn) * (180 + (Math.abs(turn) - 180) * 0.25) : turn;
            apply(d.start + eased, 0);
            return;
        }
        if (!tilt || e.pointerType === 'touch') return;
        const r = rootRef.current?.getBoundingClientRect();
        if (!r) return;
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setVars((0.5 - py) * 2 * MAX_TILT, (px - 0.5) * 2 * MAX_TILT, px * 100, py * 100, 1);
    };
    const endDrag = (e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || !d.active || d.id !== e.pointerId) return;
        suppressClick.current = true;
        window.setTimeout(() => {
            suppressClick.current = false;
        }, 50);
        const dx = e.clientX - d.x;
        const dt = Math.max(1, performance.now() - d.t);
        const fast = Math.abs(dx) / dt > 0.45; // flick
        if (Math.abs(dx) > d.w * 0.25 || (fast && Math.abs(dx) > 24)) {
            const dir = dx > 0 ? 1 : -1;
            lastDir.current = dir;
            rot.current = d.start + 180 * dir;
            apply(rot.current, FLIP_MS);
            navigator.vibrate?.(8);
            onFlip(sideOf(rot.current));
        } else {
            apply(d.start, 260); // spring back
        }
    };

    const onLeave = () => {
        if (!drag.current) setVars(0, 0, 30, 20, 0);
    };

    return (
        <div
            ref={rootRef}
            className={`akc-flip ${className}`}
            data-flipped={flipped ? 'true' : 'false'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={onLeave}
            style={onFlip ? { touchAction: 'pan-y' } : undefined}
        >
            <div className="akc-flip__tilt">
                <div
                    ref={innerRef}
                    className="akc-flip__inner"
                    role={onFlip ? 'button' : undefined}
                    tabIndex={onFlip ? 0 : undefined}
                    aria-label={onFlip ? `${label} — ${flipped ? 'showing the back, tap or drag to see the front' : 'tap or drag to see the back'}` : label}
                    onClick={
                        onFlip
                            ? () => {
                                  if (suppressClick.current) return;
                                  onFlip(!flipped);
                              }
                            : undefined
                    }
                    onKeyDown={
                        onFlip
                            ? (e) => {
                                  if (e.target !== e.currentTarget) return; // keys on the QR / Show buttons
                                  if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      onFlip(!flipped);
                                  }
                              }
                            : undefined
                    }
                >
                    <div className="akc-flip__face" aria-hidden={flipped}>
                        {front}
                        <div className="akc-flip__glare" aria-hidden />
                    </div>
                    <div className="akc-flip__face akc-flip__face--back" aria-hidden={!flipped}>
                        {back}
                    </div>
                </div>
            </div>
        </div>
    );
}
