import { describe, it, expect } from "vitest";
import { renderCatch } from "@/lib/push/template";
import type { StructuredAdvice } from "@/lib/push/types";

/**
 * Catch-template rendering. Each case pins an explicit zone so the suite is independent of the
 * machine clock and locale (gate: passes under TZ=UTC and a DST-observing TZ). Instants are chosen
 * so the local wall-time is unambiguous; we assert the rendered local time directly.
 */

// A reschedulable CATCH baseline in Madrid (CEST = UTC+2 in June): instants render +2h local.
const base = (over: Partial<StructuredAdvice> = {}): StructuredAdvice => ({
  kind: "CATCH",
  flightNumber: "IB3170",
  newArrivalUtc: "2026-06-20T18:00:00Z", // 20:00 local
  projectedAtPlaceUtc: "2026-06-20T18:30:00Z", // 20:30 local
  placeLabel: "Sagrada Família tour",
  reschedulable: true,
  recommendedNewTimeUtc: "2026-06-20T19:30:00Z", // 21:30 local
  contact: "the tour operator",
  zone: "Europe/Madrid",
  ...over,
});

describe("renderCatch — CATCH reschedulable", () => {
  it("includes the recommended NEW local time and the contact", () => {
    const msg = renderCatch(base());
    expect(msg.title).toBe("Heads up — you'll miss Sagrada Família tour");
    // recommended new time 19:30Z -> 21:30 local -> "9:30 PM"
    expect(msg.body).toContain("9:30 PM");
    expect(msg.body).toContain("push it to ~9:30 PM");
    expect(msg.body).toContain("the tour operator");
    // flightNumber + place always appear
    expect(msg.body).toContain("IB3170");
    expect(msg.body).toContain("Sagrada Família tour");
    // and the "what broke" / "what it means" local times
    expect(msg.body).toContain("8:00 PM"); // new arrival 18:00Z -> 20:00 local
    expect(msg.body).toContain("8:30 PM"); // projected 18:30Z -> 20:30 local
  });

  it("omits the contact clause gracefully when contact is null", () => {
    const msg = renderCatch(base({ contact: null }));
    expect(msg.body).not.toContain("contacting");
    expect(msg.body).not.toContain("null");
    // still recommends the new time and stays well-formed
    expect(msg.body).toContain("push it to ~9:30 PM");
    expect(msg.body).toContain("We recommend rescheduling");
    expect(msg.body).toContain("IB3170");
    expect(msg.body).toContain("Sagrada Família tour");
  });
});

describe("renderCatch — CATCH fixed (reschedulable false)", () => {
  it("says the booking is likely lost and points at the window, with NO push-to time", () => {
    const msg = renderCatch(
      base({ reschedulable: false, recommendedNewTimeUtc: null, contact: null }),
    );
    expect(msg.body).toContain("likely lost");
    expect(msg.body.toLowerCase()).toMatch(/cancellation|exchange/);
    // The fixed branch must never recommend a new time.
    expect(msg.body).not.toContain("push it");
    expect(msg.body).not.toContain("9:30 PM");
    // flightNumber + place still present.
    expect(msg.body).toContain("IB3170");
    expect(msg.body).toContain("Sagrada Família tour");
  });

  it("fixed branch still renders even when a recommendedNewTime leaks in (ignored)", () => {
    // Defensive: a fixed commitment with a stray recommended time must not surface a push-to clause.
    const msg = renderCatch(base({ reschedulable: false }));
    expect(msg.body).not.toContain("push it");
    expect(msg.body).toContain("likely lost");
  });
});

describe("renderCatch — zone rendering", () => {
  it("renders projectedAtPlaceUtc 18:30Z in Europe/Madrid as 20:30 local (8:30 PM)", () => {
    const dt = renderCatch(
      base({ projectedAtPlaceUtc: "2026-06-20T18:30:00Z", zone: "Europe/Madrid" }),
    );
    // Assert the local hour explicitly: 18:30Z + 2h (CEST) = 20:30 local.
    expect(dt.body).toContain("8:30 PM");
    expect(dt.body).not.toContain("6:30 PM"); // would be the bug: rendering UTC, not local
  });

  it("renders a CANNOT_CONFIRM with no instants without crashing", () => {
    const msg = renderCatch(
      base({
        kind: "CANNOT_CONFIRM",
        newArrivalUtc: null,
        projectedAtPlaceUtc: null,
        recommendedNewTimeUtc: null,
        contact: null,
      }),
    );
    expect(msg.title).toContain("IB3170");
    expect(msg.body).toContain("Sagrada Família tour");
  });
});

describe("renderCatch — other kinds", () => {
  it("ALL_CLEAR: title says back on track for the place", () => {
    const msg = renderCatch(base({ kind: "ALL_CLEAR" }));
    expect(msg.title).toBe("You're back on track for Sagrada Família tour");
    expect(msg.body).toContain("IB3170");
  });

  it("CANNOT_CONFIRM: title says the flight status can't be confirmed", () => {
    const msg = renderCatch(base({ kind: "CANNOT_CONFIRM" }));
    expect(msg.title.toLowerCase()).toContain("confirm");
    expect(msg.title).toContain("IB3170");
  });

  it("CANCELLED: terminal wording naming the place and flight", () => {
    const msg = renderCatch(base({ kind: "CANCELLED" }));
    expect(msg.title.toLowerCase()).toContain("cancel");
    expect(msg.title).toContain("IB3170");
    expect(msg.body).toContain("Sagrada Família tour");
  });

  it("DEFINITE_MISS: terminal wording naming the place and flight", () => {
    const msg = renderCatch(base({ kind: "DEFINITE_MISS" }));
    expect(msg.title).toContain("Sagrada Família tour");
    expect(msg.body).toContain("IB3170");
    // No reschedule recommendation on a terminal miss.
    expect(msg.body).not.toContain("push it");
  });
});
