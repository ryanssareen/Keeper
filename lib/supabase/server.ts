import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase server client (R23 account layer). Bound to the request's cookie jar via @supabase/ssr so
 * server components, server actions, and route handlers all read the SAME authenticated session the
 * proxy refreshes. `cookies()` is a Request-time async API in Next 16, so it is awaited.
 *
 * The setAll try/catch is the documented pattern: server COMPONENTS may not mutate cookies (only
 * actions / route handlers can), and the proxy already refreshes the session on every request, so a
 * throw here is safe to swallow — the write simply happens in the proxy instead.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — ignore; the proxy owns the refresh write.
        }
      },
    },
  });
}

/**
 * The currently-authenticated user, or null. Always verifies the JWT with the Supabase auth server
 * (never trusts an unvalidated cookie), so callers can safely gate on the result.
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).");
  return url;
}

function supabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Add it to .env.local (see .env.example).");
  return key;
}
