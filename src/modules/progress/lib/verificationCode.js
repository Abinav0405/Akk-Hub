// Excludes 0/O/1/I so a manually typed code is never ambiguous.
export const VERIFICATION_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomBytes(n) {
  const bytes = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** e.g. "7K9M-2XQ4" — the per-photo verification code burned into every capture. */
export function generateVerificationCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) {
    code += VERIFICATION_ALPHABET[bytes[i] % VERIFICATION_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalizes user-typed input (case/spacing) to the stored code format. */
export function normalizeVerificationCode(input) {
  const cleaned = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 8) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/** True when the string is already in stored XXXX-XXXX form (after normalize). */
export function isVerificationCodeFormat(code) {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(String(code || ''));
}

const ISSUED_RE = new RegExp(
  `^[${VERIFICATION_ALPHABET}]{4}-[${VERIFICATION_ALPHABET}]{4}$`
);

/**
 * True when the whole string is exactly a code we would stamp (hyphenated,
 * alphabet without 0/O/1/I). Rejects longer junk that merely contains XXXX-XXXX.
 */
export function isIssuedVerificationPayload(text) {
  return ISSUED_RE.test(String(text || '').trim().toUpperCase());
}

/**
 * Pull a verification code out of scanner output. The decoded payload must
 * *be* the code (optional whitespace), not an XXXX-XXXX window inside junk —
 * JPEG ringing can invent a hyphenated 8-char island inside a longer misread.
 */
export function extractVerificationCode(text) {
  const raw = String(text || '').trim().toUpperCase();
  if (!raw) return null;
  if (isIssuedVerificationPayload(raw)) return raw;
  const direct = normalizeVerificationCode(raw);
  // Scanner payloads must be the whole code (hyphen optional). Do not grab an
  // XXXX-XXXX island out of a longer misread — that is the WhatsApp false-code path.
  if (isIssuedVerificationPayload(direct)) return direct;
  return null;
}
