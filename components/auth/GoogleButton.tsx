"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import s from "@/app/auth.module.css";

/**
 * "Continue with Google" — initiates the Supabase OAuth (PKCE) flow from the browser. Supabase
 * redirects to Google, Google back to Supabase, and Supabase to our /auth/callback (carrying ?next),
 * which exchanges the code for a session. The PKCE verifier is stored in a cookie by the browser
 * client and read by the server callback.
 */
export function GoogleButton({ next, label = "Continue with Google" }: { next?: string; label?: string }): React.ReactElement {
  const [pending, setPending] = useState(false);

  async function go() {
    setPending(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setPending(false); // on success the browser has already navigated away
  }

  return (
    <button type="button" className={s.btnOauth} onClick={go} disabled={pending}>
      <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden>
        <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z" />
        <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
        <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
      </svg>
      {pending ? "Redirecting…" : label}
    </button>
  );
}
