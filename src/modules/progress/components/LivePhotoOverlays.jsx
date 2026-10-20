import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/modules/progress/lib/utils';
import {
  clampInt,
  clampPct,
  LOGO_SIZE_MIN,
  LOGO_SIZE_MAX,
  OVERLAY_SCALE_MIN,
  OVERLAY_SCALE_MAX,
  VERIFY_SCALE_MIN,
  VERIFY_SCALE_MAX,
} from '@/modules/progress/lib/branding';
import { PHOTO_ASPECT_RATIO } from '@/modules/progress/lib/config';
import {
  getBrandLogoImage,
  overlayReferenceSize,
  paintPhotoOverlays,
} from '@/modules/progress/lib/canvasOverlay';

const GRID_LINES = [25, 50, 75];

function snapPct(value) {
  return Math.round(clampPct(value, 0) * 2) / 2;
}

function boxesClose(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = ['brand', 'stack', 'gps', 'verify'];
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    if (!x && !y) return true;
    if (!x || !y) return false;
    return x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
  });
}

function hitboxStyle(box, refW, refH) {
  if (!box) return { display: 'none' };
  return {
    position: 'absolute',
    left: `${(box.x / refW) * 100}%`,
    top: `${(box.y / refH) * 100}%`,
    width: `${(Math.max(1, box.w) / refW) * 100}%`,
    height: `${(Math.max(1, box.h) / refH) * 100}%`,
    pointerEvents: 'auto',
  };
}

function ResizeHandle({ onPointerDown, dragBind }) {
  return (
    <span
      data-resize="1"
      className="absolute -bottom-1 -right-1 z-10 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white bg-slate-900 shadow"
      aria-hidden
      onPointerDown={onPointerDown}
      {...dragBind}
    />
  );
}

function PreviewGrid() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
      {GRID_LINES.map((pct) => (
        <div
          key={`v${pct}`}
          className="absolute top-0 bottom-0 w-px bg-white/25"
          style={{ left: `${pct}%` }}
        />
      ))}
      {GRID_LINES.map((pct) => (
        <div
          key={`h${pct}`}
          className="absolute left-0 right-0 h-px bg-white/25"
          style={{ top: `${pct}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Logo, overlay wording, GPS, and barcode as they appear on a captured photo.
 * Drawn with the same canvas functions as JPEG burn-in. Admin preview sets
 * interactive to drag/resize; the worker viewfinder does not. Gridlines are
 * CSS-only and never burned into JPEGs.
 */
export default function LivePhotoOverlays({
  branding,
  layout,
  logoUrl,
  companyName,
  verificationCode,
  interactive = false,
  showGrid = false,
  onChange,
}) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [logoImg, setLogoImg] = useState(null);
  const [boxes, setBoxes] = useState(null);
  const [backing, setBacking] = useState(() => overlayReferenceSize(PHOTO_ASPECT_RATIO));

  useEffect(() => {
    let cancelled = false;
    getBrandLogoImage(logoUrl).then((img) => {
      if (!cancelled) setLogoImg(img || null);
    });
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return undefined;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const fw = Math.max(1, frame.clientWidth);
      const fh = Math.max(1, frame.clientHeight);
      const nextBacking = overlayReferenceSize(fw / fh);
      if (canvas.width !== nextBacking.width) canvas.width = nextBacking.width;
      if (canvas.height !== nextBacking.height) canvas.height = nextBacking.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, nextBacking.width, nextBacking.height);
      const next = paintPhotoOverlays(ctx, nextBacking.width, nextBacking.height, {
        branding: { ...branding, company_name: companyName ?? branding?.company_name },
        layout,
        logoImg,
        verificationCode,
      });
      setBacking((prev) => (
        prev.width === nextBacking.width && prev.height === nextBacking.height ? prev : nextBacking
      ));
      if (interactive) {
        setBoxes((prev) => (boxesClose(prev, next) ? prev : next));
      }
    };
    const run = () => {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(paint).catch(paint);
      } else {
        paint();
      }
    };
    run();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(run) : null;
    ro?.observe(frame);
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [branding, companyName, interactive, layout, logoImg, verificationCode]);

  const endDrag = () => {
    dragRef.current = null;
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !onChange) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (drag.mode === 'move') {
      const dx = ((e.clientX - drag.startX) / Math.max(1, rect.width)) * 100;
      const dy = ((e.clientY - drag.startY) / Math.max(1, rect.height)) * 100;
      onChange({
        [drag.xKey]: snapPct(drag.originX + dx),
        [drag.yKey]: snapPct(drag.originY + dy),
      });
      return;
    }
    if (drag.mode === 'resize') {
      const dist = (e.clientX - drag.startX + (e.clientY - drag.startY)) / 2;
      const next = clampInt(drag.startScale + dist * drag.factor, drag.min, drag.max, drag.startScale);
      onChange({ [drag.scaleKey]: next });
    }
  };

  const startMove = (xKey, yKey, originX, originY) => (e) => {
    if (!interactive || !onChange) return;
    if (e.target?.dataset?.resize) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: 'move',
      xKey,
      yKey,
      startX: e.clientX,
      startY: e.clientY,
      originX: Number(originX) || 0,
      originY: Number(originY) || 0,
    };
  };

  const startResize = (scaleKey, startScale, min, max, factor) => (e) => {
    if (!interactive || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: 'resize',
      scaleKey,
      startX: e.clientX,
      startY: e.clientY,
      startScale,
      min,
      max,
      factor,
    };
  };

  const dragBind = interactive
    ? {
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
      }
    : {};

  const unitClass = interactive
    ? 'cursor-grab touch-none select-none active:cursor-grabbing'
    : undefined;

  return (
    <div
      ref={frameRef}
      className={cn('absolute inset-0 overflow-hidden', !interactive && 'pointer-events-none')}
    >
      {showGrid ? <PreviewGrid /> : null}

      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
        aria-hidden
      />

      {interactive ? (
        <>
          <div
            style={hitboxStyle(boxes?.brand, backing.width, backing.height)}
            className={cn(unitClass, 'outline outline-1 outline-white/40')}
            onPointerDown={startMove('logo_x_pct', 'logo_y_pct', branding.logo_x_pct, branding.logo_y_pct)}
            {...dragBind}
          >
            <ResizeHandle
              onPointerDown={startResize('logo_size_pct', branding.logo_size_pct, LOGO_SIZE_MIN, LOGO_SIZE_MAX, 0.08)}
              dragBind={dragBind}
            />
          </div>

          {layout?.stack?.length > 0 && (
            <div
              style={hitboxStyle(boxes?.stack, backing.width, backing.height)}
              className={cn(unitClass, 'outline outline-1 outline-white/40')}
              onPointerDown={startMove('overlay_x_pct', 'overlay_y_pct', branding.overlay_x_pct, branding.overlay_y_pct)}
              {...dragBind}
            >
              <ResizeHandle
                onPointerDown={startResize('overlay_scale_pct', branding.overlay_scale_pct, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 0.6)}
                dragBind={dragBind}
              />
            </div>
          )}

          {layout?.gps && (
            <div
              style={hitboxStyle(boxes?.gps, backing.width, backing.height)}
              className={cn(unitClass, 'outline outline-1 outline-white/40')}
              onPointerDown={startMove('gps_x_pct', 'gps_y_pct', branding.gps_x_pct, branding.gps_y_pct)}
              {...dragBind}
            />
          )}

          {verificationCode ? (
            <div
              style={hitboxStyle(boxes?.verify, backing.width, backing.height)}
              className={cn(unitClass, 'outline outline-1 outline-white/50')}
              onPointerDown={startMove('verify_x_pct', 'verify_y_pct', branding.verify_x_pct, branding.verify_y_pct)}
              {...dragBind}
            >
              <ResizeHandle
                onPointerDown={startResize('verify_scale_pct', branding.verify_scale_pct, VERIFY_SCALE_MIN, VERIFY_SCALE_MAX, 0.6)}
                dragBind={dragBind}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
