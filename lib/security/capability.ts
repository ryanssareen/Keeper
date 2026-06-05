import { createHash, randomBytes } from "node:crypto";
import { safeStringEqual } from "@/lib/security/compare";

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
  return safeStringEqual(hashToken(presented), storedHash);
}
