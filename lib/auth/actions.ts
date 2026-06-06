"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyAuthError } from "@/lib/auth/errors";

/**
 * Auth server actions (R23 account layer) for the email/password flow. Consumed by the login + signup
 * forms via useActionState. On success they redirect (redirect() throws control flow, so it is never
 * returned); on failure they return a typed state the form renders inline.
 */
export type AuthState = { error?: string; notice?: string } | undefined;

/** Resolve this deployment's origin for email-confirmation links: explicit env first, else the host header. */
async function siteOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

function sanitizeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  // Only allow same-site absolute paths — never an open redirect to another origin.
  return n.startsWith("/") && !n.startsWith("//") ? n : "";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(formData.get("next"));

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendlyAuthError(error) };

  revalidatePath("/", "layout");
  redirect(next || "/dashboard");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and a password." };
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent("/onboarding")}`,
    },
  });
  if (error) return { error: friendlyAuthError(error) };

  // Email-enumeration protection: signing up with an ALREADY-registered email does not error — it
  // returns a user whose identities array is empty (and no session). Surface that as "already exists"
  // so the person is routed to log in, never left waiting for a confirmation email that won't arrive.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: "An account with this email already exists. Log in instead." };
  }

  // Auto-confirm projects return a live session immediately → straight into onboarding.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/onboarding");
  }

  // Email-confirmation projects: no session yet. Tell the user to check their inbox.
  return { notice: "Check your email to confirm your account, then log in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Update the signed-in user's display name (stored in auth user_metadata.full_name). */
export async function updateProfile(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { notice: "Profile saved." };
}

/** Change the signed-in user's password. */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (next.length < 8) return { error: "Use at least 8 characters." };
  if (next !== confirm) return { error: "The new passwords don’t match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: friendlyAuthError(error) };
  return { notice: "Password updated." };
}

/**
 * Forgot-password step 1: email a recovery link. It lands on /auth/callback (PKCE code exchange),
 * which forwards to /reset-password with a live recovery session. We always return the same neutral
 * notice so the response never reveals whether an email is registered; only an actionable rate-limit
 * is surfaced.
 */
export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error && /rate.?limit/i.test(error.message)) return { error: friendlyAuthError(error) };

  return { notice: "If an account exists for that email, a reset link is on its way. Check your inbox." };
}

/**
 * Forgot-password step 2: set the new password. Reached only with the recovery session established by
 * /auth/callback, so updateUser() is authorised. On success the user is already signed in → dashboard.
 */
export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== confirm) return { error: "Those passwords don’t match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: friendlyAuthError(error) };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
