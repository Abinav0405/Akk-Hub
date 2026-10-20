import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Loader2, Trash2, X, ZoomOut } from 'lucide-react';
import { STAGE_LABELS } from '@/modules/progress/lib/config';
import { pushNativeBackHandler } from '@/core/nativeBack';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const SWIPE_THRESHOLD = 40;
const PRELOAD_RADIUS = 2;

function touchDistance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMidpoint(a, b) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

/** Keep decoded bitmaps alive so next/prev does not re-decode a huge JPEG. */
function warmUrl(cache, url) {
    if (!url || cache.has(url)) return;
    const el = new Image();
    el.decoding = 'async';
    el.src = url;
    cache.set(url, el);
    if (typeof el.decode === 'function') {
        el.decode().catch(() => {});
    }
}

const FilmstripThumb = memo(function FilmstripThumb({ id, url, active, label, onSelect, onWarm }) {
    return (
        <button
            type="button"
            data-active={active}
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            onPointerEnter={() => onWarm(url)}
            onPointerDown={() => onWarm(url)}
            onClick={() => onSelect(id)}
            className={`h-12 w-16 shrink-0 touch-manipulation overflow-hidden rounded-md border-2 ${
                active ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
            }`}
        >
            {url ? (
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : (
                <div className="h-full w-full bg-white/10" />
            )}
        </button>
    );
});

const Filmstrip = memo(function Filmstrip({ gallery, urls, currentId, onSelect, onWarm }) {
    const stripRef = useRef(null);

    useEffect(() => {
        const strip = stripRef.current;
        const el = strip?.querySelector('[data-active="true"]');
        if (!strip || !el) return;
        const left = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
        strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }, [currentId]);

    return (
        <div
            ref={stripRef}
            className="flex touch-pan-x gap-1.5 overflow-x-auto px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onClick={(e) => e.stopPropagation()}
        >
            {gallery.map((img, i) => (
                <FilmstripThumb
                    key={img.id}
                    id={img.id}
                    url={urls[img.id]}
                    active={img.id === currentId}
                    label={`Go to photo ${i + 1}`}
                    onSelect={onSelect}
                    onWarm={onWarm}
                />
            ))}
        </div>
    );
});

export default function PhotoLightbox({ gallery, urls, previewId, onClose, onImageError, onRemove }) {
    const [currentId, setCurrentId] = useState(previewId);
    const index = gallery.findIndex((img) => img.id === currentId);
    const current = index >= 0 ? gallery[index] : null;
    const src = current ? urls[current.id] : null;
    const hasPrev = index > 0;
    const hasNext = index >= 0 && index < gallery.length - 1;

    const wrapRef = useRef(null);
    const imgRef = useRef(null);
    const gestureRef = useRef(null);
    const lastTapRef = useRef(0);
    const decodedRef = useRef(new Map());
    const navRef = useRef({ index: 0, gallery, hasPrev: false, hasNext: false, current: null });
    navRef.current = { index, gallery, hasPrev, hasNext, current };

    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const [gesturing, setGesturing] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [downloading, setDownloading] = useState(false);

    const windowImages = useMemo(() => {
        if (index < 0) return [];
        const lo = Math.max(0, index - PRELOAD_RADIUS);
        const hi = Math.min(gallery.length - 1, index + PRELOAD_RADIUS);
        return gallery.slice(lo, hi + 1);
    }, [gallery, index]);

    const goTo = useCallback((id) => {
        if (!id) return;
        setCurrentId((prev) => (prev === id ? prev : id));
    }, []);

    const warm = useCallback((url) => {
        warmUrl(decodedRef.current, url);
    }, []);

    const goBy = (delta) => {
        const n = navRef.current;
        const next = n.index + delta;
        if (next < 0 || next >= n.gallery.length) return;
        goTo(n.gallery[next].id);
    };

    const onNav = (delta) => (e) => {
        e.stopPropagation();
        goBy(delta);
    };

    useEffect(() => {
        if (previewId) setCurrentId(previewId);
    }, [previewId]);

    useEffect(() => {
        if (!currentId) return;
        if (gallery.some((img) => img.id === currentId)) return;
        if (gallery.length === 0) {
            onClose();
            return;
        }
        const fallback = Math.min(Math.max(index, 0), gallery.length - 1);
        setCurrentId(gallery[fallback].id);
    }, [gallery, currentId, index, onClose]);

    useEffect(() => {
        setTransform({ scale: 1, x: 0, y: 0 });
    }, [current?.id]);

    useEffect(() => {
        const cache = decodedRef.current;
        for (const img of windowImages) {
            warmUrl(cache, urls[img.id]);
        }
    }, [windowImages, urls]);

    useEffect(() => {
        return pushNativeBackHandler(() => {
            onClose();
            return true;
        });
    }, [onClose]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goBy(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                goBy(1);
            } else if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const clampTranslate = (scale, x, y) => {
        const wrap = wrapRef.current;
        const img = imgRef.current;
        if (!wrap || !img) return { x, y };
        const maxX = Math.max(0, (img.offsetWidth * scale - wrap.clientWidth) / 2);
        const maxY = Math.max(0, (img.offsetHeight * scale - wrap.clientHeight) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, x)),
            y: Math.min(maxY, Math.max(-maxY, y)),
        };
    };

    const zoomTo = (nextScale, focal) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        setTransform((prev) => {
            let { x, y } = prev;
            if (focal && wrapRef.current) {
                const rect = wrapRef.current.getBoundingClientRect();
                const cx = focal.x - rect.left - rect.width / 2;
                const cy = focal.y - rect.top - rect.height / 2;
                const ratio = scale / prev.scale;
                x = cx - (cx - prev.x) * ratio;
                y = cy - (cy - prev.y) * ratio;
            }
            if (scale === 1) {
                x = 0;
                y = 0;
            }
            const clamped = clampTranslate(scale, x, y);
            return { scale, x: clamped.x, y: clamped.y };
        });
    };

    const toggleZoom = (point) => {
        zoomTo(transform.scale > 1 ? 1 : DOUBLE_TAP_ZOOM, point);
    };

    const onTouchStart = (e) => {
        const touches = e.touches;
        if (touches.length === 2) {
            setGesturing(true);
            gestureRef.current = {
                mode: 'pinch',
                startDist: touchDistance(touches[0], touches[1]),
                startScale: transform.scale,
                startMid: touchMidpoint(touches[0], touches[1]),
            };
            return;
        }
        if (touches.length === 1) {
            const now = Date.now();
            const point = { x: touches[0].clientX, y: touches[0].clientY };
            if (now - lastTapRef.current < DOUBLE_TAP_MS) {
                lastTapRef.current = 0;
                gestureRef.current = null;
                toggleZoom(point);
                return;
            }
            lastTapRef.current = now;
            if (transform.scale > 1) {
                setGesturing(true);
                gestureRef.current = {
                    mode: 'pan',
                    startX: point.x,
                    startY: point.y,
                    startTransform: { ...transform },
                };
            } else {
                gestureRef.current = { mode: 'swipe', startX: point.x, startY: point.y };
            }
        }
    };

    const onTouchMove = (e) => {
        const g = gestureRef.current;
        if (!g) return;
        const touches = e.touches;
        if (g.mode === 'pinch' && touches.length === 2) {
            e.preventDefault();
            const dist = touchDistance(touches[0], touches[1]);
            zoomTo(g.startScale * (dist / g.startDist), g.startMid);
        } else if (g.mode === 'pan' && touches.length === 1) {
            e.preventDefault();
            const dx = touches[0].clientX - g.startX;
            const dy = touches[0].clientY - g.startY;
            const clamped = clampTranslate(transform.scale, g.startTransform.x + dx, g.startTransform.y + dy);
            setTransform((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
        }
    };

    const onTouchEnd = (e) => {
        const g = gestureRef.current;
        gestureRef.current = null;
        setGesturing(false);
        if (!g || g.mode !== 'swipe') return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - g.startX;
        const dy = touch.clientY - g.startY;
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.25) {
            if (dx < 0) goBy(1);
            else goBy(-1);
        }
    };

    const handleDownload = async () => {
        if (!src || downloading) return;
        setDownloading(true);
        try {
            const res = await fetch(src);
            if (!res.ok) throw new Error('Could not download this photo');
            const blob = await res.blob();
            const stageLabel = (STAGE_LABELS[current.stage] || current.stage || 'photo').replace(/\s+/g, '-');
            await savePdfBlob(blob, `${stageLabel}-${index + 1}.jpg`);
        } catch (e) {
            console.error('[PhotoLightbox] download failed:', e);
            toast.error('Could not download this photo');
        } finally {
            setDownloading(false);
        }
    };

    const handleRemove = async () => {
        if (!onRemove || !current || removing) return;
        if (!window.confirm('Remove this photo?')) return;
        const nextId = hasNext ? gallery[index + 1].id : hasPrev ? gallery[index - 1].id : null;
        setRemoving(true);
        try {
            await onRemove(current);
            if (nextId) setCurrentId(nextId);
            else onClose();
        } catch {
            /* caller surfaces the error */
        } finally {
            setRemoving(false);
        }
    };

    if (!current) return null;

    return createPortal(
        <div
            data-photo-lightbox="true"
            className="pointer-events-auto fixed inset-0 z-[200] flex flex-col bg-black/90"
            role="dialog"
            aria-modal="true"
            aria-label="Photo preview"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="flex items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-white">
                <p className="min-w-0 truncate text-sm font-medium">
                    {STAGE_LABELS[current.stage] || current.stage}
                    <span className="ml-2 font-normal text-white/70">
                        {index + 1} of {gallery.length}
                    </span>
                </p>
                <div className="flex shrink-0 items-center gap-2">
                    {onRemove && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={removing}
                            aria-label="Remove photo"
                            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-white/10 text-red-400 hover:bg-white/20 disabled:opacity-50"
                        >
                            {removing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={downloading || !src}
                        aria-label="Download photo"
                        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-50"
                    >
                        {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                    </button>
                    {transform.scale > 1 && (
                        <button
                            type="button"
                            onClick={() => zoomTo(1, null)}
                            aria-label="Reset zoom"
                            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                        >
                            <ZoomOut className="h-5 w-5" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close preview"
                        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            <div ref={wrapRef} className="relative flex min-h-0 flex-1 overflow-hidden">
                <div
                    className="absolute inset-y-0 left-16 right-16 sm:left-20 sm:right-20 touch-none"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onTouchCancel={onTouchEnd}
                >
                    {windowImages.map((img) => {
                        const active = img.id === current.id;
                        const url = urls[img.id];
                        if (!url) return null;
                        return (
                            <img
                                key={img.id}
                                ref={active ? imgRef : undefined}
                                src={url}
                                alt=""
                                draggable={false}
                                decoding="async"
                                fetchpriority={active ? 'high' : 'low'}
                                className={`absolute inset-0 m-auto max-h-full max-w-full select-none object-contain ${
                                    active ? 'z-[1] opacity-100' : 'pointer-events-none z-0 opacity-0'
                                }`}
                                style={
                                    active
                                        ? {
                                              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                                              transition: gesturing ? 'none' : 'transform 120ms ease-out',
                                          }
                                        : undefined
                                }
                                onDoubleClick={
                                    active ? (e) => toggleZoom({ x: e.clientX, y: e.clientY }) : undefined
                                }
                                onError={() => onImageError?.(img)}
                            />
                        );
                    })}
                    {!src && (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
                        </div>
                    )}
                </div>

                {hasPrev && transform.scale === 1 && (
                    <button
                        type="button"
                        aria-label="Previous photo"
                        onClick={onNav(-1)}
                        className="absolute inset-y-0 left-0 z-30 flex w-16 touch-manipulation items-center justify-center sm:w-20"
                    >
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white">
                            <ChevronLeft className="h-7 w-7" />
                        </span>
                    </button>
                )}
                {hasNext && transform.scale === 1 && (
                    <button
                        type="button"
                        aria-label="Next photo"
                        onClick={onNav(1)}
                        className="absolute inset-y-0 right-0 z-30 flex w-16 touch-manipulation items-center justify-center sm:w-20"
                    >
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white">
                            <ChevronRight className="h-7 w-7" />
                        </span>
                    </button>
                )}
            </div>

            {gallery.length > 1 && (
                <Filmstrip
                    gallery={gallery}
                    urls={urls}
                    currentId={current.id}
                    onSelect={goTo}
                    onWarm={warm}
                />
            )}
        </div>,
        document.body
    );
}
