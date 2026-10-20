import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/modules/progress/lib/utils';

// Touch: the photo lifts after this long a press without moving. Moving further
// than TOUCH_SLOP first means the user is scrolling, so the press is dropped.
const HOLD_MS = 280;
const TOUCH_SLOP = 8;
// Mouse: no hold needed — dragging past this many pixels picks the photo up.
const MOUSE_SLOP = 5;
// Auto-scroll the surrounding panel while dragging near its top / bottom edge.
const EDGE_PX = 64;
const MAX_SCROLL_STEP = 18;
const SETTLE_MS = 170;

function findScroller(el) {
    for (let node = el?.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
            return node;
        }
    }
    return null;
}

function slotOf(el) {
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Grid whose items can be reordered by pressing (and holding, on touch) then dragging.
 *
 * Items are never moved in the DOM while dragging — they are only shifted with CSS
 * transforms into their new slots — because moving the touched element mid-gesture makes
 * mobile browsers drop the touch stream. The real order is committed once on release.
 *
 * `renderItem(item, index, { handleProps, dragging })` — spread `handleProps` on the
 * element that should start a drag (e.g. the photo). Put `data-no-drag` on controls inside
 * it (a delete button) so pressing them does not start one.
 */
export default function SortablePhotoGrid({ items, onReorder, disabled = false, className, renderItem }) {
    const gridRef = useRef(null);
    const tileEls = useRef(new Map());
    const sessionRef = useRef(null);
    const suppressClickRef = useRef(false);
    const clearAfterCommitRef = useRef(false);
    const latest = useRef({});
    latest.current = { items, onReorder, disabled };
    const [dragId, setDragId] = useState(null);

    const clearTileStyles = useCallback(() => {
        tileEls.current.forEach((el) => {
            el.style.transform = '';
            el.style.transition = '';
            el.style.willChange = '';
        });
    }, []);

    // After the parent re-renders in the new order the tiles sit exactly where their
    // transforms had put them, so dropping the transforms in the same commit is seamless.
    useLayoutEffect(() => {
        if (!clearAfterCommitRef.current) return;
        clearAfterCommitRef.current = false;
        clearTileStyles();
    }, [items, clearTileStyles]);

    const layout = useCallback(() => {
        const s = sessionRef.current;
        const grid = gridRef.current;
        if (!s?.active || !grid) return;
        const box = grid.getBoundingClientRect();
        const p = { x: s.x - box.left, y: s.y - box.top };

        // Which fixed slot is the pointer over? Moving there re-slots the dragged photo.
        for (let k = 0; k < s.slots.length; k += 1) {
            const r = s.slots[k];
            if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
                const from = s.order.indexOf(s.id);
                if (k !== from) {
                    s.order.splice(from, 1);
                    s.order.splice(k, 0, s.id);
                }
                break;
            }
        }

        s.order.forEach((id, k) => {
            const el = tileEls.current.get(id);
            if (!el) return;
            const home = s.slots[s.homeIndex.get(id)];
            if (id === s.id) {
                el.style.transform = `translate(${p.x - s.grab.x - home.x}px, ${p.y - s.grab.y - home.y}px) scale(1.04)`;
            } else {
                const dest = s.slots[k];
                el.style.transform = `translate(${dest.x - home.x}px, ${dest.y - home.y}px)`;
            }
        });
    }, []);

    const scheduleLayout = useCallback(() => {
        const s = sessionRef.current;
        if (!s || s.layoutRaf) return;
        s.layoutRaf = requestAnimationFrame(() => {
            s.layoutRaf = 0;
            layout();
        });
    }, [layout]);

    const autoScrollTick = useCallback(() => {
        const s = sessionRef.current;
        if (!s?.active) return;
        const bounds = s.scroller
            ? s.scroller.getBoundingClientRect()
            : { top: 0, bottom: window.innerHeight };
        let dy = 0;
        if (s.y < bounds.top + EDGE_PX) {
            dy = -Math.min(MAX_SCROLL_STEP, Math.ceil(((bounds.top + EDGE_PX - s.y) / EDGE_PX) * MAX_SCROLL_STEP));
        } else if (s.y > bounds.bottom - EDGE_PX) {
            dy = Math.min(MAX_SCROLL_STEP, Math.ceil(((s.y - (bounds.bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_STEP));
        }
        if (dy) {
            if (s.scroller) s.scroller.scrollTop += dy;
            else window.scrollBy(0, dy);
            layout();
        }
        s.scrollRaf = requestAnimationFrame(autoScrollTick);
    }, [layout]);

    const ctl = useRef({}).current;

    // Stable listener functions (they must be removable) that delegate to the latest handlers.
    const onMove = useCallback((e) => ctl.move(e), [ctl]);
    const onUp = useCallback((e) => ctl.up(e), [ctl]);
    const onCancel = useCallback((e) => ctl.cancel(e), [ctl]);
    const onTouchMove = useCallback((e) => ctl.touchMove(e), [ctl]);

    ctl.activate = () => {
        const s = sessionRef.current;
        const grid = gridRef.current;
        if (!s || s.active || !grid) return;
        const ids = latest.current.items.map((it) => it.id);
        if (ids.length < 2 || latest.current.disabled) {
            ctl.finish(false);
            return;
        }
        s.order = [...ids];
        s.startOrder = [...ids];
        s.homeIndex = new Map(ids.map((id, i) => [id, i]));
        s.slots = ids.map((id) => slotOf(tileEls.current.get(id)));
        s.scroller = findScroller(grid);
        const box = grid.getBoundingClientRect();
        const home = s.slots[s.homeIndex.get(s.id)];
        // Where inside the photo it was grabbed — measured at the press, not at the current
        // pointer (a mouse drag activates a few pixels after the press).
        s.grab = { x: s.startX - box.left - home.x, y: s.startY - box.top - home.y };
        s.active = true;
        ids.forEach((id) => {
            const el = tileEls.current.get(id);
            el.style.willChange = 'transform';
            el.style.transition = id === s.id ? 'none' : `transform ${SETTLE_MS}ms ease`;
        });
        setDragId(s.id);
        try {
            navigator.vibrate?.(12);
        } catch {
            /* haptics are optional */
        }
        s.scrollRaf = requestAnimationFrame(autoScrollTick);
        layout();
    };

    ctl.move = (e) => {
        const s = sessionRef.current;
        if (!s || e.pointerId !== s.pointerId) return;
        s.x = e.clientX;
        s.y = e.clientY;
        if (!s.active) {
            const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
            if (s.pointerType === 'mouse') {
                if (moved > MOUSE_SLOP) ctl.activate();
            } else if (moved > TOUCH_SLOP) {
                ctl.finish(false); // the finger is scrolling, not dragging
            }
            return;
        }
        scheduleLayout();
    };

    // Once a photo is lifted, stop the touch from scrolling the panel underneath.
    ctl.touchMove = (e) => {
        if (sessionRef.current?.active && e.cancelable) e.preventDefault();
    };

    ctl.up = (e) => {
        const s = sessionRef.current;
        if (!s || e.pointerId !== s.pointerId) return;
        // Settle on the exact release point now rather than trusting the last animation
        // frame to have run (it may not have, e.g. on a fast flick or a busy phone).
        if (s.active) {
            s.x = e.clientX;
            s.y = e.clientY;
            layout();
        }
        ctl.finish(true);
    };

    ctl.cancel = (e) => {
        const s = sessionRef.current;
        if (!s || e.pointerId !== s.pointerId) return;
        ctl.finish(false);
    };

    ctl.finish = (commit) => {
        const s = sessionRef.current;
        if (!s) return;
        sessionRef.current = null;
        clearTimeout(s.timer);
        cancelAnimationFrame(s.layoutRaf || 0);
        cancelAnimationFrame(s.scrollRaf || 0);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('touchmove', onTouchMove);
        if (!s.active) return;

        // The release must not also count as a tap on the photo underneath.
        suppressClickRef.current = true;
        setTimeout(() => {
            suppressClickRef.current = false;
        }, 350);
        setDragId(null);

        const changed = commit && s.order.some((id, i) => id !== s.startOrder[i]);
        if (changed) {
            const byId = new Map(latest.current.items.map((it) => [it.id, it]));
            clearAfterCommitRef.current = true;
            latest.current.onReorder(s.order.map((id) => byId.get(id)));
            // Safety net if the parent chose not to re-render with the new order.
            setTimeout(() => {
                if (clearAfterCommitRef.current) {
                    clearAfterCommitRef.current = false;
                    clearTileStyles();
                }
            }, 400);
            return;
        }
        // No change (or cancelled): glide everything back home.
        tileEls.current.forEach((el) => {
            el.style.transition = `transform ${SETTLE_MS}ms ease`;
            el.style.transform = '';
        });
        setTimeout(() => {
            if (!sessionRef.current) clearTileStyles();
        }, SETTLE_MS + 30);
    };

    ctl.press = (e, id) => {
        if (latest.current.disabled || sessionRef.current) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target?.closest?.('[data-no-drag]')) return;
        if (latest.current.items.length < 2) return;
        // Mouse: stop the browser starting a text selection / native image drag.
        if (e.pointerType === 'mouse') e.preventDefault();
        const s = {
            id,
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            startX: e.clientX,
            startY: e.clientY,
            x: e.clientX,
            y: e.clientY,
            active: false,
            timer: 0,
            layoutRaf: 0,
            scrollRaf: 0,
        };
        sessionRef.current = s;
        if (e.pointerType !== 'mouse') s.timer = setTimeout(() => ctl.activate(), HOLD_MS);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('touchmove', onTouchMove, { passive: false });
    };

    // Leaving mid-drag (dialog closed) must not leave listeners or timers behind.
    useEffect(() => () => ctl.finish(false), [ctl]);

    const setTileRef = (id) => (el) => {
        if (el) tileEls.current.set(id, el);
        else tileEls.current.delete(id);
    };

    return (
        <div
            ref={gridRef}
            className={cn('relative', className)}
            onClickCapture={(e) => {
                if (suppressClickRef.current) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }}
        >
            {items.map((item, index) => {
                const dragging = dragId === item.id;
                return (
                    <div
                        key={item.id}
                        ref={setTileRef(item.id)}
                        className={cn(
                            'relative min-w-0 rounded-lg',
                            dragging && 'z-30 opacity-95 shadow-2xl ring-2 ring-brand/70'
                        )}
                    >
                        {renderItem(item, index, {
                            dragging,
                            handleProps: disabled
                                ? {}
                                : {
                                    onPointerDown: (e) => ctl.press(e, item.id),
                                    onContextMenu: (e) => e.preventDefault(),
                                    onDragStart: (e) => e.preventDefault(),
                                    style: {
                                        WebkitUserSelect: 'none',
                                        userSelect: 'none',
                                        WebkitTouchCallout: 'none',
                                    },
                                },
                        })}
                    </div>
                );
            })}
        </div>
    );
}
