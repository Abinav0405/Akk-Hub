/**
 * Compact Code 128B encoder (no runtime dependency).
 * Patterns are 11 modules each; stop is 13. Used to burn a discreet barcode
 * of the per-photo verification code into captured JPEGs.
 *
 * The 1D scanner requires a valid checksum AND the 13-module stop. A checksum
 * alone is only 1/103 — WhatsApp JPEG ringing otherwise yields a plausible
 * XXXX-XXXX that is not on file.
 */

import { isIssuedVerificationPayload } from './verificationCode.js';

const PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000',
  '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100',
  '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110',
  '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000',
  '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100',
  '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010',
  '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110',
  '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110',
  '11010000100', // 103 Start A
  '11010010000', // 104 Start B
  '11010011100', // 105 Start C
  '1100011101011', // 106 Stop (13 modules)
];

const START_B = 104;
const STOP = 106;

const VALUE_BY_PATTERN = new Map();
for (let i = 0; i <= 105; i += 1) VALUE_BY_PATTERN.set(PATTERNS[i], i);

const START_B_RUNS = [2, 1, 1, 2, 1, 4];

function code128BValue(ch) {
  const c = ch.charCodeAt(0);
  if (c < 32 || c > 126) {
    throw new Error('Code 128B cannot encode this character');
  }
  return c - 32;
}

/** Returns a '1'/'0' bit string of the barcode modules (no quiet zone). */
export function encodeCode128B(text) {
  const payload = String(text || '');
  if (!payload) throw new Error('Nothing to encode');
  const values = [START_B];
  for (let i = 0; i < payload.length; i += 1) {
    values.push(code128BValue(payload[i]));
  }
  let sum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    sum += values[i] * i;
  }
  values.push(sum % 103);
  values.push(STOP);

  let bits = '';
  for (let i = 0; i < values.length; i += 1) {
    const pattern = PATTERNS[values[i]];
    if (!pattern) throw new Error('Invalid Code 128 value');
    bits += pattern;
  }
  return bits;
}

function readCode128BPayload(moduleBits, pos) {
  const values = [];
  const stop = PATTERNS[STOP];
  let sawStop = false;
  while (pos + 11 <= moduleBits.length) {
    if (pos + stop.length <= moduleBits.length && moduleBits.startsWith(stop, pos)) {
      sawStop = true;
      break;
    }
    const sym = moduleBits.slice(pos, pos + 11);
    const val = VALUE_BY_PATTERN.get(sym);
    if (val === undefined || val > 102) return null;
    values.push(val);
    pos += 11;
  }
  if (!sawStop || values.length < 2) return null;
  const checksum = values[values.length - 1];
  const data = values.slice(0, -1);
  let sum = START_B;
  for (let i = 0; i < data.length; i += 1) sum += data[i] * (i + 1);
  if (sum % 103 !== checksum) return null;
  let text = '';
  for (let i = 0; i < data.length; i += 1) text += String.fromCharCode(32 + data[i]);
  return text;
}

/** Decode a '1'/'0' module string produced by encodeCode128B (or a scanner). */
export function decodeCode128BFromModules(moduleBits) {
  const bits = String(moduleBits || '');
  const startPat = PATTERNS[START_B];
  let from = 0;
  while (from < bits.length) {
    const startAt = bits.indexOf(startPat, from);
    if (startAt < 0) return null;
    const text = readCode128BPayload(bits, startAt + startPat.length);
    if (text) return text;
    from = startAt + 1;
  }
  return null;
}

function collectRuns(row, thresh, invert) {
  const runs = [];
  let bit = ((row[0] < thresh) !== invert) ? 1 : 0;
  let len = 1;
  for (let i = 1; i < row.length; i += 1) {
    const next = ((row[i] < thresh) !== invert) ? 1 : 0;
    if (next === bit) {
      len += 1;
    } else {
      runs.push({ bit, n: len });
      bit = next;
      len = 1;
    }
  }
  runs.push({ bit, n: len });
  return runs;
}

function runsToModuleBits(runs, unit) {
  let bits = '';
  for (let i = 0; i < runs.length; i += 1) {
    const n = Math.max(1, Math.round(runs[i].n / unit));
    const ch = runs[i].bit ? '1' : '0';
    bits += ch.repeat(n);
  }
  return bits;
}

function sampleAt(row, x) {
  const x0 = Math.max(0, Math.min(row.length - 2, Math.floor(x)));
  const frac = x - x0;
  return row[x0] + (row[x0 + 1] - row[x0]) * frac;
}

function sampleModuleBits(row, thresh, invert, startX, unit) {
  const count = Math.floor((row.length - startX) / unit);
  if (count < 50) return '';
  let bits = '';
  for (let m = 0; m < count; m += 1) {
    const dark = (sampleAt(row, startX + (m + 0.5) * unit) < thresh) !== invert;
    bits += dark ? '1' : '0';
  }
  return bits;
}

function considerPayload(votes, text) {
  if (!text) return;
  const issued = isIssuedVerificationPayload(text) ? text.trim().toUpperCase() : null;
  if (!issued) return;
  votes.set(issued, (votes.get(issued) || 0) + 1);
}

function decodeBinaryRow(row, thresh, invert, votes) {
  const runs = collectRuns(row, thresh, invert);
  if (runs.length < 18) return;

  for (let i = 0; i < runs.length - 15; i += 1) {
    if (runs[i].bit !== 1) continue;
    let startX = 0;
    for (let r = 0; r < i; r += 1) startX += runs[r].n;
    const six = runs.slice(i, i + 6);
    if (six.length < 6) continue;
    let patternOk = true;
    for (let k = 0; k < 6; k += 1) {
      if (six[k].bit !== (k % 2 === 0 ? 1 : 0)) {
        patternOk = false;
        break;
      }
    }
    if (!patternOk) continue;
    const total = six[0].n + six[1].n + six[2].n + six[3].n + six[4].n + six[5].n;
    const unit = total / 11;
    if (unit < 0.92 || unit > 12) continue;
    let match = true;
    for (let k = 0; k < 6; k += 1) {
      if (Math.abs(six[k].n / unit - START_B_RUNS[k]) > 0.9) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    // Try every scale; the first checksum-valid unit can be a JPEG ghost.
    const units = [unit, unit * 0.94, unit * 1.06, unit * 0.88, unit * 1.12];
    for (let u = 0; u < units.length; u += 1) {
      considerPayload(votes, decodeCode128BFromModules(runsToModuleBits(runs.slice(i), units[u])));
      considerPayload(votes, decodeCode128BFromModules(sampleModuleBits(row, thresh, invert, startX, units[u])));
    }
  }
}

function otsuThreshold(row) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < row.length; i += 1) hist[row[i]] += 1;
  const total = row.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i += 1) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between >= best) {
      best = between;
      t = i;
    }
  }
  return t;
}

function decodeSlice(row, votes) {
  const n = row.length;
  if (n < 60) return;
  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    const v = row[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 28) return;
  const span = max - min;
  const thresholds = [
    otsuThreshold(row),
    (min + max) >> 1,
    min + Math.round(span * 0.38),
    min + Math.round(span * 0.62),
  ];
  const before = votes.size;
  for (let t = 0; t < thresholds.length; t += 1) {
    decodeBinaryRow(row, thresholds[t], false, votes);
  }
  // Our mark is black-on-white. Inverting a JPEG-smeared plate is how a
  // checksum-lucky ghost XXXX-XXXX appears — only try it if nothing decoded.
  if (votes.size === before) {
    for (let t = 0; t < thresholds.length; t += 1) {
      decodeBinaryRow(row, thresholds[t], true, votes);
    }
  }
}

function rankedIssuedCodes(votes, max = 3) {
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([code]) => code);
}

/**
 * 1D Code 128B scan of a single luminance row. Tries the right half first
 * (where we burn the mark) so a busy scene on the left cannot short-circuit
 * onto a checksum-lucky ghost.
 */
export function decodeCode128BFromRow(row) {
  const votes = new Map();
  collectFromRow(row, votes);
  return rankedIssuedCodes(votes, 1)[0] || null;
}

function collectFromRow(row, votes) {
  const n = row.length;
  if (n < 60) return;
  const offsets = [Math.floor(n * 0.5), Math.floor(n * 0.35), 0];
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    if (n - start < 60) continue;
    const slice = row.subarray ? row.subarray(start) : row.slice(start);
    decodeSlice(slice, votes);
  }
}

function collapseRows(luma, width, y0, y1) {
  const h = y1 - y0;
  const row = new Uint8ClampedArray(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = y0; y < y1; y += 1) sum += luma[y * width + x];
    row[x] = Math.round(sum / h);
  }
  return row;
}

function unsharpRow(row, amount) {
  const n = row.length;
  const out = new Uint8ClampedArray(n);
  for (let x = 0; x < n; x += 1) {
    const a = row[x > 0 ? x - 1 : 0];
    const b = row[x];
    const c = row[x + 1 < n ? x + 1 : n - 1];
    out[x] = Math.max(0, Math.min(255, Math.round(b + amount * (b - (a + b + c) / 3))));
  }
  return out;
}

/**
 * Scan a grayscale buffer for our Code 128 verification mark. Collapses a
 * thin horizontal band first (JPEG-robust 1D projection), then single rows.
 * Returns every distinct issued code ranked by vote count (max 3) so a
 * checksum-lucky ghost cannot hide the true mark.
 */
export function decodeCode128BCandidatesFromLuma(luma, width, height) {
  if (!luma || !width || !height) return [];
  const votes = new Map();
  // Plate crops are short: bars occupy the top ~60%, printed text the rest.
  // Collapsing the whole plate mixes glyphs into the 1D projection.
  const topEnd = height <= 96
    ? Math.max(6, Math.round(height * 0.62))
    : Math.min(height, Math.max(40, Math.round(height * 0.28)));
  const band = Math.min(topEnd, Math.max(4, Math.round(Math.min(height * 0.08, 14))));
  const bandStep = Math.max(2, Math.round(band / 2));
  for (let y0 = 0; y0 + 4 <= topEnd; y0 += bandStep) {
    const collapsed = collapseRows(luma, width, y0, Math.min(height, y0 + band));
    collectFromRow(collapsed, votes);
    collectFromRow(unsharpRow(collapsed, 1.8), votes);
  }
  const leadingVotes = votes.size ? Math.max(...votes.values()) : 0;
  if (leadingVotes < 6) {
    const topStep = height > 120 ? 2 : 1;
    for (let y = 0; y < topEnd; y += topStep) {
      collectFromRow(luma.subarray(y * width, y * width + width), votes);
    }
  }
  if (votes.size === 0 && height > 96) {
    const fullStep = Math.max(2, Math.round(height / 90));
    for (let y = topEnd; y < height; y += fullStep) {
      collectFromRow(luma.subarray(y * width, y * width + width), votes);
    }
  }
  return rankedIssuedCodes(votes, 3);
}

export function decodeCode128BFromLuma(luma, width, height) {
  return decodeCode128BCandidatesFromLuma(luma, width, height)[0] || null;
}
