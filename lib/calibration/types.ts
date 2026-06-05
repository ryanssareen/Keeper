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

// Each union below is derived from its `as const` array so the array can serve as the single source
// of truth — reused by the dashboard's DB-boundary `narrow` so the runtime membership check and the
// compile-time type can never drift apart.
export const SELF_REPORT_STATUSES = ["pending", "answered", "dismissed", "expired", "no_channel"] as const;
export type SelfReportStatus = (typeof SELF_REPORT_STATUSES)[number];
export const OUTCOMES = ["made", "missed", "changed"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const ENRICHMENT_STATES = ["armed", "awaiting_actual", "awaiting_self_report", "sealed"] as const;
export type EnrichmentState = (typeof ENRICHMENT_STATES)[number];
/**
 * Delivery lifecycle of a fired-transition outbox row.
 * `sending` is the in-flight lease a dispatcher tick holds while calling web-push: a row is claimed
 * into `sending` atomically (FOR UPDATE SKIP LOCKED) so overlapping ticks never double-send, then
 * settled to a terminal status — or returned to `attempting` on a transient failure for the next sweep.
 */
export const DELIVERY_STATUSES = ["attempting", "sending", "sent", "failed", "no_device"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

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

/**
 * A claimed outbox row, joined to its watch, that watch's latest prediction snapshot, and the
 * owning device's newest push subscription. Returned by the SOLE WRITER's `claimFiredTransitions`
 * so the dispatcher has every fact to render + send WITHOUT a per-row follow-up query (the claim is
 * the only read). Snapshot and subscription columns are null when none exists yet (advice degrades
 * gracefully; a null subscription means no_device). Raw snake_case DB column shape on purpose — the
 * dispatcher is the thin shell that maps it.
 */
export interface ClaimedOutboxRow {
  watch_id: string;
  transition: string;
  revision: string;
  kind: FiredKind;
  lead_time_minutes: number | null;
  device_id: string;
  flight_number: string;
  place_label: string;
  reschedulable: boolean;
  contact: string | null;
  commitment_zone: string;
  commitment_instant: Date;
  predicted_arrival: Date | null;
  transit_minutes_used: number | null;
  egress_minutes_used: number | null;
  margin_minutes_used: number | null;
  /** Newest subscription for the device (null when the device has none registered). */
  sub_id: number | null;
  sub_endpoint: string | null;
  sub_p256dh: string | null;
  sub_auth: string | null;
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
  /** Atomically lease the oldest `attempting` outbox rows to `sending`, enriched for dispatch (U8). */
  claimFiredTransitions(limit: number): Promise<ClaimedOutboxRow[]>;
  /** Crash recovery: return `sending` rows older than the TTL to `attempting`; @returns count. */
  reclaimStuckSending(olderThanMinutes: number): Promise<number>;
  /** At-least-once retry: return one leased (`sending`) row to `attempting` after a transient failure. */
  requeueFiredTransition(watchId: string, transition: string, revision: string): Promise<void>;
  backfillActual(watchId: string, actualUtc: string, arrivalAirport: string): Promise<void>;
  recordSelfReport(watchId: string, outcome: Outcome, wasUseful: boolean): Promise<void>;
}

/** Frozen metrics signature (U10). */
export type ComputeMetrics = () => Promise<Metrics>;
