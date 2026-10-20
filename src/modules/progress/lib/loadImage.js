const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;

/**
 * Android WebView <input type="file"> often hands back a File with an empty
 * MIME type even when the user picked a JPEG. Treat empty/octet-stream plus a
 * plausible name (or no name) as an image so capture/verify don't silently skip.
 */
export function isLikelyImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type && type !== 'application/octet-stream') return false;
  if (file.name && IMAGE_NAME.test(file.name)) return true;
  return !type;
}

export function sourceDimensions(source) {
  const width = Number(source?.videoWidth || source?.naturalWidth || source?.width) || 0;
  const height = Number(source?.videoHeight || source?.naturalHeight || source?.height) || 0;
  return { width, height };
}

/** JPEG SOF / PNG IHDR size without a full decode. Used so verify does not upscale small files. */
async function peekImageSize(blob) {
  if (!blob) return null;
  try {
    const bytes = new Uint8Array(await blob.slice(0, 128 * 1024).arrayBuffer());
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 8 < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        const isSof =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          if (width > 0 && height > 0) return { width, height };
        }
        if (len < 2) break;
        offset += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function capBitmapLongEdge(bitmap, maxDimension, quality) {
  if (!bitmap || !maxDimension) return bitmap;
  const { width, height } = sourceDimensions(bitmap);
  const long = Math.max(width, height);
  if (!long || long <= maxDimension) return bitmap;
  const scale = maxDimension / long;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  try {
    const next = await createImageBitmap(bitmap, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: quality,
    });
    bitmap.close?.();
    return next;
  } catch {
    return bitmap;
  }
}

function downscaleToCanvas(img, maxDimension) {
  const { width, height } = sourceDimensions(img);
  const long = Math.max(width, height);
  const scale = maxDimension > 0 && long > maxDimension ? maxDimension / long : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Decode a still into an ImageBitmap (preferred: honors EXIF orientation on
 * Chromium/Android WebView) or an <img>. Callers must use sourceDimensions().
 * `maxDimension` downscales during decode so Android WebView does not OOM on
 * a 12MP gallery photo (verification only — capture paths omit this).
 */
export async function loadImageFromFile(file, options = {}) {
  const maxDimension = Number(options.maxDimension) || 0;
  const quality = options.resizeQuality || 'medium';
  const bitmapOpts = { imageOrientation: 'from-image' };

  if (maxDimension > 0) {
    bitmapOpts.resizeQuality = quality;
    const peeked = await peekImageSize(file);
    const long = peeked ? Math.max(peeked.width, peeked.height) : Infinity;
    // Only a width hint — Chromium resizes after EXIF orientation. Passing both
    // stored dimensions would squash a rotated portrait frame.
    if (long > maxDimension) bitmapOpts.resizeWidth = maxDimension;
  }

  if (typeof createImageBitmap === 'function') {
    try {
      return await capBitmapLongEdge(await createImageBitmap(file, bitmapOpts), maxDimension, quality);
    } catch {
      try {
        const fallbackOpts = maxDimension > 0 && bitmapOpts.resizeWidth
          ? { resizeWidth: bitmapOpts.resizeWidth, resizeQuality: quality }
          : undefined;
        return await capBitmapLongEdge(await createImageBitmap(file, fallbackOpts), maxDimension, quality);
      } catch {
        /* fall through to <img> — some WebViews reject HEIC/odd types */
      }
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      if (maxDimension > 0 && typeof createImageBitmap === 'function') {
        try {
          const bitmap = await capBitmapLongEdge(
            await createImageBitmap(img, { imageOrientation: 'from-image', resizeQuality: quality }),
            maxDimension,
            quality
          );
          resolve(bitmap);
          return;
        } catch {
          /* canvas fallback below */
        }
      }
      if (maxDimension > 0) {
        resolve(downscaleToCanvas(img, maxDimension));
        return;
      }
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
