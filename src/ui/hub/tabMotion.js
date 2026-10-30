/**
 * Tab-to-tab motion for the phone shell.
 *
 *   setNavDirection('next' | 'prev')  — set by a tab tap or swipe right before navigating;
 *   takeNavDirection()                — AnimatedOutlet reads it once for the screen that enters
 *                                        (slides in from that side instead of the soft rise).
 *   useTabSwipe(ref, …)               — swipe left / right on the page to move between tabs.
 *     The page follows the finger (transform + opacity only); past a third of the width, or a
 *     quick flick, it moves on to the neighbouring tab, otherwise it springs back.
 *
 * Never starts on: screen edges (Android back gesture), inputs, maps, canvases (signature pads),
 * anything that scrolls sideways (tables, chip strips), [data-no-swipe], or an open scanner.
 */
import { useEffect, useRef } from 'react';

let pending = null;

export function setNavDirection(dir) {
    pending = dir === 'next' || dir === 'prev' ? dir : null;
}

export function takeNavDirection() {
    const dir = pending;
    pending = null;
    return dir;
}

const EDGE = 22;
const BLOCK_SELECTOR =
    'input, textarea, select, canvas, video, [contenteditable="true"], [role="slider"], [data-no-swipe], .leaflet-container, .recharts-wrapper';

function scrollsSideways(el) {
    if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 2) return false;
    const ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll';
}

function blocked(target, root) {
    if (!(target instanceof Element)) return true;
    if (target.closest(BLOCK_SELECTOR)) return true;
    if (root.querySelector('.wh-content--scan')) return true;
    for (let el = target; el && el !== root; el = el.parentElement) {
        if (scrollsSideways(el)) return true;
    }
    return false;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ current: HTMLElement | null }} ref   the scrolling page body (its first .g-view-enter child moves)
 * @param {{ enabled: boolean, index: number, count: number, onGo: (index: number, dir: 'next'|'prev') => void }} opts
 */
export function useTabSwipe(ref, { enabled, index, count, onGo }) {
    // Latest callback without re-binding listeners mid-gesture.
    const goRef = useRef(onGo);
    goRef.current = onGo;
    useEffect(() => {
        const go = (...args) => goRef.current?.(...args);
        const root = ref.current;
        if (!root || !enabled || index < 0) return undefined;
        let start = null;
        let axis = null;
        let view = null;
        let committing = false;

        const reset = (animate) => {
            if (!view) return;
            view.style.transition = animate
                ? 'transform 280ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity 280ms cubic-bezier(0.22, 0.8, 0.24, 1)'
                : 'none';
            view.style.transform = '';
            view.style.opacity = '';
        };

        const onStart = (e) => {
            if (committing || e.touches.length !== 1) return;
            const t = e.touches[0];
            if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
            if (blocked(e.target, root)) return;
            view = root.querySelector(':scope > .g-view-enter');
            if (!view) return;
            start = { x: t.clientX, y: t.clientY, at: performance.now() };
            axis = null;
        };

        const onMove = (e) => {
            if (!start) return;
            const t = e.touches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (!axis) {
                if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
                axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
                if (axis === 'y') {
                    start = null;
                    return;
                }
            }
            const target = dx < 0 ? index + 1 : index - 1;
            const can = target >= 0 && target < count;
            const shift = can ? dx * 0.42 : dx * 0.1; // rubber band at the first / last tab
            view.style.transition = 'none';
            view.style.transform = `translate3d(${shift}px, 0, 0)`;
            view.style.opacity = String(1 - Math.min(Math.abs(shift) / window.innerWidth, 0.5) * 0.7);
        };

        const onEnd = (e) => {
            if (!start || axis !== 'x') {
                start = null;
                return;
            }
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            const velocity = dx / Math.max(1, performance.now() - start.at); // px per ms
            start = null;
            const target = dx < 0 ? index + 1 : index - 1;
            const can = target >= 0 && target < count;
            const far = Math.abs(dx) > window.innerWidth * 0.3;
            const flick = Math.abs(dx) > 48 && Math.abs(velocity) > 0.45;
            if (!can || !(far || flick)) {
                reset(true);
                return;
            }
            committing = true;
            const dir = dx < 0 ? 'next' : 'prev';
            if (reducedMotion()) {
                reset(false);
                go(target, dir);
                committing = false;
                return;
            }
            view.style.transition = 'transform 150ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-out';
            view.style.transform = `translate3d(${dir === 'next' ? -28 : 28}vw, 0, 0)`;
            view.style.opacity = '0';
            const leaving = view;
            window.setTimeout(() => {
                go(target, dir);
                committing = false;
                // Same screen kept (navigation refused / same path): bring it back.
                window.setTimeout(() => {
                    if (leaving.isConnected) {
                        leaving.style.transition = 'none';
                        leaving.style.transform = '';
                        leaving.style.opacity = '';
                    }
                }, 450);
            }, 130);
        };

        const onCancel = () => {
            if (start && axis === 'x') reset(true);
            start = null;
        };

        root.addEventListener('touchstart', onStart, { passive: true });
        root.addEventListener('touchmove', onMove, { passive: true });
        root.addEventListener('touchend', onEnd, { passive: true });
        root.addEventListener('touchcancel', onCancel, { passive: true });
        return () => {
            root.removeEventListener('touchstart', onStart);
            root.removeEventListener('touchmove', onMove);
            root.removeEventListener('touchend', onEnd);
            root.removeEventListener('touchcancel', onCancel);
        };
    }, [ref, enabled, index, count]);
}
