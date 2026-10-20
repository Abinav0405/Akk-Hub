/** SHA-256 of the exact encoded file bytes — an exact match proves byte-for-byte authenticity. */
export async function sha256Hex(blob) {
  const buf = await readBlobBuffer(blob);
  const digest = await sha256Digest(buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readBlobBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read photo bytes'));
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Digest(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (globalThis.crypto?.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      if (digest && digest.byteLength === 32) return digest;
    } catch {
      /* Android WebView can expose subtle then reject outside a real secure context */
    }
  }
  return sha256Fallback(bytes).buffer;
}

/** Pure-JS SHA-256 — used when Web Crypto is missing (some Capacitor WebViews). */
function sha256Fallback(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const len = bytes.length;
  const bitLenHi = Math.floor(len / 0x20000000);
  const bitLenLo = (len << 3) >>> 0;
  const withPad = (len + 9 + 63) & ~63;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(withPad - 8, bitLenHi);
  view.setUint32(withPad - 4, bitLenLo);
  const w = new Uint32Array(64);
  for (let i = 0; i < withPad; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, H[i]);
  return out;
}

// 33x33 grayscale grid, both directions — a coarser (e.g. 9x8/64-bit) hash
// only notices whole-image changes and misses a localized edit (a graphic
// drawn over part of the photo, a small object added/removed): the edit only
// flips a handful of the total bits, indistinguishable from recompression
// noise. At this resolution an edit covering even a few percent of the frame
// flips proportionally many more bits, well clear of that noise floor.
const GRID = 33;
export const PHASH_BITS = 2 * GRID * (GRID - 1);

function hashFromGray(gray) {
  let bits = '';
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID - 1; col += 1) {
      bits += gray[row * GRID + col] > gray[row * GRID + col + 1] ? '1' : '0';
    }
  }
  for (let col = 0; col < GRID; col += 1) {
    for (let row = 0; row < GRID - 1; row += 1) {
      bits += gray[row * GRID + col] > gray[(row + 1) * GRID + col] ? '1' : '0';
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function grayFromCanvas(canvas) {
  const tmp = document.createElement('canvas');
  tmp.width = GRID;
  tmp.height = GRID;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, GRID, GRID);
  const { data } = ctx.getImageData(0, 0, GRID, GRID);
  const gray = new Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i += 1) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return gray;
}

/**
 * Difference hash (dHash): downscale to a GRIDxGRID grayscale grid, compare
 * each pixel to its right neighbor (horizontal pass) and to the pixel below
 * it (vertical pass). Robust to resizing/recompression (e.g. a messaging app
 * re-saving the photo) while sensitive to real content edits — the "photo
 * analysis" half of verification, alongside the exact sha256 check.
 */
export function dHashFromCanvas(canvas) {
  return hashFromGray(grayFromCanvas(canvas));
}

/**
 * Same dHash, drawn straight from an <img>/ImageBitmap. Avoids allocating a
 * full-resolution canvas — a 12MP decode-to-canvas is a common Android WebView OOM.
 */
export function dHashFromImage(img) {
  const tmp = document.createElement('canvas');
  tmp.width = GRID;
  tmp.height = GRID;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, GRID, GRID);
  const { data } = ctx.getImageData(0, 0, GRID, GRID);
  const gray = new Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i += 1) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return hashFromGray(gray);
}

/**
 * Same dHash from a grayscale buffer (no DOM). Used by the WhatsApp-scan
 * reproduce script and any non-canvas fingerprint path.
 */
export function dHashFromLuma(luma, width, height) {
  if (!luma || !width || !height) return '';
  const gray = new Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy += 1) {
    const y0 = Math.floor((gy * height) / GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID));
    for (let gx = 0; gx < GRID; gx += 1) {
      const x0 = Math.floor((gx * width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * width;
        for (let x = x0; x < x1; x += 1) {
          sum += luma[row + x];
          n += 1;
        }
      }
      gray[gy * GRID + gx] = n ? sum / n : 0;
    }
  }
  return hashFromGray(gray);
}

/** Draws an <img>/ImageBitmap onto an offscreen canvas so dHashFromCanvas can read it. */
export function imageToCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Count of differing bits between two same-length hex hashes. A length
 * mismatch (e.g. a photo hashed under a since-changed algorithm) can't be
 * meaningfully compared — treated as maximally different, not equal.
 */
export function hammingDistanceHex(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) {
    return Math.max(hexA?.length || 0, hexB?.length || 0, 1) * 4;
  }
  let dist = 0;
  for (let i = 0; i < hexA.length; i += 1) {
    let x = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}
