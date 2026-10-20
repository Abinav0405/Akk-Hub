import { PHOTO_ASPECT_RATIO, PHOTO_JPEG_QUALITY } from '@/modules/progress/lib/config';
import { encodeCode128B } from '@/modules/progress/lib/code128';
import { loadImageFromFile, sourceDimensions } from '@/modules/progress/lib/loadImage';
import { brandingLogoUrl, getCompanyBranding } from '@/modules/progress/lib/branding';
import { isOverlayPosition } from '@/modules/progress/lib/overlayText';

export { loadImageFromFile };

/** Canonical overlay coordinate space — live preview is drawn here, then CSS-scaled. */
export const OVERLAY_REF_WIDTH = 1920;

export function overlayReferenceSize(aspectRatio = PHOTO_ASPECT_RATIO) {
  const width = OVERLAY_REF_WIDTH;
  const ar = Number(aspectRatio) > 0 ? Number(aspectRatio) : PHOTO_ASPECT_RATIO;
  return { width, height: Math.max(1, Math.round(width / ar)) };
}

function overlayScaleOf(scalePct) {
  const n = Number(scalePct);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(2.2, n / 100));
}

function overlayMetrics(width, lineCount, scalePct = 100) {
  const s = overlayScaleOf(scalePct);
  const pad = Math.max(1, Math.round(width * 0.025 * s));
  const fontSize = Math.max(1, Math.round(width * 0.016 * s));
  const lineHeight = Math.round(fontSize * 1.2);
  const blockH = lineHeight * Math.max(0, lineCount) + pad * 2;
  return { pad, fontSize, lineHeight, blockH, scale: s };
}

export function overlayStripHeight(width, lineCount) {
  return overlayMetrics(width, lineCount).blockH;
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(' ');
        if (ctx.measureText(rest).width <= maxWidth) {
          current = rest;
        } else {
          let clipped = rest;
          while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
            clipped = clipped.slice(0, -1);
          }
          current = `${clipped}…`;
        }
        break;
      }
    }
  }
  lines.push(current);
  return lines.slice(0, maxLines);
}

function overlayCorner(position, fallback = 'bl') {
  return isOverlayPosition(position) ? position : fallback;
}

function clampBox(x, y, boxW, boxH, width, height) {
  const maxX = Math.max(0, width - boxW);
  const maxY = Math.max(0, height - boxH);
  return {
    x: Math.round(Math.max(0, Math.min(Number.isFinite(x) ? x : 0, maxX))),
    y: Math.round(Math.max(0, Math.min(Number.isFinite(y) ? y : 0, maxY))),
  };
}

function originFromPct(width, height, xPct, yPct, boxW, boxH, fallbackCell = 'bl') {
  if (Number.isFinite(Number(xPct)) && Number.isFinite(Number(yPct))) {
    return {
      x: Math.round((width * Number(xPct)) / 100),
      y: Math.round((height * Number(yPct)) / 100),
    };
  }
  const pos = overlayCorner(fallbackCell);
  const v = pos.charAt(0);
  const h = pos.charAt(1);
  const x = h === 'r' ? width - boxW : h === 'c' ? (width - boxW) / 2 : 0;
  const y = v === 't' ? 0 : v === 'm' ? (height - boxH) / 2 : height - boxH;
  return clampBox(x, y, boxW, boxH, width, height);
}

function normalizeBlockSpec(spec) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    return {
      position: spec.position || spec.stackPosition || 'bl',
      xPct: spec.xPct ?? spec.stackXPct,
      yPct: spec.yPct ?? spec.stackYPct,
      scalePct: spec.scalePct ?? spec.stackScalePct ?? 100,
    };
  }
  return { position: spec || 'bl', xPct: null, yPct: null, scalePct: 100 };
}

/** Draws a stacked overlay block at a stored top-left % (dark pad + white text). */
export function drawOverlayBlock(ctx, width, height, lines, spec = 'bl') {
  if (!lines?.length) return null;
  const block = normalizeBlockSpec(spec);
  const { pad, fontSize, lineHeight, blockH } = overlayMetrics(width, lines.length, block.scalePct);
  const maxTextW = Math.round(width * 0.7);
  ctx.save();
  ctx.font = `600 ${fontSize}px 'DM Sans', Arial, sans-serif`;
  let textW = 0;
  lines.forEach((line) => {
    textW = Math.max(textW, ctx.measureText(String(line || '')).width);
  });
  const scrimW = Math.min(width, Math.max(pad * 2 + 8, Math.ceil(Math.min(maxTextW, textW) + pad * 2)));
  const { x: scrimX, y: top } = originFromPct(
    width,
    height,
    block.xPct,
    block.yPct,
    scrimW,
    blockH,
    block.position
  );

  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.fillRect(scrimX, top, scrimW, blockH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  const textX = scrimX + pad;
  lines.forEach((line, i) => {
    ctx.fillText(line, textX, top + pad + i * lineHeight, maxTextW);
  });
  ctx.restore();
  return { x: scrimX, y: top, w: scrimW, h: blockH };
}

/** Draws the burned-in overlay (dark scrim + white text lines) onto a captured-photo canvas. */
export function drawOverlayOnCanvas(ctx, width, height, lines, position = 'bl') {
  drawOverlayBlock(ctx, width, height, lines, position);
}

export function drawOverlayLayout(ctx, width, height, layout) {
  if (!layout) return { top: 0, bottom: 0 };
  const reserved = { top: 0, bottom: 0 };
  const stackLines = (layout.stack || []).map((row) => (typeof row === 'string' ? row : row.text));
  const scalePct = layout.stackScalePct ?? layout.scalePct ?? 100;
  if (stackLines.length) {
    drawOverlayBlock(ctx, width, height, stackLines, {
      position: layout.stackPosition || 'bl',
      xPct: layout.stackXPct,
      yPct: layout.stackYPct,
      scalePct,
    });
  }
  if (layout.gps?.text) {
    drawOverlayBlock(ctx, width, height, [layout.gps.text], {
      position: layout.gps.position || 'br',
      xPct: layout.gps.xPct,
      yPct: layout.gps.yPct,
      scalePct,
    });
  }
  return reserved;
}

/**
 * Draws a Code 128 barcode + the same code as text, on a white tab flush
 * against the top-right edge — the per-photo verification mark.
 * The barcode is what Photo Verification auto-reads (survives a messaging
 * app recompressing the image); the text lets a person type it by hand.
 *
 * Sized to stay scannable after JPEG / WhatsApp, but still a corner strip:
 * integer module width (2–3px on normal frames), taller bars, and a quiet
 * zone *inside* the white pad. On tiny digitally-zoomed canvases (~240px)
 * modules drop to 1px so the full XXXX-XXXX payload still fits in-frame.
 *
 * Every bar is drawn at an INTEGER pixel size and position. Canvas anti-aliases
 * fractional-pixel fillRects, which blurs the black/white edges a scanner
 * depends on — before JPEG compression even gets a turn. imageSmoothing is
 * forced off for the same reason.
 */
/**
 * Code 128 + XXXX-XXXX on a white plate. Size scales the whole mark while
 * keeping integer module pixels, a quiet zone, and the white plate.
 * Position is the top-left of the plate as % of the frame (branding.verify_*).
 */
const VERIFY_REF = overlayReferenceSize();
const VERIFY_REF_PAD = Math.max(8, Math.round(OVERLAY_REF_WIDTH * 0.007));
const VERIFY_REF_BAR_H = Math.max(
  32,
  Math.min(44, Math.round(OVERLAY_REF_WIDTH * 0.02), Math.round(VERIFY_REF.height * 0.06))
);
const VERIFY_REF_FONT = Math.max(10, Math.round(OVERLAY_REF_WIDTH * 0.007));
const VERIFY_REF_MODULE_PX = 3;

/**
 * Plate metrics scale linearly from a 1920×1440 photo so a 600px admin
 * preview, a phone viewfinder, and a 2560px JPEG keep the same relative size.
 * Module pixels stay integers; quiet zone stays inside the white plate.
 */
export function verificationMarkMetrics(width, height, code, scalePct = 100) {
  const bits = encodeCode128B(code);
  const s = overlayScaleOf(scalePct);
  const k = Math.max(1, Number(width) || 1) / OVERLAY_REF_WIDTH;
  let quiet = 14;
  const pad = Math.max(1, Math.round(VERIFY_REF_PAD * s * k));
  const inner = Math.max(32, Math.max(1, Number(width) || 1) - pad * 2);
  let modulePx = Math.max(1, Math.round(VERIFY_REF_MODULE_PX * s * k));
  while (quiet > 10 && (bits.length + quiet * 2) * modulePx > inner) {
    quiet -= 1;
  }
  let moduleCount = bits.length + quiet * 2;
  while (moduleCount * modulePx > inner && modulePx > 1) {
    modulePx -= 1;
  }
  if (moduleCount * modulePx > inner) modulePx = 1;
  moduleCount = bits.length + quiet * 2;
  const barHeight = Math.max(1, Math.round(VERIFY_REF_BAR_H * s * k));
  const fontSize = Math.max(1, Math.round(VERIFY_REF_FONT * s * k));
  const textGap = Math.max(1, Math.round(Math.max(3, Math.round(VERIFY_REF_PAD * 0.4)) * s * k));
  const barcodeWidth = moduleCount * modulePx;
  return {
    bits,
    quiet,
    pad,
    modulePx,
    moduleCount,
    barHeight,
    fontSize,
    textGap,
    barcodeWidth,
  };
}

export function verificationPlateSize(ctx, width, height, code, scalePct = 100) {
  const refW = OVERLAY_REF_WIDTH;
  const refH = VERIFY_REF.height;
  const refM = verificationMarkMetrics(refW, refH, code, scalePct);
  ctx.save();
  ctx.font = `700 ${refM.fontSize}px 'DM Sans', Arial, sans-serif`;
  const refTextWidth = ctx.measureText(code).width;
  ctx.restore();
  const refPlateW = Math.round(Math.min(refW, Math.max(refM.barcodeWidth, refTextWidth) + refM.pad * 2));
  const refPlateH = Math.round(refM.barHeight + refM.fontSize + refM.textGap + refM.pad * 2);
  const plateWidth = Math.max(1, Math.round((refPlateW / refW) * width));
  const plateHeight = Math.max(1, Math.round((refPlateH / refH) * height));
  const m = verificationMarkMetrics(width, height, code, scalePct);
  while (m.barcodeWidth + m.pad * 2 > plateWidth && m.modulePx > 1) {
    m.modulePx -= 1;
    m.barcodeWidth = m.moduleCount * m.modulePx;
  }
  return { ...m, plateWidth, plateHeight };
}

/** Paints the mark onto a plate-sized canvas for the live/admin preview. */
export function renderVerificationPlateCanvas(canvas, frameW, frameH, code, scalePct = 100) {
  if (!canvas || !code) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const m = verificationPlateSize(ctx, frameW, frameH, code, scalePct);
  if (canvas.width !== m.plateWidth) canvas.width = m.plateWidth;
  if (canvas.height !== m.plateHeight) canvas.height = m.plateHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paintVerificationMark(ctx, m.plateWidth, m.plateHeight, code, 0, 0, m);
  return m;
}

function paintVerificationMark(ctx, width, height, code, plateX, plateY, m) {
  const { bits, quiet, pad, modulePx, barHeight, fontSize, textGap, barcodeWidth, plateWidth, plateHeight } = m;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.font = `700 ${fontSize}px 'DM Sans', Arial, sans-serif`;

  const flushRight = plateX + plateWidth >= width - 1;
  const flushTop = plateY <= 1;
  const radius = Math.min(6, Math.round(pad * 0.75));

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (flushRight && flushTop) {
    ctx.moveTo(plateX + radius, plateY);
    ctx.lineTo(width, plateY);
    ctx.lineTo(width, plateY + plateHeight);
    ctx.lineTo(plateX + radius, plateY + plateHeight);
    ctx.arcTo(plateX, plateY + plateHeight, plateX, plateY + plateHeight - radius, radius);
    ctx.lineTo(plateX, plateY + radius);
    ctx.arcTo(plateX, plateY, plateX + radius, plateY, radius);
  } else {
    const x2 = plateX + plateWidth;
    const y2 = plateY + plateHeight;
    ctx.moveTo(plateX + radius, plateY);
    ctx.lineTo(x2 - radius, plateY);
    ctx.arcTo(x2, plateY, x2, plateY + radius, radius);
    ctx.lineTo(x2, y2 - radius);
    ctx.arcTo(x2, y2, x2 - radius, y2, radius);
    ctx.lineTo(plateX + radius, y2);
    ctx.arcTo(plateX, y2, plateX, y2 - radius, radius);
    ctx.lineTo(plateX, plateY + radius);
    ctx.arcTo(plateX, plateY, plateX + radius, plateY, radius);
  }
  ctx.closePath();
  ctx.fill();

  const barX = Math.round(plateX + (plateWidth - barcodeWidth) / 2) + quiet * modulePx;
  const barY = Math.round(plateY + pad);
  ctx.fillStyle = '#000000';
  let runStart = -1;
  for (let i = 0; i <= bits.length; i += 1) {
    const dark = i < bits.length && bits[i] === '1';
    if (dark && runStart < 0) runStart = i;
    if (!dark && runStart >= 0) {
      ctx.fillRect(barX + runStart * modulePx, barY, (i - runStart) * modulePx, barHeight);
      runStart = -1;
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(code, Math.round(plateX + plateWidth / 2), barY + barHeight + textGap);
  ctx.restore();
}

export function drawVerificationMark(ctx, width, height, code, branding = {}) {
  if (!code) return null;
  const scalePct = branding?.verify_scale_pct ?? 100;
  const m = verificationPlateSize(ctx, width, height, code, scalePct);
  const { x: plateX, y: plateY } = originFromPct(
    width,
    height,
    branding?.verify_x_pct,
    branding?.verify_y_pct,
    m.plateWidth,
    m.plateHeight,
    'tr'
  );
  paintVerificationMark(ctx, width, height, code, plateX, plateY, m);
  return { x: plateX, y: plateY, w: m.plateWidth, h: m.plateHeight };
}

export async function stampVerificationMark(canvas, code, branding) {
  if (!canvas || !code) return;
  const row = branding || await getCompanyBranding().catch(() => null);
  drawVerificationMark(canvas.getContext('2d'), canvas.width, canvas.height, code, row || {});
}

let logoImagePromise = null;
let logoImageKey = null;

export function invalidateBrandLogoCache() {
  logoImagePromise = null;
  logoImageKey = null;
  brightLogoCache.clear();
}

/**
 * Preloads and caches the company logo — live camera captures reuse it.
 * A failed load isn't cached: it's usually transient (a network blip on first
 * launch), so the next call retries instead of permanently dropping the watermark.
 * Uploaded attachments must not call this path (no logo burned in).
 */
/** URL-safe Progress fallback — avoids Windows collision with Timesheet `Akk-logo.png`. */
const PROGRESS_FALLBACK_LOGO = '/akk-logo-progress.png';

export function getBrandLogoImage(src) {
  const key = src || PROGRESS_FALLBACK_LOGO;
  if (logoImageKey !== key) {
    logoImagePromise = null;
    logoImageKey = key;
    brightLogoCache.clear();
  }
  if (!logoImagePromise) {
    logoImagePromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (key !== PROGRESS_FALLBACK_LOGO) {
          logoImagePromise = null;
          logoImageKey = null;
          resolve(getBrandLogoImage(PROGRESS_FALLBACK_LOGO));
          return;
        }
        logoImagePromise = null;
        logoImageKey = null;
        resolve(null);
      };
      img.src = key;
    });
  }
  return logoImagePromise;
}

const brightLogoCache = new Map();

/**
 * Stamps logo + company name as one unit at the stored top-left % of frame.
 * `reserved` is ignored — placements are absolute so GPS text length cannot
 * shift the logo after save.
 */
export function drawBrandMark(ctx, width, height, logoImg, branding = {}, _opts = {}) {
  const name = String(branding.company_name || '').trim();
  if (!logoImg && !name) return null;
  const sizePct = Math.max(2, Math.min(30, Number(branding.logo_size_pct) || 8));
  const opacity = Math.max(0.4, Math.min(1, (Number(branding.logo_opacity_pct) || 92) / 100));
  const nativeW = logoImg ? (logoImg.naturalWidth || logoImg.width || 1) : 1;
  const nativeH = logoImg ? (logoImg.naturalHeight || logoImg.height || 1) : 1;
  const lw = logoImg ? Math.round(width * (sizePct / 100)) : 0;
  const lh = logoImg ? Math.max(1, Math.round(lw * (nativeH / nativeW))) : 0;
  const fontSize = Math.max(1, Math.round(width * 0.018 * (sizePct / 8)));
  const lineH = Math.round(fontSize * 1.15);
  const gap = Math.round(width * 0.01 * Math.max(0.5, sizePct / 8));
  const maxNameW = Math.round(width * 0.42);

  ctx.save();
  ctx.font = `700 ${fontSize}px 'DM Sans', Arial, sans-serif`;
  const nameLines = name ? wrapCanvasText(ctx, name, maxNameW, 2) : [];
  const nameH = nameLines.length * lineH;
  const nameW = nameLines.reduce((w, line) => Math.max(w, ctx.measureText(line).width), 0);

  const unitW = lw + (nameH ? gap + Math.ceil(nameW) : 0);
  const unitH = Math.max(lh, nameH);
  const { x: vx, y: vy } = originFromPct(
    width,
    height,
    branding.logo_x_pct,
    branding.logo_y_pct,
    unitW,
    unitH,
    branding.logo_position || 'br'
  );

  ctx.globalAlpha = opacity;
  const logoX = vx;
  const logoY = vy + Math.round((unitH - lh) / 2);
  const nameX = vx + lw + (lw ? gap : 0);
  const nameY = vy + Math.round((unitH - nameH) / 2);

  if (logoImg && lw && lh) {
    ctx.drawImage(logoImg, logoX, logoY, lw, lh);
  }
  if (nameLines.length) {
    ctx.globalAlpha = Math.max(opacity, 0.85);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    nameLines.forEach((line, i) => {
      ctx.fillText(line, nameX, nameY + i * lineH);
    });
  }
  ctx.restore();
  return { x: vx, y: vy, w: unitW, h: unitH };
}

export function drawLogo(ctx, width, height, logoImg, branding = {}, opts = {}) {
  drawBrandMark(ctx, width, height, logoImg, branding, opts);
}

/** Legacy name — same as drawBrandMark with default bottom-right placement. */
export function drawBrandWatermark(ctx, width, height, logoImg, branding, stripHeight = 0) {
  drawBrandMark(ctx, width, height, logoImg, branding || { logo_position: 'br', logo_size_pct: 8, logo_opacity_pct: 92 }, {
    stripHeight,
  });
}

/**
 * Single painter for admin preview, live viewfinder, and JPEG burn-in.
 * Coordinate space is the photo frame (width × height at PHOTO_ASPECT_RATIO).
 */
export function paintPhotoOverlays(ctx, width, height, {
  branding = {},
  layout = null,
  logoImg = null,
  verificationCode = null,
} = {}) {
  const boxes = { brand: null, stack: null, gps: null, verify: null };
  if (layout) {
    const stackLines = (layout.stack || []).map((row) => (typeof row === 'string' ? row : row.text));
    const scalePct = layout.stackScalePct ?? layout.scalePct ?? branding.overlay_scale_pct ?? 100;
    if (stackLines.length) {
      boxes.stack = drawOverlayBlock(ctx, width, height, stackLines, {
        position: layout.stackPosition || branding.overlay_position || 'bl',
        xPct: layout.stackXPct ?? branding.overlay_x_pct,
        yPct: layout.stackYPct ?? branding.overlay_y_pct,
        scalePct,
      });
    }
    if (layout.gps?.text) {
      boxes.gps = drawOverlayBlock(ctx, width, height, [layout.gps.text], {
        position: layout.gps.position || branding.gps_position || 'br',
        xPct: layout.gps.xPct ?? branding.gps_x_pct,
        yPct: layout.gps.yPct ?? branding.gps_y_pct,
        scalePct,
      });
    }
  }
  boxes.brand = drawBrandMark(ctx, width, height, logoImg, branding) || null;
  if (verificationCode) {
    boxes.verify = drawVerificationMark(ctx, width, height, verificationCode, branding);
  }
  return boxes;
}

async function bitmapFromBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(blob);
      } catch {
        /* fall through */
      }
    }
  }
  return loadImageFromFile(blob);
}

function isHtmlVideo(source) {
  return Boolean(source && source.tagName === 'VIDEO' && source.videoWidth > 0);
}

function orientationMismatch(aW, aH, bW, bH) {
  if (!aW || !aH || !bW || !bH) return false;
  return (aW >= aH) !== (bW >= bH);
}

function videoStill(video) {
  const width = Number(video.videoWidth) || 0;
  const height = Number(video.videoHeight) || 0;
  if (!width || !height) return null;
  return { bitmap: video, width, height };
}

let cachedImageCapture = null;
let cachedImageCaptureTrack = null;

function imageCaptureFor(track) {
  if (cachedImageCapture && cachedImageCaptureTrack === track) return cachedImageCapture;
  cachedImageCaptureTrack = track;
  cachedImageCapture = new ImageCapture(track);
  return cachedImageCapture;
}

/**
 * Grab the current preview frame. `takePhoto()` is a full still-camera shot
 * (autofocus + high-res JPEG) and is what made the shutter feel ~0.5s late.
 * grabFrame copies the live view instantly; drawImage(video) is the next
 * fallback — and the one we use when grabFrame's buffer is rotated relative
 * to the viewfinder (common on landscape Android). takePhoto is last-resort
 * only if both of those fail.
 */
async function captureHighResStill(source) {
  const video = isHtmlVideo(source) ? source : null;
  const track = source.srcObject?.getVideoTracks?.()?.[0] || video?.srcObject?.getVideoTracks?.()?.[0];
  if (track && typeof ImageCapture === 'function') {
    try {
      const ic = imageCaptureFor(track);
      const bitmap = await ic.grabFrame();
      if (bitmap?.width > 0 && bitmap?.height > 0) {
        if (video && orientationMismatch(bitmap.width, bitmap.height, video.videoWidth, video.videoHeight)) {
          bitmap.close?.();
        } else {
          return { bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
        }
      } else {
        bitmap?.close?.();
      }
    } catch {
      cachedImageCapture = null;
      cachedImageCaptureTrack = null;
    }
  }

  const fromVideo = video ? videoStill(video) : null;
  if (fromVideo) return fromVideo;

  const preview = sourceDimensions(source);
  if (preview.width && preview.height) {
    return { bitmap: source, width: preview.width, height: preview.height };
  }

  if (track && typeof ImageCapture === 'function') {
    try {
      const blob = await imageCaptureFor(track).takePhoto();
      const bitmap = await bitmapFromBlob(blob);
      const bw = sourceDimensions(bitmap).width;
      const bh = sourceDimensions(bitmap).height;
      if (video && orientationMismatch(bw, bh, video.videoWidth, video.videoHeight)) {
        bitmap.close?.();
        const fallback = videoStill(video);
        if (fallback) return fallback;
      }
      return {
        bitmap,
        width: bw,
        height: bh,
        close: () => bitmap.close?.(),
      };
    } catch {
      /* fall through */
    }
  }

  return { bitmap: source, width: preview.width, height: preview.height };
}

function cropToAspect(sourceW, sourceH, aspectRatio, zoom = 1) {
  const sourceRatio = sourceW / sourceH;
  let sx;
  let sy;
  let sw;
  let sh;
  if (sourceRatio > aspectRatio) {
    sh = sourceH;
    sw = sh * aspectRatio;
    sx = (sourceW - sw) / 2;
    sy = 0;
  } else {
    sw = sourceW;
    sh = sw / aspectRatio;
    sx = 0;
    sy = (sourceH - sh) / 2;
  }
  const z = Math.max(1, Number(zoom) || 1);
  if (z > 1.001) {
    const zw = sw / z;
    const zh = sh / z;
    sx += (sw - zw) / 2;
    sy += (sh - zh) / 2;
    sw = zw;
    sh = zh;
  }
  return { sx, sy, sw, sh };
}

/**
 * CSS pixel rect of the captured 4:3 photo inside an object-cover viewfinder.
 * Live overlays must sit in this rectangle so they match the JPEG crop.
 * `coverZoom` > 1 is CSS digital zoom (the visible frame is then 4:3-cropped).
 */
export function photoOverlayFrameRect(viewW, viewH, sourceW, sourceH, aspectRatio, coverZoom = 1) {
  const vw = Math.max(1, Number(viewW) || 1);
  const vh = Math.max(1, Number(viewH) || 1);
  const ar = Number(aspectRatio) > 0 ? Number(aspectRatio) : PHOTO_ASPECT_RATIO;
  const z = Math.max(1, Number(coverZoom) || 1);
  if (z > 1.001 || !sourceW || !sourceH) {
    const crop = cropToAspect(vw, vh, ar, 1);
    return { x: crop.sx, y: crop.sy, width: crop.sw, height: crop.sh };
  }
  const cover = Math.max(vw / sourceW, vh / sourceH);
  const ox = (vw - sourceW * cover) / 2;
  const oy = (vh - sourceH * cover) / 2;
  const crop = cropToAspect(sourceW, sourceH, ar, 1);
  return {
    x: ox + crop.sx * cover,
    y: oy + crop.sy * cover,
    width: crop.sw * cover,
    height: crop.sh * cover,
  };
}

/**
 * Draws a video frame OR a static image, center-cropped to `aspectRatio` (w/h),
 * onto a new canvas. `maxWidth` is a cap. A digitally-zoomed crop smaller than
 * 720px is upscaled so the verification mark still has scannable modules.
 * Overlay text and the AKK logo are applied only for live
 * camera captures (non-empty `lines`). Pass `null`/`[]` for an uploaded
 * attachment so it is cropped only — no GPS, time, or logo burned in.
 * `applyBrand` overrides the default (brand follows overlay).
 * `cropZoom` > 1 center-crops further for digital (CSS) zoom fallback.
 */
export async function captureFrameToCanvas(source, aspectRatio, maxWidth, lines, applyBrand, cropZoom = 1, brandingHint) {
  const still = await captureHighResStill(source);
  const { bitmap, width: sourceW, height: sourceH } = still;
  if (!sourceW || !sourceH) {
    still.close?.();
    throw new Error('Photo source has no dimensions');
  }

  const canvas = cropIntoCanvas(bitmap, sourceW, sourceH, aspectRatio, maxWidth, cropZoom);
  still.close?.();
  await paintCaptureOverlays(canvas, lines, applyBrand, brandingHint);
  return canvas;
}

/**
 * Centre-crops `bitmap` to `aspectRatio` (then `cropZoom`) onto a fresh canvas.
 * Digitally-zoomed Android crops can be ~200px — too small for Code 128 after
 * JPEG. Upscale so the caller-drawn mark still has ~2px modules. Never exceed
 * maxWidth; never upscale a normal full-res capture.
 */
function cropIntoCanvas(bitmap, sourceW, sourceH, aspectRatio, maxWidth, cropZoom) {
  const { sx, sy, sw, sh } = cropToAspect(sourceW, sourceH, aspectRatio, cropZoom);
  const MIN_VERIFY_WIDTH = 720;
  const cap = Math.max(1, Math.round(maxWidth || sw));
  let outputWidth = Math.max(1, Math.round(Math.min(cap, sw)));
  if (outputWidth < MIN_VERIFY_WIDTH && cap >= MIN_VERIFY_WIDTH) {
    outputWidth = MIN_VERIFY_WIDTH;
  }
  const outputHeight = Math.round(outputWidth / aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  return canvas;
}

/**
 * Synchronous shutter snapshot: copies the live <video> frame (or an already
 * decoded image/canvas) straight onto a cropped canvas — no await, so the frame
 * is frozen the instant the shutter is pressed. `captureFrameToCanvas` goes
 * through ImageCapture.grabFrame(), which waits on the camera pipeline for a
 * fresh frame and is what made the shutter feel ~0.5s late. Overlays, the
 * verification mark and JPEG encoding are done afterwards, in the background.
 */
export function snapshotToCanvas(source, aspectRatio, maxWidth, cropZoom = 1) {
  const { width, height } = sourceDimensions(source);
  if (!width || !height) throw new Error('Photo source has no dimensions');
  return cropIntoCanvas(source, width, height, aspectRatio, maxWidth, cropZoom);
}

/** Burns the live-camera overlays (text, GPS, brand mark) into a cropped capture canvas. */
export async function paintCaptureOverlays(canvas, lines, applyBrand, brandingHint) {
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;
  const ctx = canvas.getContext('2d');
  const layout = normalizeCaptureOverlay(lines);
  const shouldOverlay = Boolean(layout && ((layout.stack && layout.stack.length) || layout.gps));
  const shouldBrand = applyBrand ?? shouldOverlay;
  const branding = brandingHint !== undefined
    ? brandingHint
    : (shouldOverlay || shouldBrand ? await getCompanyBranding().catch(() => null) : null);
  if (shouldOverlay || shouldBrand) {
    const overlay = shouldOverlay
      ? {
          ...layout,
          stackPosition: layout.stackPosition || branding?.overlay_position || 'bl',
          stackXPct: layout.stackXPct ?? branding?.overlay_x_pct,
          stackYPct: layout.stackYPct ?? branding?.overlay_y_pct,
          stackScalePct: layout.stackScalePct ?? branding?.overlay_scale_pct ?? 100,
          gps: layout.gps
            ? {
                ...layout.gps,
                xPct: layout.gps.xPct ?? branding?.gps_x_pct,
                yPct: layout.gps.yPct ?? branding?.gps_y_pct,
              }
            : null,
        }
      : null;
    const logoImg = shouldBrand ? await getBrandLogoImage(brandingLogoUrl(branding)) : null;
    paintPhotoOverlays(ctx, outputWidth, outputHeight, {
      branding,
      layout: overlay,
      logoImg,
      verificationCode: null,
    });
  }
  return canvas;
}

function normalizeCaptureOverlay(spec) {
  if (!spec) return null;
  if (Array.isArray(spec)) {
    if (!spec.length) return null;
    return { stack: spec.map((text) => ({ text })), stackPosition: 'bl', gps: null };
  }
  if (typeof spec === 'object') return spec;
  return null;
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function canvasToJpegBlob(canvas, quality = PHOTO_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        resolve(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
      } catch (e) {
        reject(e);
      }
    };
    if (typeof canvas.toBlob !== 'function') {
      fallback();
      return;
    }
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : fallback()),
        'image/jpeg',
        quality
      );
    } catch {
      fallback();
    }
  });
}
