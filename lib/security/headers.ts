/**
 * Baseline security headers (R25). Pure: returns the header entries; the proxy applies them to
 * every response. Kept side-effect-free (aside from reading public env) so it is trivially
 * unit-testable and can be reused by any response path.
 *
 * The CSP is "strict but workable" for this app's actual needs:
 *  - `default-src 'self'` — same-origin by default; no third-party content.
 *  - `script-src 'self' 'nonce-<n>' 'strict-dynamic'` — scripts stay strict: NO `'unsafe-inline'`.
 *    Next's App Router emits inline bootstrap/RSC-payload scripts, so a per-request NONCE is required
 *    or the page never hydrates (client `onClick`s die — e.g. the Google OAuth button). The proxy
 *    mints the nonce per request and Next stamps it onto every framework/page script it generates.
 *    `'strict-dynamic'` trusts scripts loaded BY a nonce'd script and makes host-allowlists moot;
 *    `'self'` is kept as a fallback for pre-CSP3 browsers. In dev, React needs `'unsafe-eval'`.
 *  - `style-src 'self' 'unsafe-inline'` — Tailwind v4 + Next inject inline <style>/style attrs and we
 *    deliberately do NOT nonce styles (a nonce does not cover inline style *attributes*). Inline
 *    *style* is a far smaller surface than inline *script*, which stays strict.
 *  - `img-src 'self' data: blob:` — inline data/blob images (icons, generated previews).
 *  - `connect-src 'self' <supabase https+wss>` — same-origin API/server-actions PLUS the app's own
 *    Supabase backend (the browser client may reach auth/realtime). Derived from
 *    NEXT_PUBLIC_SUPABASE_URL so it tracks the project, never a hardcoded host.
 *  - `worker-src 'self'` — the service worker at /sw.js (Web Push registration) is same-origin.
 *  - `manifest-src 'self'`, `font-src 'self'`, `base-uri 'self'`, `form-action 'self'`.
 *  - `object-src 'none'`, `frame-ancestors 'none'` — kill plugin/clickjacking surface.
 *  - `upgrade-insecure-requests` — defense-in-depth alongside HSTS.
 */

/**
 * The app's own Supabase origin as connect-src sources (https for REST/auth, wss for realtime).
 * Falls back to same-origin-only when the public URL is absent (pre-credentials marketing build).
 */
function supabaseConnectSources(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "'self'";
  try {
    const { host } = new URL(url);
    return `'self' https://${host} wss://${host}`;
  } catch {
    return "'self'";
  }
}

/**
 * Build the single-line CSP header value.
 *
 * @param nonce  per-request script nonce minted by the proxy. When omitted, script-src falls back to
 *               `'self'` only (the nonce-less baseline used by unit tests / non-render responses).
 * @param isDev  when true, adds `'unsafe-eval'` to script-src — React's dev build uses `eval` to
 *               reconstruct server stacks. Never set in production.
 */
export function buildContentSecurityPolicy(nonce?: string, isDev = false): string {
  const scriptSrc = [
    "'self'",
    nonce ? `'nonce-${nonce}'` : null,
    nonce ? "'strict-dynamic'" : null,
    isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const directives: ReadonlyArray<readonly [string, string]> = [
    ["default-src", "'self'"],
    ["script-src", scriptSrc],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", supabaseConnectSources()],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
  ];

  const parts = directives.map(([name, value]) => `${name} ${value}`);
  parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/**
 * The baseline security header entries applied to every response. Returned as a stable array of
 * `[name, value]` tuples so the proxy can set them with a simple loop and tests can assert on them.
 *
 * @param nonce  per-request script nonce (see {@link buildContentSecurityPolicy}).
 * @param isDev  development flag (see {@link buildContentSecurityPolicy}).
 */
export function securityHeaders(
  nonce?: string,
  isDev = false,
): ReadonlyArray<readonly [string, string]> {
  return [
    ["Content-Security-Policy", buildContentSecurityPolicy(nonce, isDev)],
    // 2 years, include subdomains. (Add `; preload` only once you commit to the preload list.)
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Frame-Options", "DENY"],
    // Deny powerful features the app does not use; keep the surface explicit.
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()"],
  ] as const;
}
