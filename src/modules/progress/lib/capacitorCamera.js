import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeCameraLenses = registerPlugin('NativeCameraLenses');

/** Android WebView often reports MediaStream zoom that never actually changes pixels. */
export function nativeForcesDigitalZoom() {
  return Capacitor.isNativePlatform();
}

export async function listNativeLenses() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await NativeCameraLenses.listLenses();
    return result || null;
  } catch (e) {
    console.warn('[camera-ultra] listLenses failed:', e);
    return null;
  }
}

let previewListener = null;
let previewLock = Promise.resolve();

function jpegBase64ToBlob(b64) {
  const raw = String(b64 || '');
  const bin = atob(raw);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

async function removePreviewListener() {
  const listener = previewListener;
  previewListener = null;
  try {
    await listener?.remove?.();
  } catch {
    /* ignore */
  }
}

/**
 * Opens the ultra-wide Camera2 session. `onFrame(blob)` receives preview JPEGs.
 * Stop getUserMedia first — Camera2 and WebView cannot share the sensor.
 */
export function startNativeUltraWidePreview({ cameraId, zoomRatio, onFrame } = {}) {
  previewLock = previewLock
    .catch(() => {})
    .then(async () => {
      await stopNativeUltraWidePreviewInner();
      if (!Capacitor.isNativePlatform()) {
        throw new Error('Native ultra-wide is only available in the Android app');
      }
      previewListener = await NativeCameraLenses.addListener('previewFrame', (ev) => {
        if (!ev?.jpeg) return;
        try {
          onFrame?.(jpegBase64ToBlob(ev.jpeg));
        } catch (e) {
          console.warn('[camera-ultra] preview frame decode failed:', e);
        }
      });
      await NativeCameraLenses.startPreview({
        cameraId: cameraId || '',
        zoomRatio: Number(zoomRatio) || 0,
      });
    });
  return previewLock;
}

async function stopNativeUltraWidePreviewInner() {
  await removePreviewListener();
  if (!Capacitor.isNativePlatform()) return;
  try {
    await NativeCameraLenses.stopPreview();
  } catch {
    /* already stopped */
  }
}

export function stopNativeUltraWidePreview() {
  previewLock = previewLock.catch(() => {}).then(stopNativeUltraWidePreviewInner);
  return previewLock;
}

export async function captureNativeUltraWideStill() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native ultra-wide capture is only available in the Android app');
  }
  const result = await NativeCameraLenses.captureStill();
  if (!result?.jpeg) throw new Error('Ultra-wide capture returned no image');
  return jpegBase64ToBlob(result.jpeg);
}

/**
 * Source-pixel crop matching a CSS object-cover preview with digital zoom
 * (enlarged/clipped video or transform: scale). View size is the viewfinder.
 */
export function previewCoverCrop(sourceW, sourceH, viewW, viewH, zoom) {
  const sw0 = Math.max(1, Number(sourceW) || 1);
  const sh0 = Math.max(1, Number(sourceH) || 1);
  const vw = Math.max(1, Number(viewW) || sw0);
  const vh = Math.max(1, Number(viewH) || sh0);
  const cover = Math.max(vw / sw0, vh / sh0);
  let visW = vw / cover;
  let visH = vh / cover;
  let sx = (sw0 - visW) / 2;
  let sy = (sh0 - visH) / 2;
  const z = Math.max(1, Number(zoom) || 1);
  if (z > 1.001) {
    const zw = visW / z;
    const zh = visH / z;
    sx += (visW - zw) / 2;
    sy += (visH - zh) / 2;
    visW = zw;
    visH = zh;
  }
  sx = Math.min(Math.max(0, sx), sw0 - 1);
  sy = Math.min(Math.max(0, sy), sh0 - 1);
  visW = Math.min(visW, sw0 - sx);
  visH = Math.min(visH, sh0 - sy);
  return { sx, sy, sw: Math.max(1, visW), sh: Math.max(1, visH) };
}

async function grabPreviewStill(source) {
  if (source && !source.srcObject) {
    const width = Number(source.naturalWidth || source.videoWidth || source.width) || 0;
    const height = Number(source.naturalHeight || source.videoHeight || source.height) || 0;
    if (width && height) return { bitmap: source, width, height };
  }
  const video = source;
  const track = video?.srcObject?.getVideoTracks?.()?.[0];
  if (track && typeof ImageCapture === 'function') {
    try {
      const bitmap = await new ImageCapture(track).grabFrame();
      if (bitmap?.width > 0 && bitmap?.height > 0) {
        const vw = Number(video?.videoWidth) || 0;
        const vh = Number(video?.videoHeight) || 0;
        if (vw && vh && (bitmap.width >= bitmap.height) !== (vw >= vh)) {
          bitmap.close?.();
        } else {
          return {
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
            close: () => bitmap.close?.(),
          };
        }
      } else {
        bitmap?.close?.();
      }
    } catch {
      /* fall through to the live <video> frame */
    }
  }
  const width = Number(video?.videoWidth) || 0;
  const height = Number(video?.videoHeight) || 0;
  return { bitmap: video, width, height };
}

/**
 * Copies the zoomed object-cover preview into a canvas so captureFrameToCanvas
 * can 4:3-crop + overlay it. Callers still burn the verification mark afterward.
 */
export async function canvasFromZoomedPreview(source, zoom, viewW, viewH) {
  const w = Number(viewW)
    || source.clientWidth
    || source.offsetWidth
    || source.videoWidth
    || source.naturalWidth;
  const h = Number(viewH)
    || source.clientHeight
    || source.offsetHeight
    || source.videoHeight
    || source.naturalHeight;
  const still = await grabPreviewStill(source);
  if (!still.width || !still.height) {
    still.close?.();
    throw new Error('Camera frame has no dimensions');
  }
  const layoutW = Number(source.videoWidth || source.naturalWidth) || still.width;
  const layoutH = Number(source.videoHeight || source.naturalHeight) || still.height;
  const layoutCrop = previewCoverCrop(layoutW, layoutH, w, h, zoom);
  const scaleX = still.width / layoutW;
  const scaleY = still.height / layoutH;
  const sx = layoutCrop.sx * scaleX;
  const sy = layoutCrop.sy * scaleY;
  const sw = layoutCrop.sw * scaleX;
  const sh = layoutCrop.sh * scaleY;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    still.close?.();
    throw new Error('Could not allocate zoom canvas');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(still.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  still.close?.();
  return canvas;
}
