/**
 * Map Supabase auth errors to friendly, non-leaking copy. Supabase's raw strings ("User already
 * registered", "Invalid login credentials") are exactly what the user sees, so we translate the
 * common ones and fall back to the raw message only when we don't recognise it.
 *
 * Pure and dependency-free on purpose: kept out of the "use server" actions module so it can be
 * unit-tested without pulling in next/headers and the server-action runtime.
 */
export function friendlyAuthError(error: { message?: string; code?: string }): string {
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  if (code === "user_already_exists" || msg.includes("already registered") || msg.includes("already exists"))
    return "An account with this email already exists. Log in instead.";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials"))
    return "That email or password is incorrect.";
  if (code === "email_not_confirmed" || msg.includes("not confirmed"))
    return "Confirm your email first — check your inbox for the link.";
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit") || msg.includes("rate-limit"))
    return "Too many attempts just now. Wait a minute, then try again.";
  if (code === "weak_password" || msg.includes("password"))
    return error.message ?? "Please choose a stronger password.";
  return error.message ?? "Something went wrong. Please try again.";
}
