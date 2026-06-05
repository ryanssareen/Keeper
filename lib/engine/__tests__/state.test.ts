import { describe, it, expect } from "vitest";
import { step, type StateInput } from "@/lib/engine/state";

// Default: an OK watch with a comfortable make verdict.
const inp = (over: Partial<StateInput> = {}): StateInput => ({
  current: "OK",
  verdict: "make",
  slackMinutes: 90,
  flightStatus: "active",
  flightLanded: false,
  feedStale: false,
  commitmentPassed: false,
  recoveryProgress: 0,
  ...over,
});

describe("state machine: make-side transitions", () => {
  it("OK stays OK on a comfortable make", () => {
    expect(step(inp())).toMatchObject({ next: "OK", fired: null });
  });
  it("OK -> AT_RISK when slack is tight (no catch)", () => {
    expect(step(inp({ slackMinutes: 10 }))).toMatchObject({ next: "AT_RISK", fired: null });
  });
  it("AT_RISK -> OK when slack eases", () => {
    expect(step(inp({ current: "AT_RISK", slackMinutes: 90 }))).toMatchObject({ next: "OK", fired: null });
  });
});

describe("state machine: miss-side + anti-flap", () => {
  it("AT_RISK -> MISS_PREDICTED fires CATCH past the anti-flap deficit", () => {
    expect(step(inp({ current: "AT_RISK", verdict: "miss", slackMinutes: -15 }))).toMatchObject({
      next: "MISS_PREDICTED",
      fired: "CATCH",
    });
  });
  it("borderline miss within the anti-flap band holds at AT_RISK (no catch)", () => {
    expect(step(inp({ verdict: "miss", slackMinutes: -5 }))).toMatchObject({ next: "AT_RISK", fired: null });
  });
  it("MISS_PREDICTED does not re-fire while still missing", () => {
    expect(step(inp({ current: "MISS_PREDICTED", verdict: "miss", slackMinutes: -30 }))).toMatchObject({
      next: "MISS_PREDICTED",
      fired: null,
    });
  });
});

describe("state machine: recovery dwell", () => {
  it("recovery fires ALL_CLEAR only once the dwell is met", () => {
    expect(step(inp({ current: "MISS_PREDICTED", slackMinutes: 15, recoveryProgress: 1 }))).toMatchObject({
      next: "RECOVERED",
      fired: "ALL_CLEAR",
      recoveryProgress: 2,
    });
  });
  it("recovery builds dwell without firing when not yet sustained", () => {
    expect(step(inp({ current: "MISS_PREDICTED", slackMinutes: 15, recoveryProgress: 0 }))).toMatchObject({
      next: "MISS_PREDICTED",
      fired: null,
      recoveryProgress: 1,
    });
  });
  it("RECOVERED -> MISS_PREDICTED fires a fresh CATCH on a re-cross", () => {
    expect(step(inp({ current: "RECOVERED", verdict: "miss", slackMinutes: -20 }))).toMatchObject({
      next: "MISS_PREDICTED",
      fired: "CATCH",
    });
  });
});

describe("state machine: global cancel + stale (degraded never asserts a miss)", () => {
  it("cancellation from a live state is terminal and fires once", () => {
    expect(step(inp({ flightStatus: "cancelled" }))).toMatchObject({ next: "CANCELLED", fired: "CANCELLED" });
  });
  it("CANCELLED is sticky and silent", () => {
    expect(step(inp({ current: "CANCELLED", flightStatus: "cancelled" }))).toMatchObject({ next: "CANCELLED", fired: null });
  });
  it("a stale feed degrades and fires CANNOT_CONFIRM once", () => {
    expect(step(inp({ feedStale: true }))).toMatchObject({ next: "DEGRADED", fired: "CANNOT_CONFIRM" });
  });
  it("DEGRADED stays silent while still stale", () => {
    expect(step(inp({ current: "DEGRADED", feedStale: true }))).toMatchObject({ next: "DEGRADED", fired: null });
  });
  it("a stale feed past the commitment time does NOT assert a definite miss", () => {
    const out = step(inp({ feedStale: true, commitmentPassed: true, flightLanded: false }));
    expect(out.next).toBe("DEGRADED");
    expect(out.next).not.toBe("DEFINITE_MISS");
  });
  it("DEGRADED re-enters at a fresh miss and fires CATCH", () => {
    expect(step(inp({ current: "DEGRADED", verdict: "miss", slackMinutes: -20 }))).toMatchObject({
      next: "MISS_PREDICTED",
      fired: "CATCH",
    });
  });
  it("DEGRADED re-enters at a fresh comfortable make", () => {
    expect(step(inp({ current: "DEGRADED", verdict: "make", slackMinutes: 90 }))).toMatchObject({ next: "OK", fired: null });
  });
});

describe("state machine: en-route definite miss + indeterminate + terminal", () => {
  it("commitment passed while still en route is a definite miss", () => {
    expect(step(inp({ commitmentPassed: true, flightLanded: false, verdict: "miss", slackMinutes: -30 }))).toMatchObject({
      next: "DEFINITE_MISS",
      fired: "DEFINITE_MISS",
    });
  });
  it("commitment passed AFTER landing on a make seals to LANDED_CAPTURE, not a definite miss", () => {
    const out = step(inp({ commitmentPassed: true, flightLanded: true, verdict: "make", slackMinutes: 90 }));
    expect(out).toMatchObject({ next: "LANDED_CAPTURE", fired: null });
    expect(out.next).not.toBe("DEFINITE_MISS");
  });
  it("an indeterminate verdict degrades (can't confirm)", () => {
    expect(step(inp({ verdict: "indeterminate", slackMinutes: null }))).toMatchObject({
      next: "DEGRADED",
      fired: "CANNOT_CONFIRM",
    });
  });
  it("LANDED_CAPTURE is terminal and silent", () => {
    expect(step(inp({ current: "LANDED_CAPTURE" }))).toMatchObject({ next: "LANDED_CAPTURE", fired: null });
  });
});

describe("state machine: landing seals (terminal outcome capture)", () => {
  // A flight that lands DURING an active watch must reach a terminal state, or reconcile keeps
  // re-selecting it on the in-window cadence forever (the flightLanded poll-cadence trap).
  it("a make watch that lands mid-flight seals to LANDED_CAPTURE without firing", () => {
    expect(step(inp({ current: "OK", flightLanded: true, verdict: "make", slackMinutes: 90 }))).toMatchObject({
      next: "LANDED_CAPTURE",
      fired: null,
      recoveryProgress: 0,
    });
  });
  it("landing seals from AT_RISK too (still no fire at touchdown)", () => {
    expect(step(inp({ current: "AT_RISK", flightLanded: true, verdict: "make", slackMinutes: 5 }))).toMatchObject({
      next: "LANDED_CAPTURE",
      fired: null,
    });
  });
  it("a flight that lands INTO a miss still seals — no late CATCH at touchdown", () => {
    // Landing wins over the miss rules: the outcome is sealed, and an actionable catch (if any) fired
    // earlier while en route. Without the landing rule this returns MISS_PREDICTED and polls forever.
    expect(step(inp({ current: "AT_RISK", flightLanded: true, verdict: "miss", slackMinutes: -30 }))).toMatchObject({
      next: "LANDED_CAPTURE",
      fired: null,
    });
  });
  it("landing wins over cancellation? No — a cancelled status still terminates as CANCELLED", () => {
    // Defensive ordering: rule 1 (cancel) precedes rule 2 (landed). A cancelled flight never landed.
    expect(step(inp({ flightStatus: "cancelled", flightLanded: true }))).toMatchObject({ next: "CANCELLED" });
  });
  it("landing precedes the indeterminate rule — a landed flight with no prediction seals, not degrades", () => {
    expect(step(inp({ flightLanded: true, verdict: "indeterminate", slackMinutes: null }))).toMatchObject({
      next: "LANDED_CAPTURE",
      fired: null,
    });
  });
});
