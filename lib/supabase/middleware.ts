import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Refresh the Supabase session at the edge-of-app proxy (R23 account layer). Returns the response
 * carrying any rotated auth cookies, plus the verified user. Folded into the single Next 16 `proxy`
 * (this codebase has no separate middleware file) so session refresh composes with the existing
 * security-header / origin / rate-limit pipeline.
 *
 * `requestHeaders` is the proxy's nonce-augmented copy of the incoming headers (it carries `x-nonce`
 * and the per-request `Content-Security-Policy` Next reads to stamp the script nonce). We forward it
 * on every `NextResponse.next({ request })` so SSR sees the nonce; when Supabase rotates auth cookies
 * we re-merge the updated `cookie` header onto it so the same render also sees the fresh session.
 *
 * When Supabase env is absent the helper no-ops (returns the passthrough response + null user) so the
 * marketing site still serves before credentials are wired into .env.local.
 */
export async function refreshSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { response, user: null };

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // `request.cookies.set()` rewrites the request's own `cookie` header WITH RequestCookies'
        // encoding, so derive the forwarded headers from `request.headers` (correctly-encoded fresh
        // session) and re-apply the nonce + CSP that live on `requestHeaders`. Rebuilding the cookie
        // string by hand would drop that encoding.
        const merged = new Headers(request.headers);
        const nonce = requestHeaders.get("x-nonce");
        const csp = requestHeaders.get("content-security-policy");
        if (nonce) merged.set("x-nonce", nonce);
        if (csp) merged.set("content-security-policy", csp);
        response = NextResponse.next({ request: { headers: merged } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() re-validates the JWT with the auth server and rotates cookies via setAll if needed.
  // Guarded: a transient auth-server failure must not 500 every request — treat it as "no user".
  let user: User | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  return { response, user };
}
