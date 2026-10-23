/**
 * 3D card holder: tap / Enter / Space flips it; the card tilts towards the finger or mouse (and the
 * phone's tilt on devices that report it) with a soft glare. Only transform/opacity are animated and
 * the tilt is written straight to CSS variables (no React re-render per frame).
 */
import { useEffect, useRef } from 'react';

const MAX_TILT = 7; // degrees

export default function FlipCard({ front, back, flipped = false, onFlip, tilt = true, className = '', label = 'Identification card' }) {
    const rootRef = useRef(null);
    const frame = useRef(0);

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
        if (!tilt || typeof window === 'undefined') return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
        // Phones: follow the device tilt (Android reports it without a permission prompt).
        const onOrient = (e) => {
            if (e.beta == null || e.gamma == null) return;
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

    const onMove = (e) => {
        if (!tilt || e.pointerType === 'touch') return;
        const r = rootRef.current?.getBoundingClientRect();
        if (!r) return;
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setVars((0.5 - py) * 2 * MAX_TILT, (px - 0.5) * 2 * MAX_TILT, px * 100, py * 100, 1);
    };
    const onLeave = () => setVars(0, 0, 30, 20, 0);

    return (
        <div
            ref={rootRef}
            className={`akc-flip ${className}`}
            data-flipped={flipped ? 'true' : 'false'}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
        >
            <div className="akc-flip__tilt">
                <div
                    className="akc-flip__inner"
                    role={onFlip ? 'button' : undefined}
                    tabIndex={onFlip ? 0 : undefined}
                    aria-label={onFlip ? `${label} — ${flipped ? 'showing the back, tap to see the front' : 'tap to see the back'}` : label}
                    onClick={onFlip ? () => onFlip(!flipped) : undefined}
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
