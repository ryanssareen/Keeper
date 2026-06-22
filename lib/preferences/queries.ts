import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { DEFAULT_PREFERENCES, isAccent, isTheme, type Preferences } from "./preferences";

/**
 * Read the current user's saved preferences (theme / accent / notification toggles).
 * Called directly from the Server Component (root layout, settings page) — NOT a Server Action.
 * Keeping this outside "use server" preserves full request-cookie access.
 *
 * Always resolves to a usable Preferences object: a logged-out request, a brand-new account with no
 * saved row, an unconfigured Supabase, or a missing user_preferences table all fall back to
 * DEFAULT_PREFERENCES so the root layout never has to handle a null palette.
 */
export async function loadPreferences(): Promise<Preferences> {
  if (!isSupabaseConfigured()) return DEFAULT_PREFERENCES;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_PREFERENCES;

    const { data } = await supabase
      .from("user_preferences")
      .select("theme, accent, notify_cascade, quiet_hours, share_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) return DEFAULT_PREFERENCES;

    // Map snake_case row -> camelCase Preferences. Fall back per-field to the defaults if a stored
    // value somehow falls outside the CHECK set (defensive — the column constraints enforce it).
    return {
      theme: isTheme(data.theme) ? data.theme : DEFAULT_PREFERENCES.theme,
      accent: isAccent(data.accent) ? data.accent : DEFAULT_PREFERENCES.accent,
      notifyCascade: data.notify_cascade ?? DEFAULT_PREFERENCES.notifyCascade,
      quietHours: data.quiet_hours ?? DEFAULT_PREFERENCES.quietHours,
      shareStatus: data.share_status ?? DEFAULT_PREFERENCES.shareStatus,
    };
  } catch {
    // Table missing (migration not yet applied) or any transient read failure — never break the render.
    return DEFAULT_PREFERENCES;
  }
}
