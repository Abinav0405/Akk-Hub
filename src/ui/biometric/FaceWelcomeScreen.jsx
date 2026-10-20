/**
 * The Face ID success screen ("Welcome, NAME · Signing you in…") as a static page — the same
 * markup and styles FaceMatchPrompt shows on success, so the login curtain (ui/LoginCurtain.jsx)
 * can take over from it in the same frame with no visible change while the app moves to the
 * portal underneath.
 *
 * Kept apart from FaceMatchPrompt so the app-root curtain doesn't pull the camera / face-api
 * code into the first page load.
 */
import { FaceIdGlyph } from '@/ui/biometric/BiometricGlyph';
import './biometric.css';

// ---------------------------------------------------------------------------
// Dotted ring geometry (shared with FaceMatchPrompt's animated ring).
// ---------------------------------------------------------------------------
export const RING = { cx: 150, cy: 195, rx: 118, ry: 152 };

/** Pie wedge (in ring coordinates) covering `fraction` of a turn, clockwise from 12 o'clock. */
export function wedgePath(fraction) {
    const f = Math.max(0, Math.min(1, fraction));
    if (f >= 0.999) return 'M-50,-50 H350 V450 H-50 Z';
    const r = 400;
    const pts = [`M${RING.cx},${RING.cy}`];
    const steps = Math.max(2, Math.ceil(f * 72));
    for (let i = 0; i <= steps; i += 1) {
        const a = -Math.PI / 2 + (i / steps) * f * Math.PI * 2;
        pts.push(`L${(RING.cx + r * Math.cos(a)).toFixed(1)},${(RING.cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return `${pts.join(' ')} Z`;
}

/** The ring's SVG for a given tone / fill (0–1). */
export function RingSvg({ tone, fill }) {
    return (
        <>
            <div className="akk-face__mask" />
            <svg className="akk-face__ring" viewBox="0 0 300 390" data-tone={tone}>
                <defs>
                    <mask id="akk-face-ring-fill">
                        <path d={wedgePath(fill)} fill="#fff" />
                    </mask>
                </defs>
                <ellipse className="akk-face__ring-base" cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} />
                <ellipse
                    className="akk-face__ring-lit"
                    cx={RING.cx}
                    cy={RING.cy}
                    rx={RING.rx}
                    ry={RING.ry}
                    mask="url(#akk-face-ring-fill)"
                />
            </svg>
        </>
    );
}

export function FaceWelcomeScreen({ name, fullScreen = true }) {
    const firstName = String(name || '').trim().split(/\s+/)[0] || '';
    return (
        <div
            className={['akk-face', 'akk-face--curtain', fullScreen ? '' : 'akk-face--card'].join(' ')}
            role="status"
            aria-live="polite"
        >
            <div className="akk-face__panel">
                <div className="akk-face__stage">
                    <div className="akk-face__shade" aria-hidden="true" />
                </div>
                <div className="akk-face__layout">
                    <header className="akk-face__top">
                        <div className="akk-face__topbar" />
                        <div className="akk-face__glyph-chip">
                            <FaceIdGlyph status="success" label="Face ID, success" />
                        </div>
                        <h2 className="akk-face__title">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</h2>
                        <p className="akk-face__subtitle">Signing you in…</p>
                    </header>
                    <div className="akk-face__middle">
                        <div className="akk-face__frame" aria-hidden="true">
                            <RingSvg tone="success" fill={1} />
                        </div>
                    </div>
                    <footer className="akk-face__bottom" />
                </div>
            </div>
        </div>
    );
}

export default FaceWelcomeScreen;
