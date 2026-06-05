import { describe, it, expect } from "vitest";
import { detectCollision } from "@/lib/engine/collision";
import { resolveLocal } from "@/lib/engine/time";
import type { CollisionInput } from "@/lib/engine/types";

/**
 * Thesis correctness core. Every case pins explicit zones + an explicit nowUtc, so the suite is
 * independent of the machine's system clock (gate: passes under TZ=UTC and a DST-observing TZ).
 */

// A comfortable MAKE baseline: arrive 16:00Z, +30m to the place = 16:30Z, deadline 18:00Z (London BST).
const base = (over: Partial<CollisionInput> = {}): CollisionInput => ({
  predictedArrivalUtc: "2026-06-20T16:00:00Z",
  egressMinutes: 20,
  transitMinutes: 10,
  commitment: {
    localWallTime: "2026-06-20T19:00:00",
    ianaZone: "Europe/London",
    marginMinutes: 0,
    reschedulable: true,
  },
  nowUtc: "2026-06-20T12:00:00Z",
  ...over,
});

describe("resolveLocal — timezone correctness", () => {
  it("standard time: Madrid CET (UTC+1)", () => {
    expect(resolveLocal("2026-12-20T20:00:00", "Europe/Madrid").toUTC().toISO()).toBe(
      "2026-12-20T19:00:00.000Z",
    );
  });

  it("after spring-forward: New York is EDT (UTC-4), not EST", () => {
    // 2026-03-08 is US DST start; 03:30 exists and is EDT -> 07:30Z
    expect(resolveLocal("2026-03-08T03:30:00", "America/New_York").toUTC().toISO()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("standard time: New York EST (UTC-5) rolls to the next UTC day", () => {
    expect(resolveLocal("2026-12-20T20:00:00", "America/New_York").toUTC().toISO()).toBe(
      "2026-12-21T01:00:00.000Z",
    );
  });
});

describe("detectCollision", () => {
  it("same-zone: comfortable arrival makes it (positive slack)", () => {
    const r = detectCollision(base());
    expect(r.verdict).toBe("make");
    expect(r.projectedAtPlaceUtc).toBe("2026-06-20T16:30:00.000Z");
    expect(r.slackMinutes).toBe(90);
    expect(r.leadMinutes).toBe(350); // must-leave 17:50Z - now 12:00Z
  });

  it("same-zone: a delay tips it to a miss (negative slack)", () => {
    const r = detectCollision(base({ predictedArrivalUtc: "2026-06-20T18:00:00Z" }));
    expect(r.verdict).toBe("miss");
    expect(r.projectedAtPlaceUtc).toBe("2026-06-20T18:30:00.000Z");
    expect(r.slackMinutes).toBe(-30);
  });

  it("boundary: arriving exactly at the deadline counts as make (inclusive)", () => {
    const r = detectCollision(base({ predictedArrivalUtc: "2026-06-20T17:30:00Z" }));
    expect(r.verdict).toBe("make");
    expect(r.slackMinutes).toBe(0);
  });

  it("indeterminate: no prediction yields no verdict, no slack, no lead", () => {
    const r = detectCollision(base({ predictedArrivalUtc: null }));
    expect(r.verdict).toBe("indeterminate");
    expect(r.projectedAtPlaceUtc).toBeNull();
    expect(r.slackMinutes).toBeNull();
    expect(r.leadMinutes).toBeNull();
  });

  it("cross-zone: same wall-time, different zone, opposite verdicts", () => {
    const arrival = "2026-06-20T18:00:00Z"; // +30m -> 18:30Z at the place
    const london = detectCollision(
      base({
        predictedArrivalUtc: arrival,
        commitment: {
          localWallTime: "2026-06-20T19:00:00",
          ianaZone: "Europe/London", // deadline 18:00Z
          marginMinutes: 0,
          reschedulable: true,
        },
      }),
    );
    const newYork = detectCollision(
      base({
        predictedArrivalUtc: arrival,
        commitment: {
          localWallTime: "2026-06-20T19:00:00",
          ianaZone: "America/New_York", // deadline 23:00Z
          marginMinutes: 0,
          reschedulable: true,
        },
      }),
    );
    expect(london.verdict).toBe("miss");
    expect(newYork.verdict).toBe("make");
  });

  it("overnight: arrival on the next calendar day compares as instants", () => {
    const r = detectCollision(
      base({
        predictedArrivalUtc: "2026-12-21T05:00:00Z",
        commitment: {
          localWallTime: "2026-12-21T09:00:00",
          ianaZone: "Europe/Madrid", // deadline 08:00Z
          marginMinutes: 0,
          reschedulable: true,
        },
      }),
    );
    expect(r.verdict).toBe("make");
    expect(r.slackMinutes).toBe(150); // 08:00Z - 05:30Z
  });

  it("margin: an arrival cushion is subtracted from the deadline", () => {
    const r = detectCollision(base({ commitment: { ...base().commitment, marginMinutes: 30 } }));
    expect(r.verdict).toBe("make");
    expect(r.slackMinutes).toBe(60); // deadline 17:30Z - projected 16:30Z
  });

  it("DST straddle: a commitment after spring-forward uses the post-jump offset", () => {
    // Flight lands 2026-03-08T06:00Z; commitment 03:30 EDT (07:30Z) +0 margin.
    // +30m to place -> 06:30Z < 07:30Z -> make. A fixed-EST (UTC-5) bug would read 08:30Z and still
    // make, so assert the resolved deadline instant via slack to catch the offset directly.
    const r = detectCollision(
      base({
        predictedArrivalUtc: "2026-03-08T06:00:00Z",
        commitment: {
          localWallTime: "2026-03-08T03:30:00",
          ianaZone: "America/New_York",
          marginMinutes: 0,
          reschedulable: true,
        },
      }),
    );
    expect(r.verdict).toBe("make");
    expect(r.slackMinutes).toBe(60); // deadline 07:30Z - projected 06:30Z; EST would give 120
  });
});
