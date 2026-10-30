/**
 * One-time, ~2 s demo of the centre Scan button gesture for employees:
 *
 *   0.0–0.4 s  the Scan button lifts and glows
 *   0.4–1.0 s  a fingertip presses and holds — ripples pulse — "Press & Hold"
 *   1.0–1.7 s  the fingertip drags up, the button follows, the scan portal opens part-way — "Drag Up to Scan"
 *   1.7–2.0 s  everything settles back; the app is ready
 *
 * Shown once per device (versioned key below — bump the version to teach a changed gesture),
 * on the first launch after this update. Marked done as soon as it starts, so closing the app or
 * tapping to skip never brings it back; it never replays on re-mounts, tab changes or new sign-ins.
 * Waits for the launch intro / login curtain to finish first.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine } from 'lucide-react';

export const SCAN_INTRO_KEY = 'akk.hub.onboarding.scan_gesture_intro_v1_completed';
const DURATION_MS = 2000;

function done() {
    try {
        return localStorage.getItem(SCAN_INTRO_KEY) === '1';
    } catch {
        return true; // no storage: never risk replaying it every launch
    }
}

function markDone() {
    try {
        localStorage.setItem(SCAN_INTRO_KEY, '1');
    } catch {
        /* ignore */
    }
}

/** The screen is calm: no launch intro, login curtain, welcome screen, dialog or open scanner. */
function screenIsCalm() {
    return (
        !document.querySelector('.akk-intro, .login-curtain, .login-welcome-screen, [role="dialog"], .wh-content--scan') &&
        document.querySelector('.g-scanbtn')
    );
}

export default function ScanIntro() {
    const [spot, setSpot] = useState(null);

    useEffect(() => {
        if (done()) return undefined;
        let tries = 0;
        let timer = 0;
        const check = () => {
            tries += 1;
            if (done()) return;
            if (screenIsCalm()) {
                const rect = document.querySelector('.g-scanbtn').getBoundingClientRect();
                markDone();
                setSpot({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width });
                return;
            }
            if (tries < 40) timer = window.setTimeout(check, 350); // give up after ~14 s; try next launch
        };
        timer = window.setTimeout(check, 900);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!spot) return undefined;
        const t = window.setTimeout(() => setSpot(null), DURATION_MS + 60);
        return () => window.clearTimeout(t);
    }, [spot]);

    if (!spot) return null;
    return createPortal(
        <div
            className="g-scanintro"
            style={{ '--sx': `${spot.x}px`, '--sy': `${spot.y}px`, '--ss': `${spot.size}px`, '--dur': `${DURATION_MS}ms` }}
            role="status"
            aria-label="Tip: press and hold the Scan button, then drag up to open the scanner."
            onPointerDown={() => setSpot(null)}
        >
            <span className="g-scanintro__scrim" />
            <span className="g-scanintro__portal">
                <ScanLine strokeWidth={1.6} aria-hidden />
            </span>
            <span className="g-scanintro__ripple g-scanintro__ripple--1" />
            <span className="g-scanintro__ripple g-scanintro__ripple--2" />
            <span className="g-scanintro__ghost" aria-hidden>
                <span className="g-scanbtn__core">
                    <ScanLine strokeWidth={2.1} />
                </span>
            </span>
            <span className="g-scanintro__finger" />
            <span className="g-scanintro__caption g-scanintro__caption--hold">Press &amp; Hold</span>
            <span className="g-scanintro__caption g-scanintro__caption--drag">Drag Up to Scan</span>
        </div>,
        document.body,
    );
}
