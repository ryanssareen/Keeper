import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase browser client for Client Components (e.g. logout buttons, live session reads). Uses the
 * public URL + anon key, which are safe to ship to the browser — row-level security, not key secrecy,
 * is what protects data.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
