"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  ACCENT_COOKIE,
  ACCENTS,
  THEME_COOKIE,
  THEMES,
  type Preferences,
} from "./preferences";

// One year, in seconds — the theme/accent cookies are a no-flash SSR hint, refreshed on every save.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Validate only the fields a caller actually sends. Each is optional so a settings toggle can persist a
// single column without round-tripping the rest; mirrors the user_preferences CHECK / type bounds.
const preferencesSchema = z
  .object({
    theme: z.enum(THEMES),
    accent: z.enum(ACCENTS),
    notifyCascade: z.boolean(),
    quietHours: z.boolean(),
    shareStatus: z.boolean(),
  })
  .partial();

/**
 * Persist a partial set of preferences for the current user, writing ONLY the provided columns (so a
 * single toggle does not clobber the others). Theme + accent are ALSO mirrored into cookies so the root
 * layout can read them during SSR and paint the right palette with no flash before hydration.
 */
export async function savePreferences(partial: Partial<Preferences>): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const parsed = preferencesSchema.safeParse(partial);
  if (!parsed.success) {
    console.error("[preferences] rejected invalid input:", parsed.error.message);
    return { ok: false };
  }
  const prefs = parsed.data;

  // Map camelCase -> snake_case, keeping only the keys the caller supplied so an upsert UPDATE never
  // touches an unprovided column (a fresh INSERT falls back to the table defaults).
  const row: Record<string, string | boolean> = { user_id: user.id };
  if (prefs.theme !== undefined) row.theme = prefs.theme;
  if (prefs.accent !== undefined) row.accent = prefs.accent;
  if (prefs.notifyCascade !== undefined) row.notify_cascade = prefs.notifyCascade;
  if (prefs.quietHours !== undefined) row.quiet_hours = prefs.quietHours;
  if (prefs.shareStatus !== undefined) row.share_status = prefs.shareStatus;
  row.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from("user_preferences").upsert(row, { onConflict: "user_id" });
  if (error) {
    console.error("[preferences] failed to persist:", error.message);
    return { ok: false };
  }

  // Mirror the visual prefs into cookies for no-flash SSR. Only set those the caller actually changed.
  const cookieStore = await cookies();
  if (prefs.theme !== undefined) {
    cookieStore.set(THEME_COOKIE, prefs.theme, { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
  }
  if (prefs.accent !== undefined) {
    cookieStore.set(ACCENT_COOKIE, prefs.accent, { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
