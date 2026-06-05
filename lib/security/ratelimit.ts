import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Abuse / cost controls (R24, R25). This module is split into PURE decisions (no IO, fully unit
 * tested) and a thin lazy production path that builds an Upstash limiter from env. The proxy and
 * the arm flow call the decisions; the IO that produces the inputs (a Redis hit count, the DB watch
 * count, the month's upstream spend) lives in thin shells and is injected, so nothing here needs a
 * live Upstash/DB to be tested.
 */

// ── Tunables ───────────────────────────────────────────────────────────────────────────────────
/** Mutating public routes: requests allowed per IP per window before we shed (sliding window). */
export const IP_RATE_LIMIT = 10;
/** Sliding-window length for the IP rate limit. */
export const IP_RATE_WINDOW = "60 s" as const;
/** Max active (non-terminal) watches a single device may hold at once. */
export const WATCH_CAP_PER_DEVICE = 5;

// ── Pure decisions ───────────────────────────────────────────────────────────────────────────────

/**
 * Pure rate-limit decision: is a request ALLOWED given how many hits this key has already taken in
 * the current window? `currentHits` is the count *including* this request (1 = first request). The
 * request is allowed iff that count does not exceed `limit`. Keeping this pure means the 429 path is
 * exercised by tests with zero network, and the production limiter (below) only has to supply a
 * count + boolean.
 */
export function rateLimitDecision(currentHits: number, limit: number): boolean {
  if (limit <= 0) return false; // a non-positive limit blocks everything (fail-closed)
  return currentHits <= limit;
}

/**
 * Pure per-device watch cap: may a device arm ANOTHER watch given how many active (non-terminal)
 * watches it already holds? Allowed iff adding one stays within the cap. The DB count is a separate
 * thin IO (stubbed in tests).
 */
export function withinWatchCap(currentCount: number, cap: number = WATCH_CAP_PER_DEVICE): boolean {
  if (cap <= 0) return false;
  return currentCount < cap;
}

/**
 * Pure budget circuit-breaker (R24): may we accept a NEW arm given the month-to-date upstream spend
 * and the monthly threshold? Sheds new arms once spend has reached/exceeded the threshold, while
 * existing watches keep reconciling (this gate is only consulted on arm, never on reconcile). A
 * non-positive threshold means "no budget configured" → shed, fail-closed.
 */
export function budgetOk(currentSpend: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  return currentSpend < threshold;
}

// ── Lazy production IP rate-limiter (Upstash) ────────────────────────────────────────────────────

/** Outcome of an IP rate-limit check, decoupled from the Upstash response shape. */
export type RateLimitOutcome = {
  /** Whether the request may proceed to the paid route work. */
  allowed: boolean;
  /** Requests permitted per window (for an informational `RateLimit-*` style header if desired). */
  limit: number;
  /** Requests remaining in the current window (>= 0). */
  remaining: number;
};

let cachedLimiter: Ratelimit | null = null;

/** True only when both Upstash REST env vars are present (server-only). */
function hasUpstashEnv(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Lazily build (and cache) the sliding-window limiter from env. Returns null when Upstash is not
 * configured so the caller can apply the documented env-absent posture rather than throwing.
 */
export function getArmRateLimiter(): Ratelimit | null {
  if (cachedLimiter) return cachedLimiter;
  if (!hasUpstashEnv()) return null;
  cachedLimiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(IP_RATE_LIMIT, IP_RATE_WINDOW),
    prefix: "keeper:rl:ip",
    analytics: false,
  });
  return cachedLimiter;
}

/**
 * Production IP rate-limit check for a mutating public route, keyed by client IP.
 *
 * Env-absent posture (documented, deliberate):
 *  - In production, the quota-spending routes MUST NOT run un-limited, so a missing Upstash config
 *    FAILS CLOSED (allowed=false) — better to 429 than to expose an unbounded paid surface.
 *  - In development (`NODE_ENV !== "production"`), there is an explicit BYPASS (allowed=true) so the
 *    app is usable locally without Redis.
 *
 * The actual allow/deny is still derived from the pure `rateLimitDecision` once Upstash returns a
 * count, so the decision logic is uniformly testable.
 */
export async function checkIpRateLimit(ip: string): Promise<RateLimitOutcome> {
  const limiter = getArmRateLimiter();

  // Env-absent OR a transient Upstash failure both apply the same posture: fail-closed in prod (429
  // beats an unbounded paid surface), dev-bypass locally. Without the catch, an Upstash blip would
  // throw unhandled in the proxy and 500 every mutating request.
  const fallback = (): RateLimitOutcome => {
    const devBypass = process.env.NODE_ENV !== "production";
    return { allowed: devBypass, limit: IP_RATE_LIMIT, remaining: devBypass ? IP_RATE_LIMIT : 0 };
  };

  if (!limiter) return fallback();

  try {
    const res = await limiter.limit(ip);
    // `res.limit - res.remaining` is the hit count consumed in this window; route it through the pure
    // decision so prod and tests share one code path.
    const currentHits = res.limit - res.remaining;
    const allowed = res.success && rateLimitDecision(currentHits, res.limit);
    return { allowed, limit: res.limit, remaining: Math.max(0, res.remaining) };
  } catch {
    return fallback();
  }
}
