import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Capability-based ownership (R23). A watch is owned by an unguessable token minted at arm and
 * returned to the client once; only its hash is stored. Every read/mutation presents the token.
 */

/** Mint a new capability token (returned to the client exactly once). */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a token for storage — the raw token is never persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time check of a presented token against a stored hash. */
export function verifyToken(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
