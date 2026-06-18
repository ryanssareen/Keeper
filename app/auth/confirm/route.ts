import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClientOnResponse } from "@/lib/supabase/server";

/**
 * Email-confirmation landing (R23). Supabase appends ?token_hash&type to the link in the confirmation
 * email; we exchange it for a session, then forward to ?next (default the dashboard). A bad/expired
 * link lands on login with an error flag rather than leaking why.
 *
 * Session cookies are bound to the SUCCESS redirect response (createClientOnResponse): a Route Handler's
 * `next/headers` cookie writes don't ride a custom returned response, so without this the freshly-minted
 * session is dropped and the user is bounced to /login despite a valid confirmation.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeNext(searchParams.get("next"));

  if (tokenHash && type) {
    const response = NextResponse.redirect(new URL(next, origin));
    const supabase = await createClientOnResponse(response);
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return response;
  }

  return NextResponse.redirect(new URL("/login?error=confirm", origin));
}

function sanitizeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
