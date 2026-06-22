import { describe, it, expect } from "vitest";
import {
  ACCENTS,
  DEFAULT_PREFERENCES,
  isAccent,
  isTheme,
  THEMES,
} from "@/lib/preferences/preferences";

describe("isTheme", () => {
  it("accepts every declared theme", () => {
    for (const t of THEMES) expect(isTheme(t)).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isTheme("blue")).toBe(false);
    expect(isTheme("Light")).toBe(false); // case-sensitive
    expect(isTheme("")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(0)).toBe(false);
  });
});

describe("isAccent", () => {
  it("accepts every declared accent", () => {
    for (const a of ACCENTS) expect(isAccent(a)).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isAccent("emerald ")).toBe(false);
    expect(isAccent("red")).toBe(false);
    expect(isAccent("")).toBe(false);
    expect(isAccent(undefined)).toBe(false);
    expect(isAccent(null)).toBe(false);
    expect(isAccent(42)).toBe(false);
  });
});

describe("DEFAULT_PREFERENCES", () => {
  it("matches the user_preferences column defaults", () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      theme: "light",
      accent: "emerald",
      notifyCascade: true,
      quietHours: true,
      shareStatus: false,
    });
  });

  it("uses values that pass the type guards", () => {
    expect(isTheme(DEFAULT_PREFERENCES.theme)).toBe(true);
    expect(isAccent(DEFAULT_PREFERENCES.accent)).toBe(true);
  });
});
