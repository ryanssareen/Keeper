import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { securityHeaders, buildContentSecurityPolicy } from "@/lib/security/headers";
import { checkIpRateLimit } from "@/lib/security/ratelimit";
import { refreshSession } from "@/lib/supabase/middleware";

/**
 * Edge-of-app abuse controls (R24, R25) + Supabase session refresh (R23 account layer). In Next 16
 * this file is the "proxy" (formerly middleware); it runs before any route handler, which lets us
 * enforce cross-cutting concerns WITHOUT touching the route files:
 *   1. Set baseline security headers on every response.
 *   2. Reject cross-origin MUTATIONS (POST/PUT/PATCH/DELETE) with 403 (Origin allowlist).
 *   3. IP-rate-limit the mutating public routes BEFORE they run, returning 429 when tripped — this
 *      preserves validate-before-pay because the limit precedes any paid work in the route.
 *   4. Refresh the Supabase auth session (rotates cookies) and gate the post-auth app routes.
 * The watch CAPABILITY token stays header/query-sent and is never read here (never a cookie); it is a
 * separate ownership channel from the account session, so a push deep-link still works logged-out.
 */

/** Mutating HTTP methods that spend resources or change state. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Public mutating routes that must be IP-rate-limited before the route's paid work runs. */
const RATE_LIMITED_PATHS = ["/api/watch", "/api/self-report", "/api/push/subscribe", "/api/contact"];

/**
 * Post-auth app routes that require a signed-in account. NOTE: /dashboard is intentionally NOT here —
 * it serves two audiences (a logged-in owner AND a logged-out push deep-link carrying ?id&token), so
 * its access decision lives in the page, not the proxy.
 */
const PROTECTED_PREFIXES = [
  "/onboarding",
  "/settings",
  "/today",
  "/itinerary",
  "/bookings",
  "/alerts",
  "/checklist",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

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

/**
 * Mint a per-request script nonce using only Web APIs guaranteed in the edge runtime (no Node
 * `Buffer`). 16 random bytes → base64 is ample unpredictability for a one-time CSP nonce.
 */
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, origin: selfOrigin } = req.nextUrl;
  const method = req.method.toUpperCase();
  const isMutation = MUTATING_METHODS.has(method);
  const isDev = process.env.NODE_ENV === "development";

  // Mint the nonce and the request headers Next reads to stamp it onto its inline scripts. Both the
  // forwarded REQUEST (so SSR extracts the nonce) and the final RESPONSE must carry the same CSP.
  const nonce = generateNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildContentSecurityPolicy(nonce, isDev));

  /** Apply the baseline security headers (incl. the nonce'd CSP) to a response in place. */
  const withSecurityHeaders = (res: NextResponse): NextResponse => {
    for (const [name, value] of securityHeaders(nonce, isDev)) res.headers.set(name, value);
    return res;
  };

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

  // 3) API routes need no session refresh here: they're not navigations (no auth cookies to rotate),
  // and any route that needs the user resolves it itself via getCurrentUser. Skipping them keeps the
  // hot cron/reconcile path off the Supabase auth round-trip. (JSON responses carry no scripts, so
  // the nonce is inert here — still forwarded for header consistency.)
  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // 4) Refresh the Supabase session (rotates auth cookies onto `response`). No-ops without env.
  const { response, user } = await refreshSession(req, requestHeaders);

  // 5) Gate the post-auth app routes — bounce unauthenticated users to login, preserving intent.
  if (isProtected(pathname) && !user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // 6) Pass through the session-bearing response, with security headers on it.
  return withSecurityHeaders(response);
}

/**
 * Run the proxy on app routes; skip Next internals and static assets so headers ride on real
 * responses and the rate limiter never sees asset traffic. The service worker (/sw.js) and metadata
 * files are excluded so they are not gated.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt).*)"],
};
