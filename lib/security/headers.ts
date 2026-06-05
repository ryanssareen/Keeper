/**
 * Baseline security headers (R25). Pure: returns the header entries; the proxy applies them to
 * every response. Kept side-effect-free so it is trivially unit-testable and can be reused by any
 * response path.
 *
 * The CSP is "strict but workable" for this app's actual needs:
 *  - `default-src 'self'` — same-origin by default; no third-party content.
 *  - `script-src 'self'` — only our own bundles (no inline/eval in production).
 *  - `style-src 'self' 'unsafe-inline'` — Tailwind v4 + Next inject inline <style>/style attrs and
 *    there is no nonce plumbing in this skeleton, so inline styles must be allowed. (Scripts stay
 *    strict; inline *style* is a far smaller surface than inline *script*.)
 *  - `img-src 'self' data: blob:` — inline data/blob images (icons, generated previews).
 *  - `connect-src 'self'` — the dashboard talks only to our own /api/* routes. Web Push delivery is
 *    handled by the browser's push service out-of-band, so no extra connect origin is required.
 *  - `worker-src 'self'` — the service worker at /sw.js (Web Push registration) is same-origin.
 *  - `manifest-src 'self'`, `font-src 'self'`, `base-uri 'self'`, `form-action 'self'`.
 *  - `object-src 'none'`, `frame-ancestors 'none'` — kill plugin/clickjacking surface.
 *  - `upgrade-insecure-requests` — defense-in-depth alongside HSTS.
 */

/** The Content-Security-Policy directive list, assembled in one place so the test can pin it. */
const CSP_DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ["default-src", "'self'"],
  ["script-src", "'self'"],
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self' data: blob:"],
  ["font-src", "'self'"],
  ["connect-src", "'self'"],
  ["worker-src", "'self'"],
  ["manifest-src", "'self'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["object-src", "'none'"],
  ["frame-ancestors", "'none'"],
];

/** Build the single-line CSP header value from the directive table. */
export function buildContentSecurityPolicy(): string {
  const directives = CSP_DIRECTIVES.map(([name, value]) => `${name} ${value}`);
  directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * The baseline security header entries applied to every response. Returned as a stable array of
 * `[name, value]` tuples so the proxy can set them with a simple loop and tests can assert on them.
 */
export function securityHeaders(): ReadonlyArray<readonly [string, string]> {
  return [
    ["Content-Security-Policy", buildContentSecurityPolicy()],
    // 2 years, include subdomains. (Add `; preload` only once you commit to the preload list.)
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Frame-Options", "DENY"],
    // Deny powerful features the app does not use; keep the surface explicit.
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()"],
  ] as const;
}
