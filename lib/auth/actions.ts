"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  if (error) return { error: error.message };

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
  if (error) return { error: error.message };

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
  if (error) return { error: error.message };
  return { notice: "Password updated." };
}
