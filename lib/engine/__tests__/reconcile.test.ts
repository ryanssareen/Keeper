import { describe, it, expect } from "vitest";
import { planReconcile, type WatchRow, type FlightFetch } from "@/lib/engine/reconcile";
import type { FlightArrival } from "@/lib/engine/types";

/**
 * Pure-planner matrix for the reconcile engine (U6). `planReconcile` is the deterministic decision
 * core: given a watch row, a flight fetch outcome, and `now`, it returns either a skip or the full
 * apply plan (next state, snapshot, fired outbox row, scheduling). The DB transaction shell
 * (`reconcileWatch`) is covered by the integration test, gated on DATABASE_URL.
 *
 * Geometry: commitment 20:00Z, margin 0, egress 35 + transit 30 = 65 min of buffer, so the deadline
 * is 20:00Z and a make requires predicted arrival <= 18:55Z. now = 17:00Z (3h of lead).
 */

const NOW = "2026-06-05T17:00:00.000Z";

const baseWatch = (over: Partial<WatchRow> = {}): WatchRow => ({
  id: "w1",
  state: "OK",
  revision: "r0",
  recoveryProgress: 0,
  commitmentInstantUtc: "2026-06-05T20:00:00.000Z",
  commitmentZone: "UTC",
  marginMinutes: 0,
  reschedulable: true,
  egressMinutes: 35,
  transitMinutes: 30,
  arrivalAirport: "JFK",
  lastFetchedAt: "2026-06-05T16:55:00.000Z",
  terminal: false,
  ...over,
});

const flight = (over: Partial<FlightArrival> = {}): FlightArrival => ({
  scheduledUtc: "2026-06-05T17:00:00Z",
  predictedUtc: "2026-06-05T17:00:00Z",
  actualUtc: null,
  status: "active",
  arrivalAirport: "JFK",
  revision: "rNEW",
  ...over,
});

const fresh = (over: Partial<FlightArrival> = {}): FlightFetch => ({ kind: "fresh", flight: flight(over) });
const unavailable: FlightFetch = { kind: "unavailable" };

describe("planReconcile: make-side (no fire)", () => {
  it("comfortable make on an OK watch → apply, no fire, snapshot records the make", () => {
    const plan = planReconcile(baseWatch(), fresh({ predictedUtc: "2026-06-05T17:00:00Z" }), NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("OK");
    expect(plan.fired).toBeNull();
    expect(plan.revision).toBe("rNEW");
    expect(plan.snapshot).toMatchObject({
      verdict: "make",
      resultingState: "OK",
      revision: "rNEW",
      fetchedAt: NOW,
      predictedArrivalUtc: "2026-06-05T17:00:00Z",
    });
  });

  it("OK → AT_RISK when slack is tight, no catch", () => {
    // predicted 18:45 → projected 19:50 → slack 10 (< OK band 20), still a make.
    const plan = planReconcile(baseWatch(), fresh({ predictedUtc: "2026-06-05T18:45:00Z" }), NOW);
    expect(plan).toMatchObject({ kind: "apply", state: "AT_RISK", fired: null });
  });
});

describe("planReconcile: miss-side + anti-flap (AE9)", () => {
  it("AT_RISK → MISS_PREDICTED fires one CATCH with lead time + useful_lead", () => {
    // predicted 19:15 → projected 20:20 → slack -20 (deficit ≥ anti-flap 10).
    const plan = planReconcile(baseWatch({ state: "AT_RISK" }), fresh({ predictedUtc: "2026-06-05T19:15:00Z" }), NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("MISS_PREDICTED");
    expect(plan.fired).toEqual({
      transition: "AT_RISK->MISS_PREDICTED",
      kind: "CATCH",
      leadTimeMinutes: 150, // mustLeave 19:30 − now 17:00
      usefulLead: true, // 150 ≥ usable-lead 30
    });
  });

  it("MISS_PREDICTED worsens further → snapshot logged, but no repeat catch", () => {
    const plan = planReconcile(
      baseWatch({ state: "MISS_PREDICTED", revision: "r0" }),
      fresh({ predictedUtc: "2026-06-05T19:30:00Z", revision: "rWORSE" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("MISS_PREDICTED");
    expect(plan.fired).toBeNull();
    expect(plan.snapshot.revision).toBe("rWORSE"); // still appended (append-only corpus)
  });

  it("a CATCH fired with too little lead is recorded as not useful", () => {
    // now 19:25, mustLeave 19:30 → lead 5 (< usable-lead 30).
    const plan = planReconcile(
      baseWatch({ state: "AT_RISK" }),
      fresh({ predictedUtc: "2026-06-05T19:15:00Z" }),
      "2026-06-05T19:25:00.000Z",
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.fired).toMatchObject({ kind: "CATCH", leadTimeMinutes: 5, usefulLead: false });
  });
});

describe("planReconcile: recovery dwell (AE2)", () => {
  it("sustained recovery beyond the band fires ALL_CLEAR once the dwell is met", () => {
    // predicted 18:40 → projected 19:45 → slack 15 (≥ recovery band 10); progress 1 → 2 meets dwell.
    const plan = planReconcile(
      baseWatch({ state: "MISS_PREDICTED", recoveryProgress: 1 }),
      fresh({ predictedUtc: "2026-06-05T18:40:00Z" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("RECOVERED");
    expect(plan.recoveryProgress).toBe(2);
    expect(plan.fired).toMatchObject({ kind: "ALL_CLEAR", leadTimeMinutes: null, usefulLead: null });
  });

  it("a recovery dip within the dwell is suppressed (no ALL_CLEAR)", () => {
    const plan = planReconcile(
      baseWatch({ state: "MISS_PREDICTED", recoveryProgress: 0 }),
      fresh({ predictedUtc: "2026-06-05T18:40:00Z" }),
      NOW,
    );
    expect(plan).toMatchObject({ kind: "apply", state: "MISS_PREDICTED", fired: null });
    if (plan.kind !== "apply") return;
    expect(plan.recoveryProgress).toBe(1); // dwell building
  });
});

describe("planReconcile: terminal edges (AE3)", () => {
  it("cancellation from any live state → terminal CANCELLED catch, polling stops", () => {
    const plan = planReconcile(baseWatch({ state: "AT_RISK" }), fresh({ status: "cancelled" }), NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("CANCELLED");
    expect(plan.terminal).toBe(true);
    expect(plan.nextPollMinutes).toBeNull();
    expect(plan.fired).toMatchObject({ kind: "CANCELLED" });
  });

  it("commitment passes while still en route (fresh data) → DEFINITE_MISS terminal", () => {
    const plan = planReconcile(
      baseWatch(),
      fresh({ predictedUtc: "2026-06-05T19:15:00Z", status: "active" }),
      "2026-06-05T20:05:00.000Z",
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("DEFINITE_MISS");
    expect(plan.terminal).toBe(true);
    expect(plan.fired).toMatchObject({ kind: "DEFINITE_MISS" });
  });

  it("a flight that lands mid-watch on a make → LANDED_CAPTURE terminal, polling stops", () => {
    // Regression: with the watch still OK and flightLanded=true, pollMinutes() returned the in-window
    // cadence (2 min) forever — the watch never sealed. Landing must terminate: terminal=true →
    // nextPollMinutes=null → the row drops out of watches_due. U9 backfills the actual separately.
    const plan = planReconcile(
      baseWatch({ state: "OK" }),
      fresh({ status: "landed", actualUtc: "2026-06-05T17:00:00Z", predictedUtc: "2026-06-05T17:00:00Z", revision: "rLANDED" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("LANDED_CAPTURE");
    expect(plan.terminal).toBe(true);
    expect(plan.nextPollMinutes).toBeNull();
    expect(plan.fired).toBeNull();
    expect(plan.snapshot).toMatchObject({ resultingState: "LANDED_CAPTURE", verdict: "make", firedTransition: null });
  });

  it("a flight that lands INTO a miss still seals (no endless MISS_PREDICTED polling, no late CATCH)", () => {
    // predicted 19:15 → projected 20:20 → slack -20 (a miss), but the aircraft is on the ground: seal,
    // do not fire a touchdown-time CATCH. Without the landing rule this stays MISS_PREDICTED and re-polls.
    const plan = planReconcile(
      baseWatch({ state: "AT_RISK" }),
      fresh({ status: "landed", actualUtc: "2026-06-05T19:15:00Z", predictedUtc: "2026-06-05T19:15:00Z", revision: "rLM" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("LANDED_CAPTURE");
    expect(plan.terminal).toBe(true);
    expect(plan.nextPollMinutes).toBeNull();
    expect(plan.fired).toBeNull();
  });
});

describe("planReconcile: degraded / honest-failure (AE8, R18)", () => {
  it("feed unavailable past the staleness ceiling → DEGRADED, indeterminate snapshot", () => {
    const plan = planReconcile(baseWatch({ lastFetchedAt: "2026-06-05T16:00:00.000Z" }), unavailable, NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("DEGRADED");
    expect(plan.fired).toMatchObject({ kind: "CANNOT_CONFIRM" });
    expect(plan.snapshot).toMatchObject({ verdict: "indeterminate", predictedArrivalUtc: null });
    expect(plan.revision.startsWith("stale:")).toBe(true);
  });

  it("stale feed AND commitment time passed → stays DEGRADED, never a false DEFINITE_MISS", () => {
    const plan = planReconcile(
      baseWatch({ lastFetchedAt: "2026-06-05T19:00:00.000Z" }),
      unavailable,
      "2026-06-05T20:05:00.000Z",
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("DEGRADED");
  });

  it("fresh feed but no predicted/scheduled time → indeterminate → DEGRADED", () => {
    const plan = planReconcile(
      baseWatch(),
      fresh({ predictedUtc: null, scheduledUtc: null, status: "scheduled" }),
      NOW,
    );
    expect(plan).toMatchObject({ kind: "apply", state: "DEGRADED" });
  });

  it("feed unavailable but within the staleness ceiling → skip and retry soon (no premature degrade)", () => {
    const plan = planReconcile(baseWatch({ lastFetchedAt: "2026-06-05T16:55:00.000Z" }), unavailable, NOW);
    expect(plan.kind).toBe("skip");
    if (plan.kind !== "skip") return;
    expect(plan.reason).toBe("awaiting_retry");
    expect(plan.nextPollMinutes).toBeGreaterThan(0);
  });
});

describe("planReconcile: idempotency + scheduling", () => {
  it("an unchanged revision is a no-op skip (replayed/duplicate tick appends nothing)", () => {
    const plan = planReconcile(baseWatch({ revision: "rSAME" }), fresh({ revision: "rSAME" }), NOW);
    expect(plan).toMatchObject({ kind: "skip", reason: "unchanged" });
  });

  it("a terminal watch is skipped without polling", () => {
    const plan = planReconcile(baseWatch({ terminal: true }), fresh(), NOW);
    expect(plan).toMatchObject({ kind: "skip", reason: "terminal", nextPollMinutes: null });
  });

  it("a watch nearer its commitment polls more frequently than a far-off one", () => {
    const near = planReconcile(baseWatch(), fresh(), NOW); // 3h out
    const far = planReconcile(
      baseWatch({ commitmentInstantUtc: "2026-06-09T20:00:00.000Z" }),
      fresh(),
      NOW,
    );
    expect(near.kind).toBe("apply");
    expect(far.kind).toBe("apply");
    if (near.kind !== "apply" || far.kind !== "apply") return;
    expect(near.nextPollMinutes).not.toBeNull();
    expect(far.nextPollMinutes).not.toBeNull();
    expect(near.nextPollMinutes as number).toBeLessThan(far.nextPollMinutes as number);
  });

  it("a freshly-armed watch (null last-fetch) treats the first unavailable poll as transient, not stale", () => {
    // Regression: null last_fetched_at must NOT read as infinitely stale, or a brand-new watch fires
    // a spurious CANNOT_CONFIRM on its very first transient fetch failure.
    const plan = planReconcile(baseWatch({ lastFetchedAt: null }), unavailable, NOW);
    expect(plan).toMatchObject({ kind: "skip", reason: "awaiting_retry" });
  });
});

describe("planReconcile: re-fire + degraded re-entry (transition-string enrichment)", () => {
  it("RECOVERED re-crossing into a miss fires a fresh CATCH with lead enrichment", () => {
    const plan = planReconcile(baseWatch({ state: "RECOVERED" }), fresh({ predictedUtc: "2026-06-05T19:15:00Z" }), NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("MISS_PREDICTED");
    expect(plan.fired).toEqual({
      transition: "RECOVERED->MISS_PREDICTED",
      kind: "CATCH",
      leadTimeMinutes: 150,
      usefulLead: true,
    });
  });

  it("a fresh miss out of DEGRADED fires CATCH (degraded re-enters at the fresh verdict)", () => {
    const plan = planReconcile(baseWatch({ state: "DEGRADED" }), fresh({ predictedUtc: "2026-06-05T19:15:00Z" }), NOW);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.state).toBe("MISS_PREDICTED");
    expect(plan.fired).toMatchObject({ transition: "DEGRADED->MISS_PREDICTED", kind: "CATCH" });
  });

  it.each(["OK", "MISS_PREDICTED", "RECOVERED"] as const)(
    "cancellation from %s → terminal CANCELLED catch (transition string built per source state)",
    (state) => {
      const plan = planReconcile(baseWatch({ state }), fresh({ status: "cancelled", revision: `rC-${state}` }), NOW);
      expect(plan.kind).toBe("apply");
      if (plan.kind !== "apply") return;
      expect(plan.state).toBe("CANCELLED");
      expect(plan.terminal).toBe(true);
      expect(plan.fired).toMatchObject({ transition: `${state}->CANCELLED`, kind: "CANCELLED" });
    },
  );
});

describe("planReconcile: dwell reset + lead boundary + snapshot fields", () => {
  it("a make that falls back below the recovery band resets the dwell counter to 0", () => {
    // predicted 18:50 → projected 19:55 → slack 5 (< recovery band 10): a make, but not recovering.
    const plan = planReconcile(
      baseWatch({ state: "MISS_PREDICTED", recoveryProgress: 1 }),
      fresh({ predictedUtc: "2026-06-05T18:50:00Z" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan).toMatchObject({ state: "MISS_PREDICTED", recoveryProgress: 0, fired: null });
  });

  it("a CATCH with lead exactly at the usable threshold (30) counts as useful (>= boundary)", () => {
    // now 19:00, mustLeave 19:30 → lead exactly 30.
    const plan = planReconcile(
      baseWatch({ state: "AT_RISK" }),
      fresh({ predictedUtc: "2026-06-05T19:15:00Z" }),
      "2026-06-05T19:00:00.000Z",
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.fired).toMatchObject({ kind: "CATCH", leadTimeMinutes: 30, usefulLead: true });
  });

  it("the appended snapshot records the deficit and the fired kind for a CATCH", () => {
    const plan = planReconcile(
      baseWatch({ state: "AT_RISK" }),
      fresh({ predictedUtc: "2026-06-05T19:15:00Z", revision: "rSnap" }),
      NOW,
    );
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.snapshot).toMatchObject({
      verdict: "miss",
      slackMinutes: -20,
      resultingState: "MISS_PREDICTED",
      firedTransition: "CATCH",
      revision: "rSnap",
    });
  });
});

describe("planReconcile: DST round-trip (reconstructCommitment stability)", () => {
  // 01:30 local on the US fall-back fold (clocks go 02:00 EDT -> 01:00 EST). EDT = UTC-4 → 05:30Z.
  const dstWatch = (over: Partial<WatchRow> = {}): WatchRow =>
    baseWatch({
      commitmentInstantUtc: "2026-11-01T05:30:00.000Z",
      commitmentZone: "America/New_York",
      lastFetchedAt: "2026-11-01T01:30:00.000Z",
      ...over,
    });
  const dstNow = "2026-11-01T02:00:00.000Z";

  it("an instant in the fall-back fold rebuilds the exact deadline (no DST hour shift)", () => {
    // predicted 04:00Z → projected 05:05Z; deadline 05:30Z → slack 25. A +1h reconstruction bug → 85.
    const plan = planReconcile(dstWatch(), fresh({ predictedUtc: "2026-11-01T04:00:00Z", revision: "rDST" }), dstNow);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.snapshot.slackMinutes).toBe(25);
    expect(plan.snapshot.verdict).toBe("make");
  });

  it("one minute past the fold deadline is a miss, not a make (would flip under a +1h shift)", () => {
    // predicted 04:26Z → projected 05:31Z → 1 min past the 05:30Z deadline.
    const plan = planReconcile(dstWatch({ state: "AT_RISK" }), fresh({ predictedUtc: "2026-11-01T04:26:00Z", revision: "rDST2" }), dstNow);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    expect(plan.snapshot.verdict).toBe("miss");
  });
});
