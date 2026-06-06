import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality — the single home for this security primitive (callers must not
 * hand-roll it). Both inputs are reduced to fixed-length SHA-256 digests before the compare, so
 * neither the length nor the content of a secret leaks through timing, and `timingSafeEqual` never
 * throws on a length mismatch.
 */
export function safeStringEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
