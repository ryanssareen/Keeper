import { describe, it, expect } from "vitest";
import { deriveSharedStatus, type NextItem } from "@/lib/share/share";
import { WATCH_STATES } from "@/lib/engine/types";

/**
 * The share status-deriving helper, asserted PURELY (no DB, no clock). This is the one piece of share
 * logic with real branching — every WatchState (plus the null "no live watch" case) must map to a
 * friendly, family-facing line that never leaks engine vocabulary, flight numbers, or instants.
 */

const nextItem: NextItem = { title: "Lunch", placeName: "Café Central", when: "Sat, 13:00" };

describe("deriveSharedStatus — per state", () => {
  it("OK reads as on-track and names the destination", () => {
    const { headline, sub } = deriveSharedStatus("OK", "Madrid", "Mum", null);
    expect(headline).toBe("Mum is on track in Madrid");
    expect(sub).toBe("Everything looks good — no delays expected.");
  });

  it("AT_RISK reads as 'getting tight' without alarm", () => {
    const { headline } = deriveSharedStatus("AT_RISK", "Madrid", "Mum", null);
    expect(headline).toBe("Mum's timing is getting tight");
  });

  it("CANCELLED ignores any next item and reads reassuringly", () => {
    const { headline, sub } = deriveSharedStatus("CANCELLED", "Madrid", "Mum", nextItem);
    expect(headline).toBe("Mum's flight was cancelled");
    // The cancelled branch deliberately drops the "next up" clause (the plan is being remade).
    expect(sub).not.toContain("Café Central");
  });

  it("LANDED_CAPTURE reads as landed", () => {
    const { headline } = deriveSharedStatus("LANDED_CAPTURE", "Lisbon", "Dad", null);
    expect(headline).toBe("Dad has landed in Lisbon");
  });

  it("produces a non-empty headline + sub for EVERY known watch state", () => {
    for (const state of WATCH_STATES) {
      const { headline, sub } = deriveSharedStatus(state, "Rome", "Sam", null);
      expect(headline.length).toBeGreaterThan(0);
      expect(sub.length).toBeGreaterThan(0);
    }
  });
});

describe("deriveSharedStatus — null state (no live watch)", () => {
  it("reads as planning, never as an error", () => {
    const { headline, sub } = deriveSharedStatus(null, "Tokyo", "Mum", null);
    expect(headline).toBe("Mum is planning Tokyo");
    expect(sub).toContain("check back");
  });
});

describe("deriveSharedStatus — next-item clause", () => {
  it("surfaces the next stop with its time when provided", () => {
    const { sub } = deriveSharedStatus("OK", "Madrid", "Mum", nextItem);
    expect(sub).toBe("Next up: Café Central at Sat, 13:00.");
  });

  it("omits the time clause for an untimed next stop", () => {
    const { sub } = deriveSharedStatus("OK", "Madrid", "Mum", {
      title: "Wander the old town",
      placeName: "Old Town",
      when: "",
    });
    expect(sub).toBe("Next up: Old Town.");
  });

  it("falls back to the item title when placeName is blank", () => {
    const { sub } = deriveSharedStatus("OK", "Madrid", "Mum", {
      title: "Pick up tickets",
      placeName: "",
      when: "",
    });
    expect(sub).toBe("Next up: Pick up tickets.");
  });
});

describe("deriveSharedStatus — fallbacks + safety", () => {
  it("falls back to a generic name when ownerName is blank", () => {
    const { headline } = deriveSharedStatus("OK", "Madrid", "   ", null);
    expect(headline).toBe("Your traveler is on track in Madrid");
  });

  it("falls back to 'their trip' when dest is blank", () => {
    const { headline } = deriveSharedStatus("OK", "", "Mum", null);
    expect(headline).toBe("Mum is on track in their trip");
  });

  it("never throws and stays generic for a drifted/unknown state", () => {
    // Simulate a future enum value the deriver hasn't been taught — the default branch must hold.
    const { headline, sub } = deriveSharedStatus(
      "SOME_NEW_STATE" as never,
      "Madrid",
      "Mum",
      null,
    );
    expect(headline).toBe("Mum is travelling to Madrid");
    expect(sub.length).toBeGreaterThan(0);
  });

  it("never leaks engine vocabulary into the family-facing copy", () => {
    for (const state of WATCH_STATES) {
      const { headline, sub } = deriveSharedStatus(state, "Rome", "Sam", nextItem);
      const text = `${headline} ${sub}`;
      // No raw state tokens (e.g. "AT_RISK", "LANDED_CAPTURE") should appear in user-facing copy.
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });
});
