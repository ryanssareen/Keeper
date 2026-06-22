// Client-safe preference constants, types, and pure guards. NO server imports here — this module is
// pulled into the browser bundle by the settings UI (and read by the root layout), so the Supabase
// server client (next/headers) lives in `lib/preferences/queries.ts` instead.

/** The fixed set of color themes a user picks from. Mirrors the user_preferences.theme CHECK. */
export const THEMES = ["light", "dark"] as const;

/** The fixed set of accent colors a user picks from. Mirrors the user_preferences.accent CHECK. */
export const ACCENTS = ["emerald", "teal", "indigo", "violet"] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export const isTheme = (v: unknown): v is Theme =>
  typeof v === "string" && (THEMES as readonly string[]).includes(v);

export const isAccent = (v: unknown): v is Accent =>
  typeof v === "string" && (ACCENTS as readonly string[]).includes(v);

export type Preferences = {
  theme: Theme;
  accent: Accent;
  notifyCascade: boolean;
  quietHours: boolean;
  shareStatus: boolean;
};

/**
 * Returned when there is no signed-in user, no saved row, or Supabase is not configured / the table is
 * missing. Mirrors the column defaults in the user_preferences migration so a logged-out render and a
 * brand-new account look identical.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  accent: "emerald",
  notifyCascade: true,
  quietHours: true,
  shareStatus: false,
};

// Theme + accent are mirrored into cookies on save so the root layout can read them during SSR and
// paint the correct palette with no flash before the client hydrates.
export const THEME_COOKIE = "keeper-theme";
export const ACCENT_COOKIE = "keeper-accent";
