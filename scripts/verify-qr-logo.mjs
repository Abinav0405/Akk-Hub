/**
 * One-off Node check: burn the AKK logo onto a sample card QR (same geometry as
 * qrWithLogo.js) and confirm jsQR can still decode the payload.
 *
 *   node scripts/verify-qr-logo.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const PAD_RATIO = 0.22;
const LOGO_FILL = 0.8;
const ECC = 'H';
const WIDTH = 420;
const MARGIN = 1;

const payload =
    'https://akkengineering.com/id?c=AKK1P.abcdefghijklmnopqrstuvwx';

function fillRect(png, x0, y0, w, h, rgba) {
    const x1 = Math.min(png.width, Math.round(x0 + w));
    const y1 = Math.min(png.height, Math.round(y0 + h));
    const xs = Math.max(0, Math.round(x0));
    const ys = Math.max(0, Math.round(y0));
    for (let y = ys; y < y1; y++) {
        for (let x = xs; x < x1; x++) {
            const i = (png.width * y + x) << 2;
            png.data[i] = rgba[0];
            png.data[i + 1] = rgba[1];
            png.data[i + 2] = rgba[2];
            png.data[i + 3] = rgba[3];
        }
    }
}

/** Nearest-neighbour blit with alpha over opaque white/black QR. */
function blitScaled(dst, src, dx, dy, dw, dh) {
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(src.height - 1, Math.floor((y / dh) * src.height));
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(src.width - 1, Math.floor((x / dw) * src.width));
            const si = (src.width * sy + sx) << 2;
            const a = src.data[si + 3] / 255;
            if (a <= 0) continue;
            const px = Math.round(dx + x);
            const py = Math.round(dy + y);
            if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
            const di = (dst.width * py + px) << 2;
            dst.data[di] = Math.round(src.data[si] * a + dst.data[di] * (1 - a));
            dst.data[di + 1] = Math.round(src.data[si + 1] * a + dst.data[di + 1] * (1 - a));
            dst.data[di + 2] = Math.round(src.data[si + 2] * a + dst.data[di + 2] * (1 - a));
            dst.data[di + 3] = 255;
        }
    }
}

/** Same geometry as src/features/cards/qrWithLogo.js: pad snapped to whole, centred modules. */
function burnLogo(qrPng, logoPng, modules) {
    const size = qrPng.width;
    const scale = size / (modules + MARGIN * 2);
    let pad = Math.ceil(modules * PAD_RATIO);
    if (pad % 2 === 0) pad += 1;
    const start = (MARGIN + (modules - pad) / 2) * scale;
    const side = pad * scale;
    fillRect(qrPng, start, start, side, side, [255, 255, 255, 255]);

    const box = side * LOGO_FILL;
    const aspect = logoPng.width / logoPng.height;
    const dw = aspect >= 1 ? box : box * aspect;
    const dh = aspect >= 1 ? box / aspect : box;
    blitScaled(qrPng, logoPng, start + (side - dw) / 2, start + (side - dh) / 2, Math.round(dw), Math.round(dh));
}

function decode(png) {
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
        inversionAttempts: 'dontInvert',
    });
}

const qrBuf = await QRCode.toBuffer(payload, {
    type: 'png',
    margin: MARGIN,
    width: WIDTH,
    errorCorrectionLevel: ECC,
    color: { dark: '#000000', light: '#ffffff' },
});

const qrPng = PNG.sync.read(qrBuf);
const logoPng = PNG.sync.read(readFileSync(join(root, 'public', 'Akk-logo.png')));

const modules = QRCode.create(payload, { errorCorrectionLevel: ECC }).modules.size;
console.log('settings', {
    padRatio: PAD_RATIO,
    logoFill: LOGO_FILL,
    modules,
    ecc: ECC,
    margin: MARGIN,
    width: WIDTH,
    payloadLen: payload.length,
});

const bare = decode(qrPng);
console.log('bare_decode', bare ? bare.data === payload : false, bare?.data ?? null);

burnLogo(qrPng, logoPng, modules);

const outDir = join(root, 'scripts', 'out');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'sample-qr-with-logo.png');
writeFileSync(outPath, PNG.sync.write(qrPng));

const withLogo = decode(qrPng);
const ok = !!(withLogo && withLogo.data === payload);
console.log('logo_decode', ok, withLogo?.data ?? null);
console.log('sample_png', outPath);
process.exit(ok ? 0 : 1);
