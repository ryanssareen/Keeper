import { safeStringEqual } from "@/lib/security/compare";

/**
 * Constant-time guard for the reconcile cron endpoint (R20). The external scheduler presents
 * `Authorization: Bearer <CRON_SECRET>`; we compare the presented token to the configured secret in
 * constant time so a forged-call attacker learns nothing from response timing.
 */

/**
 * Authorize a cron request. Fail closed: an unset/blank configured secret never authorizes, so a
 * misconfigured deploy can't run the quota-spending reconcile loop unauthenticated. Structural
 * checks (header present, Bearer scheme) may short-circuit — only the secret value itself must be,
 * and is, compared in constant time.
 */
export function isAuthorizedCron(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!authHeader) return false;
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) return false;
  return safeStringEqual(match[1], secret);
}
