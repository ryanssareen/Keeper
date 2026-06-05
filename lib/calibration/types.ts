/**
 * Calibration corpus shapes + sole-writer and metrics signatures. Frozen in Step 2.
 * The corpus is the moat: append-only snapshots, honest NULLs, denominator-bound rates.
 */
import type { FiredKind, Verdict, WatchState } from "@/lib/engine/types";

/** Appended once per reconcile. Never overwritten (idempotent on watchId+revision). */
export interface PredictionSnapshot {
  watchId: string;
  fetchedAt: string; // UTC ISO
  predictedArrivalUtc: string | null;
  transitMinutesUsed: number;
  egressMinutesUsed: number;
  marginMinutesUsed: number;
  slackMinutes: number | null;
  verdict: Verdict;
  resultingState: WatchState;
  revision: string;
  firedTransition: FiredKind | null;
}

export type SelfReportStatus = "pending" | "answered" | "dismissed" | "expired" | "no_channel";
export type Outcome = "made" | "missed" | "changed";
export type EnrichmentState = "armed" | "awaiting_actual" | "awaiting_self_report" | "sealed";
export type DeliveryStatus = "attempting" | "sent" | "failed" | "no_device";

/**
 * The outbox row inserted on a firing transition. The (watchId, transition, revision) tuple is the
 * dedup identity — the unique insert authorizes exactly one downstream push (transactional outbox).
 * lead/useful are populated for a CATCH and null for non-lead-bearing kinds (ALL_CLEAR, CANNOT_CONFIRM…).
 */
export interface FiredTransitionRecord {
  watchId: string;
  transition: string; // "<fromState>-><toState>"
  revision: string;
  kind: FiredKind;
  leadTimeMinutes: number | null;
  usefulLead: boolean | null;
}

/** One outcome row per watch. outcome/wasUseful are null unless selfReportStatus === "answered". */
export interface CalibrationRow {
  watchId: string;
  actualArrivalUtc: string | null;
  divertedToAirport: string | null;
  selfReportStatus: SelfReportStatus;
  outcome: Outcome | null;
  wasUseful: boolean | null;
  enrichmentState: EnrichmentState;
}

/** A rate reported with its denominator — never a bare percentage (STRATEGY metric discipline). */
export interface RateWithDenominator {
  numerator: number;
  denominator: number;
}

/** The four strategy metrics (U10). */
export interface Metrics {
  thesisExercisingTrips: number;
  cascadeAlertUsefulness: RateWithDenominator;
  firstUsefulCatchRate: RateWithDenominator;
  predictionAccuracy: {
    /** Predicted vs actual arrival instant — independent of the model's own assumptions. */
    flightPrediction: RateWithDenominator;
    /** Predicted verdict vs self-reported made/missed — only over answered rows. */
    outcome: RateWithDenominator;
    /** Verdicts excluded because they were indeterminate. */
    indeterminateExcluded: number;
  };
}

/** Frozen sole-writer surface (U9) — every corpus write goes through this; no ad-hoc SQL elsewhere. */
export interface CalibrationWriter {
  appendSnapshot(snap: PredictionSnapshot): Promise<void>;
  recordFiredTransition(rec: FiredTransitionRecord): Promise<void>;
  recordDelivery(
    watchId: string,
    transition: string,
    revision: string,
    status: DeliveryStatus,
  ): Promise<void>;
  backfillActual(watchId: string, actualUtc: string, arrivalAirport: string): Promise<void>;
  recordSelfReport(watchId: string, outcome: Outcome, wasUseful: boolean): Promise<void>;
}

/** Frozen metrics signature (U10). */
export type ComputeMetrics = () => Promise<Metrics>;
