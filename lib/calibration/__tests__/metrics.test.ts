import { describe, it, expect } from "vitest";
import { computeMetricsFromInput, type MetricsInput } from "@/lib/calibration/metrics";

/**
 * Metric-definition pins (U10). The whole point of the metrics is honest denominators, so the tests
 * assert the {numerator, denominator} shape and the low-n / exclusion edges — not just a percentage.
 * All fixtures are inline; no DB is touched (computeMetrics() is the thin, untested live path).
 */

const empty: MetricsInput = { watches: [], catches: [], outcomes: [] };

const baseInput = (over: Partial<MetricsInput> = {}): MetricsInput => ({ ...empty, ...over });

describe("computeMetricsFromInput — cascadeAlertUsefulness", () => {
  it("returns an object with numerator AND denominator (a rate is never a bare percentage)", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: false },
          { watchId: "w2", kind: "CATCH", firedAtUtc: "2026-06-20T11:00:00Z", deliveryStatus: "sent", usefulLead: false, wasUseful: false },
        ],
      }),
    );
    expect(m.cascadeAlertUsefulness).toEqual({ numerator: 1, denominator: 2 });
  });

  it("counts a catch via wasUseful even when usefulLead is false", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: false, wasUseful: true },
        ],
      }),
    );
    expect(m.cascadeAlertUsefulness).toEqual({ numerator: 1, denominator: 1 });
  });

  it("excludes non-CATCH kinds (ALL_CLEAR / CANNOT_CONFIRM) from numerator and denominator", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: true },
          { watchId: "w2", kind: "ALL_CLEAR", firedAtUtc: "2026-06-20T11:00:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: true },
          { watchId: "w3", kind: "CANNOT_CONFIRM", firedAtUtc: "2026-06-20T12:00:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: true },
        ],
      }),
    );
    expect(m.cascadeAlertUsefulness).toEqual({ numerator: 1, denominator: 1 });
  });

  it("zero CATCH events -> denominator === 0 (low-n, not a 0% rate)", () => {
    const m = computeMetricsFromInput(empty);
    expect(m.cascadeAlertUsefulness.denominator).toBe(0);
    expect(m.cascadeAlertUsefulness.numerator).toBe(0);
  });
});

describe("computeMetricsFromInput — firstUsefulCatchRate", () => {
  it("a usefulLead catch with deliveryStatus 'no_device' is NOT counted in first-useful (but is in the denominator)", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "no_device", usefulLead: true, wasUseful: false },
        ],
      }),
    );
    // Fired a CATCH (denominator 1) but it never reached a device, so it is not a useful catch.
    expect(m.firstUsefulCatchRate).toEqual({ numerator: 0, denominator: 1 });
  });

  it("requires BOTH delivery sent AND usefulLead; a sent-but-no-lead catch counts only in the denominator", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: false, wasUseful: true },
          { watchId: "w2", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: false },
        ],
      }),
    );
    expect(m.firstUsefulCatchRate).toEqual({ numerator: 1, denominator: 2 });
  });

  it("dedupes per watch — multiple CATCH rows on one watch count once in each side", () => {
    const m = computeMetricsFromInput(
      baseInput({
        catches: [
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:00:00Z", deliveryStatus: "sent", usefulLead: false, wasUseful: false },
          { watchId: "w1", kind: "CATCH", firedAtUtc: "2026-06-20T10:30:00Z", deliveryStatus: "sent", usefulLead: true, wasUseful: false },
        ],
      }),
    );
    expect(m.firstUsefulCatchRate).toEqual({ numerator: 1, denominator: 1 });
  });
});

describe("computeMetricsFromInput — thesisExercisingTrips", () => {
  it("a watch with hasCommitmentTime true but placeResolved false is NOT thesis-exercising", () => {
    const m = computeMetricsFromInput(
      baseInput({
        watches: [
          { watchId: "w1", placeResolved: false, hasCommitmentTime: true },
          { watchId: "w2", placeResolved: true, hasCommitmentTime: false },
          { watchId: "w3", placeResolved: true, hasCommitmentTime: true },
        ],
      }),
    );
    expect(m.thesisExercisingTrips).toBe(1);
  });
});

describe("computeMetricsFromInput — predictionAccuracy.flightPrediction", () => {
  it("correct within 15 minutes, incorrect beyond; only rows with both instants are gradable", () => {
    const m = computeMetricsFromInput(
      baseInput({
        outcomes: [
          // exactly 15m late -> correct (boundary inclusive)
          { watchId: "w1", verdict: "make", selfReportAnswered: false, selfReportOutcome: null, predictedArrivalUtc: "2026-06-20T10:00:00Z", actualArrivalUtc: "2026-06-20T10:15:00Z" },
          // 16m early -> incorrect
          { watchId: "w2", verdict: "make", selfReportAnswered: false, selfReportOutcome: null, predictedArrivalUtc: "2026-06-20T10:00:00Z", actualArrivalUtc: "2026-06-20T09:44:00Z" },
          // missing actual -> not gradable, excluded from denominator
          { watchId: "w3", verdict: "make", selfReportAnswered: false, selfReportOutcome: null, predictedArrivalUtc: "2026-06-20T10:00:00Z", actualArrivalUtc: null },
        ],
      }),
    );
    expect(m.predictionAccuracy.flightPrediction).toEqual({ numerator: 1, denominator: 2 });
  });

  it("zero gradable rows -> denominator 0 (low-n, not 0%)", () => {
    const m = computeMetricsFromInput(empty);
    expect(m.predictionAccuracy.flightPrediction).toEqual({ numerator: 0, denominator: 0 });
  });
});

describe("computeMetricsFromInput — predictionAccuracy.outcome + indeterminateExcluded", () => {
  it("an 'indeterminate' verdict is excluded from outcome accuracy and counted in indeterminateExcluded", () => {
    const m = computeMetricsFromInput(
      baseInput({
        outcomes: [
          { watchId: "w1", verdict: "indeterminate", selfReportAnswered: true, selfReportOutcome: "made", predictedArrivalUtc: null, actualArrivalUtc: null },
        ],
      }),
    );
    expect(m.predictionAccuracy.outcome).toEqual({ numerator: 0, denominator: 0 });
    expect(m.predictionAccuracy.indeterminateExcluded).toBe(1);
  });

  it("grades verdict against the self-report: miss<->missed and make<->made are correct, mismatches are not", () => {
    const m = computeMetricsFromInput(
      baseInput({
        outcomes: [
          // predicted miss, traveler missed -> correct
          { watchId: "w1", verdict: "miss", selfReportAnswered: true, selfReportOutcome: "missed", predictedArrivalUtc: null, actualArrivalUtc: null },
          // predicted make, traveler made -> correct
          { watchId: "w2", verdict: "make", selfReportAnswered: true, selfReportOutcome: "made", predictedArrivalUtc: null, actualArrivalUtc: null },
          // predicted make, traveler missed -> incorrect
          { watchId: "w3", verdict: "make", selfReportAnswered: true, selfReportOutcome: "missed", predictedArrivalUtc: null, actualArrivalUtc: null },
          // not answered -> excluded from denominator entirely
          { watchId: "w4", verdict: "miss", selfReportAnswered: false, selfReportOutcome: null, predictedArrivalUtc: null, actualArrivalUtc: null },
        ],
      }),
    );
    expect(m.predictionAccuracy.outcome).toEqual({ numerator: 2, denominator: 3 });
    expect(m.predictionAccuracy.indeterminateExcluded).toBe(0);
  });

  it("a 'changed' self-report is graded as not-missed (so a make verdict is correct)", () => {
    const m = computeMetricsFromInput(
      baseInput({
        outcomes: [
          { watchId: "w1", verdict: "make", selfReportAnswered: true, selfReportOutcome: "changed", predictedArrivalUtc: null, actualArrivalUtc: null },
          { watchId: "w2", verdict: "miss", selfReportAnswered: true, selfReportOutcome: "changed", predictedArrivalUtc: null, actualArrivalUtc: null },
        ],
      }),
    );
    // make vs changed -> correct (changed !== missed); miss vs changed -> incorrect.
    expect(m.predictionAccuracy.outcome).toEqual({ numerator: 1, denominator: 2 });
  });
});

describe("computeMetricsFromInput — empty corpus", () => {
  it("returns an all-zero, fully-shaped Metrics object", () => {
    expect(computeMetricsFromInput(empty)).toEqual({
      thesisExercisingTrips: 0,
      cascadeAlertUsefulness: { numerator: 0, denominator: 0 },
      firstUsefulCatchRate: { numerator: 0, denominator: 0 },
      predictionAccuracy: {
        flightPrediction: { numerator: 0, denominator: 0 },
        outcome: { numerator: 0, denominator: 0 },
        indeterminateExcluded: 0,
      },
    });
  });
});
