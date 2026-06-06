import { createClient } from "@/lib/supabase/server";
import type { OnboardingRow } from "./actions";

/**
 * Read the saved onboarding row for the current user.
 * Called directly from the Server Component (page.tsx) — NOT a Server Action.
 * Keeping this outside "use server" preserves full request-cookie access.
 */
export async function loadOnboarding(): Promise<OnboardingRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("onboarding")
    .select("answers, step, completed")
    .eq("user_id", user.id)
    .maybeSingle();

  return data ?? null;
}
