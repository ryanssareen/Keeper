import { describe, it, expect } from "vitest";
import { formatInZone, formatUtc } from "@/lib/format/time";

/**
 * Shared instant formatter. Each case pins an explicit zone + instant so the suite is independent of
 * the machine clock and process locale (gate: passes under TZ=UTC and a DST-observing TZ). The two
 * surfaces (push 12h, dashboard 24h) are asserted from the one function so they provably can't drift.
 */

describe("formatInZone — clock-12h (push style)", () => {
  it("renders an instant in the place's local zone as 12-hour AM/PM", () => {
    // 18:30Z in Europe/Madrid (CEST, UTC+2 in June) -> 20:30 local -> "8:30 PM".
    expect(formatInZone("2026-06-20T18:30:00Z", "Europe/Madrid", "clock-12h")).toBe("8:30 PM");
  });

  it("renders local time, not UTC (the push bug guard)", () => {
    const out = formatInZone("2026-06-20T18:30:00Z", "Europe/Madrid", "clock-12h");
    expect(out).not.toBe("6:30 PM"); // would be the bug: rendering UTC, not local
  });

  it("returns an empty string for a null instant (push drops optional clauses)", () => {
    expect(formatInZone(null, "Europe/Madrid", "clock-12h")).toBe("");
  });

  it("crosses midnight correctly into the next local day", () => {
    // 23:30Z in Asia/Tokyo (UTC+9) -> 08:30 next day local -> "8:30 AM".
    expect(formatInZone("2026-06-20T23:30:00Z", "Asia/Tokyo", "clock-12h")).toBe("8:30 AM");
  });
});

describe("formatInZone — datetime-24h (dashboard header style)", () => {
  it("renders a 24-hour weekday+date in the commitment zone", () => {
    // 20:00Z, Europe/London is UTC+1 (BST) in June -> 21:00 local, Saturday.
    const out = formatInZone("2026-06-20T20:00:00Z", "Europe/London", "datetime-24h");
    expect(out).toContain("21:00");
    expect(out).toContain("Sat");
    expect(out).toContain("Jun");
    expect(out).not.toContain("PM"); // 24-hour: never AM/PM
  });
});

describe("formatInZone — fallbacks", () => {
  it("degrades an unknown IANA zone to the fixed-UTC readout instead of throwing", () => {
    const out = formatInZone("2026-06-20T18:30:00Z", "Not/AZone", "weekday-24h");
    expect(out).toContain("UTC");
    expect(out).toContain("18:30"); // rendered in UTC, not the bad zone
  });

  it("returns an unparseable instant verbatim", () => {
    expect(formatInZone("not-a-date", "Europe/London", "datetime-24h")).toBe("not-a-date");
  });
});

describe("formatUtc — dashboard fixed-UTC audit readout", () => {
  it("renders the instant in UTC with an explicit UTC suffix (no zone shift)", () => {
    const out = formatUtc("2026-06-20T18:30:00Z");
    expect(out).toContain("18:30");
    expect(out).toContain("UTC");
    expect(out).toContain("Sat");
  });

  it("defaults to weekday-24h but accepts an explicit style", () => {
    const out = formatUtc("2026-06-20T18:30:00Z", "datetime-24h");
    expect(out).toContain("18:30");
    expect(out).toContain("Jun"); // datetime style includes the date
    expect(out).toContain("UTC");
  });

  it("returns an unparseable instant verbatim", () => {
    expect(formatUtc("nope")).toBe("nope");
  });
});
