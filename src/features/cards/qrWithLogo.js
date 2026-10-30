/**
 * Card QR codes with the AKK company logo centred on a white quiet pad.
 * Same asset as the card header (`/Akk-logo.png`).
 *
 * Scannability budget (ECC H ≈ 30% recovery):
 * - White pad ≈ 22% of the side (whole modules, centred) → ~5% of the area hidden.
 * - Finder / timing patterns stay clear. Default quiet zone ≥ 1 module on digital cards.
 */
import QRCode from 'qrcode';

export const CARD_LOGO_URL = '/Akk-logo.png';

/** White centre pad, as a fraction of the QR's modules per side (ECC H recovers ~30%; this covers ~5% of the area). */
export const PAD_RATIO = 0.22;
/** Logo size inside the pad. */
export const LOGO_FILL = 0.8;

let logoPromise = null;

function loadLogo() {
    if (!logoPromise) {
        logoPromise = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = CARD_LOGO_URL;
        });
    }
    return logoPromise;
}

function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

/**
 * Burn a centred logo on a white pad onto a QR canvas. The pad is snapped to whole modules and
 * centred on the module grid (QR sizes are odd, so the pad is too), so no module is half-covered;
 * it stays well clear of the finder / timing patterns.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size      canvas side in px
 * @param {number} modules   modules per side (without margin)
 * @param {number} margin    quiet-zone modules
 */
export function burnLogoOnQr(ctx, size, modules, margin, logo, { padRatio = PAD_RATIO, logoFill = LOGO_FILL } = {}) {
    const scale = size / (modules + margin * 2);
    let pad = Math.ceil(modules * padRatio);
    if (pad % 2 === 0) pad += 1;
    const start = (margin + (modules - pad) / 2) * scale;
    const side = pad * scale;

    ctx.fillStyle = '#ffffff';
    roundRect(ctx, start, start, side, side, side * 0.2);
    ctx.fill();

    const box = side * logoFill;
    const aspect = logo.naturalWidth / logo.naturalHeight;
    const dw = aspect >= 1 ? box : box * aspect;
    const dh = aspect >= 1 ? box / aspect : box;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, start + (side - dw) / 2, start + (side - dh) / 2, dw, dh);
}

/**
 * @param {string} text — QR payload
 * @param {{ margin?: number, width?: number, errorCorrectionLevel?: 'L'|'M'|'Q'|'H' }} [opts]
 * @returns {Promise<string>} PNG data URL
 */
export async function qrDataUrlWithLogo(text, { margin = 1, width = 420, errorCorrectionLevel = 'H' } = {}) {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, text, {
        margin,
        width,
        errorCorrectionLevel,
        color: { dark: '#000000', light: '#ffffff' },
    });

    const logo = await loadLogo();
    if (!logo || !logo.naturalWidth) return canvas.toDataURL('image/png');

    const modules = QRCode.create(text, { errorCorrectionLevel }).modules.size;
    burnLogoOnQr(canvas.getContext('2d'), canvas.width, modules, margin, logo);
    return canvas.toDataURL('image/png');
}
