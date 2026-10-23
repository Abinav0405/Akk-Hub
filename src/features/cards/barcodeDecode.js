/**
 * Read the Code 128 barcode on an AKK card from a camera frame (canvas).
 * Uses the browser's BarcodeDetector when it supports code_128 (fast, native on Chrome / Android),
 * else ZXing (already in the app, loaded only when first needed). Only a 16-digit number with a
 * correct check digit is accepted, so a stray barcode on a shirt or box is ignored.
 */
import { luhnOk } from './cardModel';

let nativeOk; // undefined = unknown, boolean after the first check
let zxing; // Promise<{ reader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer }>

async function nativeDetect(canvas) {
    if (nativeOk === false || typeof window.BarcodeDetector !== 'function') {
        nativeOk = false;
        return null;
    }
    try {
        if (nativeOk === undefined) {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            nativeOk = formats.includes('code_128');
            if (!nativeOk) return null;
        }
        const found = await new window.BarcodeDetector({ formats: ['code_128'] }).detect(canvas);
        return found?.[0]?.rawValue ? String(found[0].rawValue).trim() : null;
    } catch {
        nativeOk = false;
        return null;
    }
}

function loadZxing() {
    zxing ||= import('@zxing/library').then((z) => ({
        reader: new z.Code128Reader(),
        RGBLuminanceSource: z.RGBLuminanceSource,
        BinaryBitmap: z.BinaryBitmap,
        HybridBinarizer: z.HybridBinarizer,
        GlobalHistogramBinarizer: z.GlobalHistogramBinarizer,
    }));
    return zxing;
}

async function zxingDetect(canvas) {
    try {
        const { reader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, GlobalHistogramBinarizer } = await loadZxing();
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const { width, height } = canvas;
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const lum = new Uint8ClampedArray(width * height);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) lum[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
        const source = new RGBLuminanceSource(lum, width, height);
        // Hybrid copes with uneven light; the global one reads clean, high-contrast prints better.
        for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
            try {
                const text = reader.decode(new BinaryBitmap(new Binarizer(source)))?.getText?.()?.trim();
                if (text) return text;
            } catch {
                /* NotFoundException on most frames — that is normal */
            }
        }
        return null;
    } catch {
        return null;
    }
}

/** → the 16-digit card number, or null */
export async function decodeCardBarcode(canvas) {
    if (!canvas?.width || !canvas?.height) return null;
    const text = (await nativeDetect(canvas)) || (await zxingDetect(canvas));
    const digits = String(text || '').replace(/\D/g, '');
    return luhnOk(digits) && digits === String(text).trim() ? digits : null;
}
