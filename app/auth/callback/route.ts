import { NextResponse } from "next/server";
import { createClientOnResponse } from "@/lib/supabase/server";

/**
 * OAuth callback (R23). After Google → Supabase, Supabase redirects here with ?code. We exchange it
 * for a session (the PKCE verifier rides in a cookie set by the browser client that started the
 * flow), then forward to ?next (default the dashboard). Any failure lands on login with a flag,
 * never leaking why.
 *
 * Session cookies are bound to the SUCCESS redirect response (createClientOnResponse): a Route Handler's
 * `next/headers` cookie writes don't ride a custom returned response, so without this the new session is
 * dropped and the user is bounced to /login despite a valid code exchange.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const response = NextResponse.redirect(new URL(next, origin));
    const supabase = await createClientOnResponse(response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  return NextResponse.redirect(new URL("/login?error=oauth", origin));
}

function sanitizeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
