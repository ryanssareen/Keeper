import { db } from "@/lib/db";
import type postgres from "postgres";
import type {
  CalibrationWriter,
  DeliveryStatus,
  FiredTransitionRecord,
  Outcome,
  PredictionSnapshot,
} from "@/lib/calibration/types";

/**
 * Sole writer for the calibration corpus. Every corpus mutation goes through here so the
 * append-only, first-write-wins, and lifecycle invariants live in exactly one place.
 */

/**
 * A query executor: the base client (db()) or a transaction handle (the `tx` from sql.begin).
 * Both extend postgres's `ISql`, so passing a `tx` lets a caller compose snapshot +
 * fired-transition + watch-state writes into one atomic commit — the transactional outbox the
 * reconcile engine depends on (U6).
 */
type Exec = postgres.ISql;

/** Append one prediction snapshot. Idempotent on (watch_id, revision) — a replayed reconcile is a no-op. */
export async function appendSnapshot(snap: PredictionSnapshot, exec: Exec = db()): Promise<void> {
  await exec`
    INSERT INTO prediction_snapshots
      (watch_id, fetched_at, predicted_arrival, transit_minutes_used, egress_minutes_used,
       margin_minutes_used, slack_minutes, verdict, resulting_state, revision, fired_transition)
    VALUES
      (${snap.watchId}, ${snap.fetchedAt}, ${snap.predictedArrivalUtc},
       ${snap.transitMinutesUsed}, ${snap.egressMinutesUsed}, ${snap.marginMinutesUsed},
       ${snap.slackMinutes}, ${snap.verdict}, ${snap.resultingState}, ${snap.revision},
       ${snap.firedTransition})
    ON CONFLICT (watch_id, revision) DO NOTHING`;
}

/**
 * Insert the fired-transition outbox row — the commit gate that authorizes exactly one push.
 * Idempotent on (watch_id, transition, revision): a replayed or concurrent reconcile at the same
 * revision inserts nothing, so no edge is ever double-delivered. delivery_status defaults to
 * 'attempting'; the dispatcher (U8) claims unsent rows after commit. Pass the caller's `tx` so this
 * commits atomically with the snapshot and the watch-state update.
 */
export async function recordFiredTransition(
  rec: FiredTransitionRecord,
  exec: Exec = db(),
): Promise<void> {
  await exec`
    INSERT INTO fired_transitions
      (watch_id, transition, revision, kind, lead_time_minutes, useful_lead)
    VALUES
      (${rec.watchId}, ${rec.transition}, ${rec.revision}, ${rec.kind},
       ${rec.leadTimeMinutes}, ${rec.usefulLead})
    ON CONFLICT (watch_id, transition, revision) DO NOTHING`;
}

/** Record the delivery outcome of a fired transition (transactional-outbox status backfill). */
export async function recordDelivery(
  watchId: string,
  transition: string,
  revision: string,
  status: DeliveryStatus,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE fired_transitions
    SET delivery_status = ${status},
        sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE sent_at END
    WHERE watch_id = ${watchId} AND transition = ${transition} AND revision = ${revision}`;
}

/**
 * Backfill the flight's actual arrival — FIRST-WRITE-WINS (only when actual is still NULL).
 * An arrival airport that differs from the watch's baseline records a diversion. Seals the row
 * if the self-report has already landed.
 */
export async function backfillActual(
  watchId: string,
  actualUtc: string,
  arrivalAirport: string,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE calibration c
    SET actual_arrival = ${actualUtc},
        diverted_to_airport = CASE
          WHEN w.arrival_airport IS NOT NULL AND w.arrival_airport <> ${arrivalAirport}
          THEN ${arrivalAirport} ELSE c.diverted_to_airport END,
        enrichment_state = CASE
          WHEN c.self_report_status = 'answered' THEN 'sealed' ELSE 'awaiting_self_report' END
    FROM watches w
    WHERE c.watch_id = ${watchId} AND w.id = c.watch_id AND c.actual_arrival IS NULL`;
}

/**
 * Capture the one-shot self-report. Sets outcome + answered status together (honoring the
 * answered<->outcome CHECK). Only a pending/expired row is updated — a non-response that never
 * reaches here stays NULL, never coerced to "missed". Seals the row if the actual has landed.
 */
export async function recordSelfReport(
  watchId: string,
  outcome: Outcome,
  wasUseful: boolean,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE calibration
    SET outcome = ${outcome},
        was_useful = ${wasUseful},
        self_report_status = 'answered',
        self_report_at = now(),
        enrichment_state = CASE
          WHEN actual_arrival IS NOT NULL THEN 'sealed' ELSE 'awaiting_actual' END
    WHERE watch_id = ${watchId} AND self_report_status IN ('pending', 'expired')`;
}

/** Frozen-contract conformance: a single object implementing the CalibrationWriter surface. */
export const calibrationWriter: CalibrationWriter = {
  appendSnapshot,
  recordFiredTransition,
  recordDelivery,
  backfillActual,
  recordSelfReport,
};
