import { describe, it, expect } from "vitest";
import { buildWatchView } from "@/lib/calibration/dashboard";
import type {
  CatchHistoryEntry,
  WatchViewRow,
} from "@/lib/calibration/dashboard";
import type { CalibrationRow, PredictionSnapshot } from "@/lib/calibration/types";

/**
 * Pure view-model tests for the U10 dashboard. The builder owns every field mapping and ordering
 * decision; these lock the lifecycle shaping (state/place/timeline/catch-history/outcome) without a
 * database. Metric semantics live in metrics.ts and are not re-asserted here.
 */

const baseWatch: WatchViewRow = {
  id: "w-1",
  state: "AT_RISK",
  placeLabel: "Trafalgar Square, London",
  commitmentZone: "Europe/London",
  commitmentInstantUtc: "2026-12-20T20:00:00.000Z",
  transitMinutes: 30,
  transitSource: "osrm",
  reschedulable: true,
  flightNumber: "EK1",
  arrivalAirport: "LHR",
  placeResolved: true,
  lastFetchedAt: "2026-12-20T17:55:00.000Z",
};

const snap = (over: Partial<PredictionSnapshot> = {}): PredictionSnapshot => ({
  watchId: "w-1",
  fetchedAt: "2026-12-20T17:00:00.000Z",
  predictedArrivalUtc: "2026-12-20T18:30:00.000Z",
  transitMinutesUsed: 30,
  egressMinutesUsed: 35,
  marginMinutesUsed: 0,
  slackMinutes: 25,
  verdict: "make",
  resultingState: "OK",
  revision: "r1",
  firedTransition: null,
  ...over,
});

const fired = (over: Partial<CatchHistoryEntry> = {}): CatchHistoryEntry => ({
  kind: "CATCH",
  transition: "AT_RISK->MISS_PREDICTED",
  deliveryStatus: "sent",
  leadTimeMinutes: 45,
  usefulLead: true,
  firedAt: "2026-12-20T17:10:00.000Z",
  revision: "r2",
  ...over,
});

const calibration = (over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  watchId: "w-1",
  actualArrivalUtc: null,
  divertedToAirport: null,
  selfReportStatus: "pending",
  outcome: null,
  wasUseful: null,
  enrichmentState: "armed",
  ...over,
});

describe("buildWatchView — core mapping", () => {
  it("maps the watch header fields (state, place, zone, transit, flight)", () => {
    const view = buildWatchView(baseWatch, [], [], null);

    expect(view.id).toBe("w-1");
    expect(view.state).toBe("AT_RISK");
    expect(view.placeLabel).toBe("Trafalgar Square, London");
    expect(view.zone).toBe("Europe/London");
    expect(view.commitmentInstantUtc).toBe("2026-12-20T20:00:00.000Z");
    expect(view.transitMinutes).toBe(30);
    expect(view.transitSource).toBe("osrm");
    expect(view.reschedulable).toBe(true);
    expect(view.flightNumber).toBe("EK1");
    expect(view.arrivalAirport).toBe("LHR");
    expect(view.placeResolved).toBe(true);
    expect(view.lastFetchedAt).toBe("2026-12-20T17:55:00.000Z");
  });

  it("maps each snapshot into a timeline entry (verdict/slack/fetchedAt/state/firing)", () => {
    const view = buildWatchView(
      baseWatch,
      [snap({ verdict: "miss", slackMinutes: -12, resultingState: "MISS_PREDICTED", firedTransition: "CATCH" })],
      [],
      null,
    );

    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toEqual({
      fetchedAt: "2026-12-20T17:00:00.000Z",
      verdict: "miss",
      slackMinutes: -12,
      predictedArrivalUtc: "2026-12-20T18:30:00.000Z",
      resultingState: "MISS_PREDICTED",
      firedTransition: "CATCH",
      revision: "r1",
    });
  });

  it("maps each fired transition into a catch-history entry (delivery status + lead)", () => {
    const view = buildWatchView(baseWatch, [], [fired()], null);

    expect(view.catchHistory).toHaveLength(1);
    expect(view.catchHistory[0]).toEqual({
      kind: "CATCH",
      transition: "AT_RISK->MISS_PREDICTED",
      deliveryStatus: "sent",
      leadTimeMinutes: 45,
      usefulLead: true,
      firedAt: "2026-12-20T17:10:00.000Z",
      revision: "r2",
    });
  });

  it("preserves an indeterminate snapshot with null slack and null predicted arrival", () => {
    const view = buildWatchView(
      baseWatch,
      [snap({ verdict: "indeterminate", slackMinutes: null, predictedArrivalUtc: null, resultingState: "DEGRADED" })],
      [],
      null,
    );

    expect(view.timeline[0].verdict).toBe("indeterminate");
    expect(view.timeline[0].slackMinutes).toBeNull();
    expect(view.timeline[0].predictedArrivalUtc).toBeNull();
  });
});

describe("buildWatchView — empty / sparse history", () => {
  it("renders an empty catch history and empty timeline when nothing has fired", () => {
    const view = buildWatchView(baseWatch, [], [], calibration());

    expect(view.catchHistory).toEqual([]);
    expect(view.timeline).toEqual([]);
  });

  it("returns a null outcome when there is no calibration row (armed before enrichment)", () => {
    const view = buildWatchView(baseWatch, [snap()], [fired()], null);

    expect(view.outcome).toBeNull();
  });
});

describe("buildWatchView — ordering (newest first, query-order independent)", () => {
  it("sorts the timeline newest-first regardless of input order", () => {
    const older = snap({ fetchedAt: "2026-12-20T17:00:00.000Z", revision: "old" });
    const newer = snap({ fetchedAt: "2026-12-20T17:30:00.000Z", revision: "new" });

    const view = buildWatchView(baseWatch, [older, newer], [], null);

    expect(view.timeline.map((t) => t.revision)).toEqual(["new", "old"]);
  });

  it("sorts the catch history newest-first and sinks an unknown firing time last", () => {
    const a = fired({ firedAt: "2026-12-20T17:00:00.000Z", revision: "a" });
    const b = fired({ firedAt: "2026-12-20T18:00:00.000Z", revision: "b" });
    const noTime = fired({ firedAt: null, revision: "pending" });

    const view = buildWatchView(baseWatch, [], [a, noTime, b], null);

    expect(view.catchHistory.map((c) => c.revision)).toEqual(["b", "a", "pending"]);
  });
});

describe("buildWatchView — outcome (sealed vs pending)", () => {
  it("marks the outcome sealed and surfaces the self-report when enrichment is sealed", () => {
    const view = buildWatchView(
      baseWatch,
      [],
      [],
      calibration({
        enrichmentState: "sealed",
        selfReportStatus: "answered",
        outcome: "made",
        wasUseful: true,
        actualArrivalUtc: "2026-12-20T18:25:00.000Z",
      }),
    );

    expect(view.outcome).not.toBeNull();
    expect(view.outcome?.sealed).toBe(true);
    expect(view.outcome?.selfReportStatus).toBe("answered");
    expect(view.outcome?.outcome).toBe("made");
    expect(view.outcome?.wasUseful).toBe(true);
    expect(view.outcome?.actualArrivalUtc).toBe("2026-12-20T18:25:00.000Z");
  });

  it("marks the outcome NOT sealed while still pending, with a null outcome", () => {
    const view = buildWatchView(
      baseWatch,
      [],
      [],
      calibration({ enrichmentState: "awaiting_self_report", selfReportStatus: "pending" }),
    );

    expect(view.outcome?.sealed).toBe(false);
    expect(view.outcome?.outcome).toBeNull();
    expect(view.outcome?.selfReportStatus).toBe("pending");
  });

  it("surfaces a diversion airport on the outcome strip", () => {
    const view = buildWatchView(
      baseWatch,
      [],
      [],
      calibration({ enrichmentState: "sealed", divertedToAirport: "LGW" }),
    );

    expect(view.outcome?.divertedToAirport).toBe("LGW");
  });
});

describe("buildWatchView — non-CATCH firings and degraded states", () => {
  it("keeps non-lead-bearing firings (ALL_CLEAR, CANNOT_CONFIRM) with null lead", () => {
    const view = buildWatchView(
      baseWatch,
      [],
      [
        fired({ kind: "ALL_CLEAR", transition: "MISS_PREDICTED->RECOVERED", leadTimeMinutes: null, usefulLead: null }),
        fired({ kind: "CANNOT_CONFIRM", transition: "OK->DEGRADED", leadTimeMinutes: null, usefulLead: null, firedAt: "2026-12-20T16:00:00.000Z" }),
      ],
      null,
    );

    const kinds = view.catchHistory.map((c) => c.kind);
    expect(kinds).toContain("ALL_CLEAR");
    expect(kinds).toContain("CANNOT_CONFIRM");
    expect(view.catchHistory.every((c) => (c.kind === "CATCH" ? true : c.leadTimeMinutes === null))).toBe(true);
  });

  it("carries a failed / no_device delivery status through unchanged (reliability backstop)", () => {
    const view = buildWatchView(
      baseWatch,
      [],
      [fired({ deliveryStatus: "no_device" }), fired({ deliveryStatus: "failed", revision: "r3", firedAt: "2026-12-20T16:30:00.000Z" })],
      null,
    );

    const statuses = view.catchHistory.map((c) => c.deliveryStatus);
    expect(statuses).toContain("no_device");
    expect(statuses).toContain("failed");
  });
});
