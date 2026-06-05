import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { securityHeaders } from "@/lib/security/headers";
import { checkIpRateLimit } from "@/lib/security/ratelimit";

/**
 * Edge-of-app abuse controls (R24, R25). In Next 16 this file is the "proxy" (formerly middleware);
 * it runs before any route handler, which lets us enforce cross-cutting concerns WITHOUT touching
 * the route files:
 *   1. Set baseline security headers on every response.
 *   2. Reject cross-origin MUTATIONS (POST/PUT/PATCH/DELETE) with 403 (Origin allowlist).
 *   3. IP-rate-limit the mutating public routes BEFORE they run, returning 429 when tripped — this
 *      preserves validate-before-pay because the limit precedes any paid work in the route.
 * The capability token stays header-sent and is never read here (never a cookie).
 */

/** Mutating HTTP methods that spend resources or change state. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Public mutating routes that must be IP-rate-limited before the route's paid work runs. */
const RATE_LIMITED_PATHS = ["/api/watch", "/api/self-report", "/api/push/subscribe"];

/**
 * Pure Origin allowlist check for a mutating request. A same-origin browser sends `Origin` equal to
 * the request's own origin; we accept that. We also accept an explicitly allow-listed origin
 * (NEXT_PUBLIC_SITE_ORIGIN, if set) to support a known deployed front-end. A request with NO Origin
 * header is allowed: non-browser clients (curl, the capability-token holder, server-to-server) omit
 * it, and CSRF protection here targets browser cross-site form/fetch posts, which always send one.
 * A present-but-foreign Origin is rejected.
 */
export function isOriginAllowed(
  origin: string | null,
  selfOrigin: string,
  allowlist: readonly string[] = [],
): boolean {
  if (!origin) return true; // non-browser / same-origin-without-Origin clients
  if (origin === selfOrigin) return true;
  return allowlist.includes(origin);
}

/**
 * Client IP for rate-limit keying. Prefer the platform-set `x-real-ip` (Vercel sets it to the true
 * client IP): `x-forwarded-for` is client-appendable, so its LEFTMOST entry is forgeable and a
 * spoofed-per-request XFF would land each request in a fresh window and defeat the limit. Fall back
 * to the RIGHTMOST XFF hop (the one added by the closest trusted proxy), then a constant bucket.
 */
function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",");
    return parts[parts.length - 1]!.trim();
  }
  return "unknown";
}

/** Apply the baseline security headers to a response in place, then return it. */
function withSecurityHeaders(res: NextResponse): NextResponse {
  for (const [name, value] of securityHeaders()) res.headers.set(name, value);
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, origin: selfOrigin } = req.nextUrl;
  const method = req.method.toUpperCase();
  const isMutation = MUTATING_METHODS.has(method);

  // 1) Origin allowlist on mutations — reject cross-origin writes before any work.
  if (isMutation) {
    const allowlist = process.env.NEXT_PUBLIC_SITE_ORIGIN ? [process.env.NEXT_PUBLIC_SITE_ORIGIN] : [];
    if (!isOriginAllowed(req.headers.get("origin"), selfOrigin, allowlist)) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 }),
      );
    }
  }

  // 2) IP rate-limit the mutating public routes BEFORE the route runs (validate-before-pay).
  if (isMutation && RATE_LIMITED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const outcome = await checkIpRateLimit(clientIp(req));
    if (!outcome.allowed) {
      const res = NextResponse.json({ error: "Too many requests." }, { status: 429 });
      res.headers.set("RateLimit-Limit", String(outcome.limit));
      res.headers.set("RateLimit-Remaining", String(outcome.remaining));
      return withSecurityHeaders(res);
    }
  }

  // 3) Pass through, with security headers on the onward response.
  return withSecurityHeaders(NextResponse.next());
}

/**
 * Run the proxy on app routes; skip Next internals and static assets so headers ride on real
 * responses and the rate limiter never sees asset traffic. The service worker (/sw.js) and metadata
 * files are excluded so they are not gated.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt).*)"],
};
