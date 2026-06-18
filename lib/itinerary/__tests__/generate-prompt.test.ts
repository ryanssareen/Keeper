import { describe, it, expect } from "vitest";
import { promptFor, type GenerationAnchors } from "@/lib/itinerary/generate";

const base: GenerationAnchors = {
  city: "Tokyo",
  country: "Japan",
  days: ["2026-07-01", "2026-07-02"],
  party: "2 people",
};

describe("promptFor — weaves optional refinements into the prompt", () => {
  it("falls back to a generic prompt when no prefs are given", () => {
    const p = promptFor(base);
    expect(p).toContain("Tokyo, Japan");
    expect(p).toContain("~8 specific"); // default target
    expect(p).not.toContain("Travelers:");
    expect(p).not.toContain("FIXED commitments");
  });

  it("includes ages, interests, must-sees and fixed bookings when present", () => {
    const p = promptFor({
      ...base,
      prefs: {
        ages: "2 adults, 1 child age 7",
        interests: ["Food & drink", "History"],
        mustSee: "teamLab Planets",
        fixed: "dinner 8pm Jul 2",
      },
    });
    expect(p).toContain("2 adults, 1 child age 7");
    expect(p).toContain("Food & drink, History");
    expect(p).toContain("teamLab Planets");
    expect(p).toContain("FIXED commitments at set times: dinner 8pm Jul 2");
  });

  it("lets pace tune the per-day target", () => {
    expect(promptFor({ ...base, prefs: { pace: "relaxed" } })).toContain("~5 specific");
    expect(promptFor({ ...base, prefs: { pace: "packed" } })).toContain("~9 specific");
    expect(promptFor({ ...base, prefs: { pace: "relaxed" } })).toContain("Pace: relaxed");
  });
});
