/** Constant-time string compare (avoids early-exit timing leaks on secrets). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    const x = i < bufA.length ? bufA[i] : 0;
    const y = i < bufB.length ? bufB[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}
