import { supabaseProgress } from '@/core/supabase'
import { Capacitor } from '@capacitor/core';
import * as ZXingNs from '@zxing/library';
import jsQRModule from 'jsqr';
import { loadImageFromFile, sourceDimensions } from '@/modules/progress/lib/loadImage';
import {
  extractVerificationCode,
  normalizeVerificationCode,
  isVerificationCodeFormat,
  VERIFICATION_ALPHABET,
} from '@/modules/progress/lib/verificationCode';
import { decodeCode128BCandidatesFromLuma } from '@/modules/progress/lib/code128';
import { sha256Hex, dHashFromImage, hammingDistanceHex } from '@/modules/progress/lib/photoHash';

export { loadImageFromFile as loadImageFile } from '@/modules/progress/lib/loadImage';

const ENGINE_FAIL_MSG = 'Verification engine failed to load. Refresh the page and try again.';

/** Thrown when barcode/QR libraries cannot be imported (e.g. Vite 504 outdated dep). */
export class VerificationEngineError extends Error {
  constructor(message = ENGINE_FAIL_MSG) {
    super(message);
    this.name = 'VerificationEngineError';
    this.status = 'scanner-unavailable';
  }
}

/** Public/no-login lookup — returns the matched photo's record, or null if the code isn't on file. */
export async function lookupVerificationCode(code) {
  // Stored as generateVerificationCode() ("XXXX-XXXX"). RPC is upper(trim(p_code))
  // exact match, so a scanner that drops the hyphen still hits after normalize.
  const normalized = normalizeVerificationCode(code);
  if (!isVerificationCodeFormat(normalized)) return null;
  const { data, error } = await supabaseProgress.rpc('verify_photo_by_code', { p_code: normalized });
  if (error) throw new Error(error.message || 'Could not reach the verification service');
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

let barcodeDetectorPromise = null;
function getBarcodeDetector() {
  if (typeof BarcodeDetector !== 'function') return null;
  if (!barcodeDetectorPromise) {
    try {
      barcodeDetectorPromise = new BarcodeDetector({ formats: ['code_128', 'qr_code'] });
    } catch {
      barcodeDetectorPromise = null;
    }
  }
  return barcodeDetectorPromise;
}

function unwrapModule(mod, key) {
  if (mod && mod[key]) return mod;
  return mod?.default && mod.default[key] ? mod.default : mod;
}

let zxingPromise = null;
function loadZxing() {
  if (!zxingPromise) {
    // Static import so the scanner ships inside the PhotoVerification chunk.
    // Dynamic import('@zxing/library') 404s in the APK when that hashed extra
    // file was not copied into android assets.
    zxingPromise = Promise.resolve()
      .then(() => {
        const ns = unwrapModule(ZXingNs, 'RGBLuminanceSource');
        if (!ns?.RGBLuminanceSource) throw new VerificationEngineError();
        return ns;
      })
      .catch((err) => {
        zxingPromise = null;
        throw err instanceof VerificationEngineError ? err : new VerificationEngineError();
      });
  }
  return zxingPromise;
}

let jsqrPromise = null;
function loadJsQR() {
  if (!jsqrPromise) {
    jsqrPromise = Promise.resolve()
      .then(() => {
        const fn = jsQRModule?.default || jsQRModule;
        if (typeof fn !== 'function') throw new VerificationEngineError();
        return fn;
      })
      .catch((err) => {
        jsqrPromise = null;
        throw err instanceof VerificationEngineError ? err : new VerificationEngineError();
      });
  }
  return jsqrPromise;
}

/** Clears cached scanner imports so a Retry can pick up a recovered Vite dep cache. */
export function resetVerificationEngine() {
  zxingPromise = null;
  jsqrPromise = null;
  barcodeDetectorPromise = null;
}

/**
 * Long-edge cap for barcode/QR search canvases. SHA-256 still hashes original file bytes.
 * 1600 matches a typical WhatsApp "save from chat" long edge — don't downscale
 * that file again before the 1D scan.
 */
export const SCAN_MAX_EDGE_NATIVE = 1600;
export const SCAN_MAX_EDGE_DESKTOP = 1600;
const CROP_CANVAS_MAX = 1600;
export const VERIFY_PHOTO_TIMEOUT_MS = 18000;

export function scanMaxEdge() {
  return Capacitor.isNativePlatform() ? SCAN_MAX_EDGE_NATIVE : SCAN_MAX_EDGE_DESKTOP;
}

export function verifyConcurrency() {
  return Capacitor.isNativePlatform() ? 1 : 2;
}

export function yieldToUi() {
  return new Promise((resolve) => {
    const later = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(later);
    } else {
      later();
    }
  });
}

function abortError(message = 'This photo took too long to check.') {
  const err = new Error(message);
  err.status = 'timeout';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    /* ignore */
  }
}

function drawToCanvas(img, sx, sy, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, dw);
  canvas.height = Math.max(1, dh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  // Never smooth barcode pixels — bilinear shrink/blur is what makes Code 128 unreadable.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function imageDataOf(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function toLuminance(imageData) {
  const { data, width, height } = imageData;
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    lum[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return lum;
}

async function decodeWithBarcodeDetector(canvas) {
  const detector = getBarcodeDetector();
  if (!detector) return null;
  try {
    const detect = detector.detect(canvas);
    detect.catch(() => {});
    const codes = await Promise.race([
      detect,
      new Promise((resolve) => setTimeout(() => resolve([]), 500)),
    ]);
    for (const code of codes || []) {
      const extracted = extractVerificationCode(code.rawValue);
      if (extracted) return extracted;
    }
  } catch {
    /* WebView may advertise the API then fail */
  }
  return null;
}

function resultText(result) {
  return extractVerificationCode(result?.getText?.() || result?.text);
}

async function decodeWithZxing1d(imageData, tryHarder) {
  const zxing = await loadZxing();
  try {
    const {
      RGBLuminanceSource,
      BinaryBitmap,
      HybridBinarizer,
      GlobalHistogramBinarizer,
      Code128Reader,
      DecodeHintType,
      BarcodeFormat,
    } = zxing;
    const lum = toLuminance(imageData);
    const source = new RGBLuminanceSource(lum, imageData.width, imageData.height);
    const hints1d = new Map();
    hints1d.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
    if (tryHarder) hints1d.set(DecodeHintType.TRY_HARDER, true);
    const code128 = new Code128Reader();
    const try1d = (binarizer) => {
      try {
        return resultText(code128.decode(new BinaryBitmap(binarizer), hints1d));
      } catch {
        return null;
      }
    };
    return (
      try1d(new GlobalHistogramBinarizer(source)) ||
      try1d(new HybridBinarizer(source)) ||
      (tryHarder ? try1d(new GlobalHistogramBinarizer(source.invert())) : null)
    );
  } catch {
    return null;
  }
}

async function decodeWithZxingQr(imageData, tryHarder) {
  const zxing = await loadZxing();
  try {
    const {
      RGBLuminanceSource,
      BinaryBitmap,
      HybridBinarizer,
      GlobalHistogramBinarizer,
      MultiFormatReader,
      DecodeHintType,
      BarcodeFormat,
    } = zxing;
    const lum = toLuminance(imageData);
    const source = new RGBLuminanceSource(lum, imageData.width, imageData.height);
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
    if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new MultiFormatReader();
    reader.setHints(hints);
    const tryDecode = (binarizer) => {
      try {
        const result = reader.decode(new BinaryBitmap(binarizer));
        reader.reset();
        return resultText(result);
      } catch {
        reader.reset();
        return null;
      }
    };
    return tryDecode(new HybridBinarizer(source)) || tryDecode(new GlobalHistogramBinarizer(source));
  } catch {
    return null;
  }
}

async function decodeWithJsQR(imageData, inversionAttempts = 'dontInvert') {
  const jsQR = await loadJsQR();
  try {
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts });
    return extractVerificationCode(result?.data);
  } catch {
    return null;
  }
}

const OCR_CHARS = `${VERIFICATION_ALPHABET}-`;
const glyphTemplateCache = new Map();

function getGlyphTemplates(h) {
  const key = Math.max(8, Math.min(28, Math.round(h)));
  if (glyphTemplateCache.has(key)) return glyphTemplateCache.get(key);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const w = Math.max(6, Math.round(key * 0.72));
  canvas.width = w;
  canvas.height = key;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  const map = new Map();
  for (let c = 0; c < OCR_CHARS.length; c += 1) {
    const ch = OCR_CHARS[c];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, key);
    ctx.fillStyle = '#000000';
    ctx.font = `700 ${Math.max(8, key - 2)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, key / 2);
    const { data } = ctx.getImageData(0, 0, w, key);
    const bin = new Uint8Array(w * key);
    for (let i = 0; i < bin.length; i += 1) bin[i] = data[i * 4] < 140 ? 1 : 0;
    map.set(ch, bin);
  }
  const pack = { w, h: key, map };
  glyphTemplateCache.set(key, pack);
  return pack;
}

function matchGlyph(patch, pw, ph, templates) {
  let best = null;
  let bestScore = 0.64;
  const tmp = new Uint8Array(templates.w * templates.h);
  for (let y = 0; y < templates.h; y += 1) {
    const sy = Math.min(ph - 1, Math.floor((y * ph) / templates.h));
    for (let x = 0; x < templates.w; x += 1) {
      const sx = Math.min(pw - 1, Math.floor((x * pw) / templates.w));
      tmp[y * templates.w + x] = patch[sy * pw + sx];
    }
  }
  const n = tmp.length;
  templates.map.forEach((tmpl, ch) => {
    let same = 0;
    for (let i = 0; i < n; i += 1) if (tmp[i] === tmpl[i]) same += 1;
    const score = same / n;
    if (score > bestScore) {
      bestScore = score;
      best = ch;
    }
  });
  return best;
}

/** Best-effort read of the printed XXXX-XXXX under the bars (tie-break only). */
function readPrintedVerificationCode(imageData) {
  const { data, width, height } = imageData;
  if (width < 90 || height < 12) return null;
  const y0 = Math.floor(height * 0.48);
  const bandH = height - y0;
  if (bandH < 8) return null;
  const luma = new Uint8ClampedArray(width * bandH);
  let min = 255;
  let max = 0;
  for (let y = 0; y < bandH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = ((y0 + y) * width + x) * 4;
      const v = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      luma[y * width + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 24) return null;
  const thresh = min + Math.round((max - min) * 0.45);
  let bestY = 0;
  let bestOcc = 0;
  for (let y = 0; y < bandH; y += 1) {
    let occ = 0;
    for (let x = 0; x < width; x += 1) if (luma[y * width + x] < thresh) occ += 1;
    if (occ > bestOcc) {
      bestOcc = occ;
      bestY = y;
    }
  }
  const pad = Math.max(2, Math.round(bandH * 0.2));
  const gy0 = Math.max(0, bestY - pad);
  const gy1 = Math.min(bandH, bestY + pad + 1);
  const gh = gy1 - gy0;
  const colDark = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) {
    let d = 0;
    for (let y = gy0; y < gy1; y += 1) if (luma[y * width + x] < thresh) d += 1;
    colDark[x] = d;
  }
  const inkFloor = Math.max(1, Math.round(gh * 0.18));
  const boxes = [];
  let x = 0;
  while (x < width) {
    while (x < width && colDark[x] < inkFloor) x += 1;
    if (x >= width) break;
    const x0 = x;
    while (x < width && colDark[x] >= inkFloor) x += 1;
    if (x - x0 >= 2) boxes.push([x0, x]);
  }
  if (boxes.length !== 8 && boxes.length !== 9) return null;
  const templates = getGlyphTemplates(gh);
  if (!templates) return null;
  let text = '';
  for (let b = 0; b < boxes.length; b += 1) {
    const x0 = boxes[b][0];
    const x1 = boxes[b][1];
    const pw = x1 - x0;
    const patch = new Uint8Array(pw * gh);
    for (let y = 0; y < gh; y += 1) {
      for (let xx = 0; xx < pw; xx += 1) {
        patch[y * pw + xx] = luma[(gy0 + y) * width + (x0 + xx)] < thresh ? 1 : 0;
      }
    }
    const ch = matchGlyph(patch, pw, gh, templates);
    if (!ch) return null;
    text += ch;
  }
  if (boxes.length === 8) text = `${text.slice(0, 4)}-${text.slice(4)}`;
  return extractVerificationCode(text);
}

function pushEntry(entries, code, source) {
  const extracted = extractVerificationCode(code);
  if (!extracted) return;
  entries.push({ code: extracted, source });
}

/**
 * Run custom 1D (checksum+stop), native detector, and ZXing on the same crop.
 * Never return the first XXXX-XXXX — callers vote / require agreement.
 */
async function decodeCanvas(canvas, options = {}) {
  const { signal, tryHarder = true, allowQr = true, allowZxingQr = allowQr, qrInvert = false } = options;
  throwIfAborted(signal);

  let imageData;
  try {
    imageData = imageDataOf(canvas);
  } catch {
    const err = new Error('Could not read pixels from this photo.');
    err.status = 'decode-failed';
    throw err;
  }

  const entries = [];
  const custom = decodeCode128BCandidatesFromLuma(
    toLuminance(imageData),
    imageData.width,
    imageData.height
  );
  for (let i = 0; i < custom.length; i += 1) pushEntry(entries, custom[i], 'custom');
  await yieldToUi();
  throwIfAborted(signal);

  pushEntry(entries, await decodeWithBarcodeDetector(canvas), 'native');
  await yieldToUi();
  throwIfAborted(signal);

  let zxingError = null;
  try {
    pushEntry(entries, await decodeWithZxing1d(imageData, tryHarder), 'zxing');
  } catch (e) {
    if (e instanceof VerificationEngineError) zxingError = e;
    else throw e;
  }
  await yieldToUi();
  throwIfAborted(signal);

  if (allowQr && entries.length === 0) {
    try {
      pushEntry(entries, await decodeWithJsQR(imageData, qrInvert ? 'attemptBoth' : 'dontInvert'), 'qr');
    } catch (e) {
      if (!(e instanceof VerificationEngineError)) throw e;
    }
    await yieldToUi();
    throwIfAborted(signal);
    if (allowZxingQr) {
      try {
        pushEntry(entries, await decodeWithZxingQr(imageData, tryHarder), 'zxing');
      } catch (e) {
        if (e instanceof VerificationEngineError) zxingError = zxingError || e;
        else throw e;
      }
    }
  }

  if (zxingError && entries.length === 0) throw zxingError;
  return { entries, imageData, zxingError };
}

function enginesAgree(entries) {
  const byCode = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const rec = byCode.get(e.code) || new Set();
    rec.add(e.source);
    byCode.set(e.code, rec);
  }
  for (const [code, sources] of byCode) {
    if (sources.size >= 2) return code;
  }
  return null;
}

/**
 * Pick a code only when engines agree, OCR ties the printed text, or a
 * checksummed ZXing/native decode stands alone. A custom-only ghost from an
 * upscaled 13px plate must not become NOT ON FILE.
 */
export function resolveScanEntries(entries, ocrCode) {
  const byCode = new Map();
  for (let i = 0; i < (entries || []).length; i += 1) {
    const e = entries[i];
    if (!e?.code) continue;
    let rec = byCode.get(e.code);
    if (!rec) {
      rec = { code: e.code, sources: new Set(), count: 0, nativeScale: false };
      byCode.set(e.code, rec);
    }
    rec.sources.add(e.source);
    rec.count += 1;
    if (!e.upscaled) rec.nativeScale = true;
  }
  const list = [...byCode.values()].sort((a, b) => {
    if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
    return b.count - a.count;
  });
  const codes = list.map((r) => r.code);

  if (ocrCode) {
    const hit = list.find((r) => r.code === ocrCode);
    if (hit) return { code: ocrCode, confidence: 'high', codes, conflict: list.length > 1 };
  }

  if (!list.length) {
    return { code: null, confidence: ocrCode ? 'low' : 'none', codes, conflict: false };
  }

  // Two different XXXX-XXXX values and no printed-text tie-break: do not guess.
  if (list.length > 1) {
    const agreed = list.find((r) => r.sources.size >= 2);
    if (agreed) return { code: agreed.code, confidence: 'high', codes, conflict: true };
    return { code: null, confidence: 'low', codes, conflict: true };
  }

  const best = list[0];
  if (best.sources.size >= 2) return { code: best.code, confidence: 'high', codes, conflict: false };
  if (best.sources.has('zxing') || best.sources.has('native') || best.sources.has('qr')) {
    return { code: best.code, confidence: 'high', codes, conflict: false };
  }
  if (best.nativeScale && best.count >= 2) {
    return { code: best.code, confidence: 'high', codes, conflict: false };
  }
  return { code: null, confidence: 'low', codes, conflict: best.sources.has('custom') };
}

function scanRegions(width, height) {
  const topH = Math.min(height, Math.max(64, Math.round(height * 0.22)));
  const midH = Math.min(height, Math.max(72, Math.round(height * 0.16)));
  const insetY = Math.min(height - 24, Math.max(0, Math.round(height * 0.04)));
  const w50 = Math.min(width, Math.max(520, Math.round(width * 0.5)));
  const w34 = Math.min(width, Math.max(280, Math.round(width * 0.34)));
  const regions = [
    { sx: width - w50, sy: insetY, sw: w50, sh: midH, upscale: false },
    { sx: width - w34, sy: 0, sw: w34, sh: midH, upscale: false },
    { sx: 0, sy: 0, sw: width, sh: topH, upscale: false },
    { sx: 0, sy: insetY, sw: width, sh: Math.min(height - insetY, topH), upscale: false },
    { sx: 0, sy: 0, sw: w34, sh: midH, upscale: false },
    { sx: width - w34, sy: height - midH, sw: w34, sh: midH, upscale: false },
    { sx: 0, sy: height - midH, sw: w34, sh: midH, upscale: false },
  ];
  const seen = new Set();
  return regions.filter((r) => {
    if (r.sw < 40 || r.sh < 20) return false;
    const key = `${r.sx},${r.sy},${r.sw},${r.sh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cropScales(crop) {
  // Integer-pixel 1D at native size first (WhatsApp ~1600px). Integer 2× only
  // when the plate is already tall enough that bars are real pixels.
  // Never 3× a ~13px JPEG tab — nearest-neighbor invents modules.
  const scales = [1];
  if (crop.allow2x !== false && crop.sh >= 24 && crop.sh < 72) scales.push(2);
  return scales;
}

function drawCropAtScale(img, crop, scale) {
  let s = scale;
  const long = Math.max(crop.sw, crop.sh) * s;
  if (long > CROP_CANVAS_MAX) s = CROP_CANVAS_MAX / Math.max(crop.sw, crop.sh);
  return drawToCanvas(
    img,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    Math.max(1, Math.round(crop.sw * s)),
    Math.max(1, Math.round(crop.sh * s))
  );
}

/** Bounding box of the white Code 128 tab (top-right). JPEG whites are often ~200, not 255. */
function findTopRightWhitePlate(img, width, height) {
  const sy = 0;
  const sh = Math.min(height, Math.max(80, Math.round(height * 0.3)));
  const sx = Math.floor(width * 0.35);
  const sw = width - sx;
  const maxW = 900;
  const scale = Math.min(1, maxW / Math.max(1, sw));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = drawToCanvas(img, sx, sy, sw, sh, dw, dh);
  let data;
  try {
    data = imageDataOf(canvas).data;
  } catch {
    releaseCanvas(canvas);
    return null;
  }
  let minX = dw;
  let minY = dh;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let row = 0; row < dh; row += 1) {
    for (let col = 0; col < dw; col += 1) {
      const i = (row * dw + col) * 4;
      const lum = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      if (lum > 200) {
        n += 1;
        if (col < minX) minX = col;
        if (row < minY) minY = row;
        if (col > maxX) maxX = col;
        if (row > maxY) maxY = row;
      }
    }
  }
  releaseCanvas(canvas);
  if (n < 80 || maxX - minX < 40 || maxY - minY < 6) return null;
  const inv = scale > 0 ? 1 / scale : 1;
  const padX = 12;
  const padY = 8;
  const px = Math.max(0, sx + minX * inv - padX);
  const py = Math.max(0, sy + minY * inv - padY);
  let plateW = Math.min(width - px, (maxX - minX + 1) * inv + padX * 2);
  let plateH = Math.min(height - py, (maxY - minY + 1) * inv + padY * 2);
  const minH = Math.min(Math.round(height * 0.12), Math.max(24, Math.round(height * 0.045)));
  if (plateH < minH) plateH = Math.min(height - py, minH);
  return { sx: px, sy: py, sw: plateW, sh: plateH };
}

function plateCrops(plate, width, height) {
  const barH = Math.max(8, plate.sh * 0.62);
  const crops = [
    { sx: plate.sx, sy: plate.sy, sw: plate.sw, sh: barH, allow2x: plate.sh >= 24 },
    { ...plate, allow2x: plate.sh >= 24 },
  ];
  const paddedH = Math.min(height, Math.max(plate.sh, Math.round(height * 0.08)));
  if (paddedH > plate.sh + 2) {
    crops.push({ sx: plate.sx, sy: 0, sw: plate.sw, sh: paddedH, allow2x: paddedH >= 24 });
  }
  crops.push({
    sx: plate.sx,
    sy: plate.sy + plate.sh * 0.45,
    sw: plate.sw,
    sh: Math.max(10, plate.sh * 0.55),
    allow2x: false,
    ocr: true,
  });
  return crops;
}

async function scanCropList(img, crops, options) {
  const { signal, entries, allowQr } = options;
  let ocrCode = null;
  let engineError = null;
  for (let i = 0; i < crops.length; i += 1) {
    throwIfAborted(signal);
    const crop = crops[i];
    const scales = cropScales(crop);
    for (let s = 0; s < scales.length; s += 1) {
      const canvas = drawCropAtScale(img, crop, scales[s]);
      try {
        const decoded = await decodeCanvas(canvas, {
          signal,
          tryHarder: true,
          allowQr: allowQr && entries.length === 0,
          allowZxingQr: false,
          qrInvert: false,
        });
        for (let k = 0; k < decoded.entries.length; k += 1) {
          entries.push({ ...decoded.entries[k], upscaled: scales[s] > 1 });
        }
        if (crop.ocr && !ocrCode && decoded.imageData) {
          ocrCode = readPrintedVerificationCode(decoded.imageData);
        }
        if (engineError && decoded.entries.length) engineError = null;
      } catch (e) {
        if (e instanceof VerificationEngineError) engineError = e;
        else throw e;
      } finally {
        releaseCanvas(canvas);
      }
      if (enginesAgree(entries)) return { ocrCode, engineError, agreed: true };
      await yieldToUi();
    }
  }
  return { ocrCode, engineError, agreed: false };
}

/**
 * Finds the burned-in verification code. New photos use a Code 128 barcode;
 * older photos used a QR mark — both are tried.
 */
export async function scanVerification(img, options = {}) {
  const { signal } = options;
  const { width, height } = sourceDimensions(img);
  if (!width || !height) return { code: null, confidence: 'none', codes: [] };
  throwIfAborted(signal);

  const entries = [];
  const plate = findTopRightWhitePlate(img, width, height);
  const crops = plate ? [...plateCrops(plate, width, height), ...scanRegions(width, height)] : scanRegions(width, height);
  let { ocrCode, engineError } = await scanCropList(img, crops, { signal, entries, allowQr: true });

  if (!enginesAgree(entries) && !ocrCode) {
    throwIfAborted(signal);
    const maxDim = scanMaxEdge();
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const canvas = drawToCanvas(
      img,
      0,
      0,
      width,
      height,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale))
    );
    try {
      const decoded = await decodeCanvas(canvas, {
        signal,
        tryHarder: true,
        allowQr: true,
        allowZxingQr: true,
        qrInvert: true,
      });
      for (let k = 0; k < decoded.entries.length; k += 1) {
        entries.push({ ...decoded.entries[k], upscaled: false });
      }
    } catch (e) {
      if (e instanceof VerificationEngineError) engineError = engineError || e;
      else throw e;
    } finally {
      releaseCanvas(canvas);
    }
  }

  const resolved = resolveScanEntries(entries, ocrCode);
  if (!resolved.code && resolved.confidence === 'none' && engineError) throw engineError;
  return resolved;
}

export async function scanForVerificationCode(img, options = {}) {
  const result = await scanVerification(img, options);
  return result.code || null;
}

export async function scanForVerificationCodes(img, options = {}) {
  const result = await scanVerification(img, options);
  if (result.codes?.length) return result.codes;
  return result.code ? [result.code] : [];
}

// Fraction of the perceptual hash's bits allowed to differ before this counts
// as "content differs" rather than "just recompressed". Empirically, a
// realistic detailed photo put through aggressive real-world recompression
// (WhatsApp-style: resized + heavily requantized, sometimes more than once)
// can land 2-3.5% away from its own original. Set well above that ceiling so
// this stays reliable for ordinary re-saving — it only reliably flags larger
// alterations. The exact sha256 check is the one hard guarantee.
export const CONTENT_MATCH_RATIO = 0.06;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function classifyVerification({ code, record, hashes }) {
  if (!code) return { status: 'no-code-detected' };
  if (!record) return { status: 'not-found', detectedCode: code };
  if (!hashes) return { status: 'code-only', detectedCode: code, record };
  const { sha256, phash } = hashes;
  if (record.sha256_hash && sha256 === record.sha256_hash) {
    return { status: 'exact-match', detectedCode: code, record };
  }
  if (!record.phash || !phash) {
    return {
      status: 'content-unknown',
      detectedCode: code,
      record,
      phashMissing: !record.phash,
    };
  }
  const distance = hammingDistanceHex(phash, record.phash);
  const totalBits = record.phash.length * 4;
  const ratio = distance / totalBits;
  if (ratio <= CONTENT_MATCH_RATIO) {
    return { status: 'content-match', detectedCode: code, record, distance, ratio };
  }
  return { status: 'content-mismatch', detectedCode: code, record, distance, ratio };
}

function decodeErrorMessage(blob) {
  const name = String(blob?.name || '').toLowerCase();
  const type = String(blob?.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif') || /\.hei[cf]$/.test(name)) {
    return 'This photo is HEIC, which this device cannot decode. Save it as JPEG from Gallery, or capture with this app.';
  }
  return 'This file could not be decoded as an image.';
}

function statusFromThrown(e) {
  if (e instanceof VerificationEngineError || e.status === 'scanner-unavailable') {
    return { status: 'scanner-unavailable', error: e.message || ENGINE_FAIL_MSG };
  }
  if (e.status === 'decode-failed') {
    return { status: 'decode-failed', error: e.message || 'This file could not be decoded as an image.' };
  }
  if (e.status === 'timeout') {
    return { status: 'error', error: e.message || 'This photo took too long to check. Retry it on its own.' };
  }
  return null;
}

async function verifyImageBlobInner(blob, signal) {
  throwIfAborted(signal);
  let img;
  try {
    img = await loadImageFromFile(blob, { maxDimension: scanMaxEdge(), resizeQuality: 'medium' });
  } catch {
    return { status: 'decode-failed', error: decodeErrorMessage(blob) };
  }
  try {
    throwIfAborted(signal);
    const { width, height } = sourceDimensions(img);
    if (!width || !height) {
      return { status: 'decode-failed', error: 'This photo has no readable dimensions.' };
    }
    if (width < 80 || height < 80) {
      return {
        status: 'decode-failed',
        error: 'This image is too small to read a verification mark. Use the original photo, not a thumbnail.',
      };
    }
    const scan = await scanVerification(img, { signal });
    if (scan.confidence === 'low') return { status: 'unclear-code' };
    if (!scan.code) return { status: 'no-code-detected' };
    throwIfAborted(signal);
    await yieldToUi();
    // Hash the original file bytes — never a downscaled scan canvas.
    const sha256 = await sha256Hex(blob);
    throwIfAborted(signal);
    const phash = dHashFromImage(img);
    const hashes = { sha256, phash };
    let record = await lookupVerificationCode(scan.code);
    if (!record && scan.codes?.length) {
      for (let i = 0; i < Math.min(3, scan.codes.length); i += 1) {
        if (scan.codes[i] === scan.code) continue;
        throwIfAborted(signal);
        const row = await lookupVerificationCode(scan.codes[i]);
        if (row) {
          return classifyVerification({ code: scan.codes[i], record: row, hashes });
        }
      }
    }
    if (!record && scan.conflict) return { status: 'unclear-code' };
    return classifyVerification({ code: scan.code, record, hashes });
  } catch (e) {
    const mapped = statusFromThrown(e);
    if (mapped) return mapped;
    throw e;
  } finally {
    img.close?.();
  }
}

/** Scan a photo blob, look the code up, and compare fingerprints. */
export async function verifyImageBlob(blob, options = {}) {
  const timeoutMs = options.timeoutMs === 0
    ? 0
    : Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : VERIFY_PHOTO_TIMEOUT_MS;
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  if (options.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const work = verifyImageBlobInner(blob, ctrl.signal);
  work.catch(() => {});

  let timer = null;
  try {
    if (timeoutMs <= 0) return await work;
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(abortError());
        }, timeoutMs);
      }),
    ]);
  } catch (e) {
    const mapped = statusFromThrown(e) || (ctrl.signal.aborted
      ? { status: 'error', error: 'This photo took too long to check. Retry it on its own.' }
      : null);
    if (mapped) return mapped;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function fetchImageBlob(url) {
  if (!url) throw new Error('Photo URL missing');
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not download photo (${res.status})`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('Downloaded photo was empty');
  return blob;
}

/** Run `worker` over items with at most `limit` in flight at once. */
export async function runPool(items, limit, worker) {
  if (!items.length) return;
  let next = 0;
  const native = Capacitor.isNativePlatform();
  const requested = Math.max(1, Math.min(limit, items.length));
  const n = native ? 1 : Math.min(2, requested);
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
        await yieldToUi();
        if (native && (index + 1) % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
    })
  );
}
