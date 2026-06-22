import { db } from "@/lib/db";
import type postgres from "postgres";
import type {
  CalibrationWriter,
  ClaimedOutboxRow,
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

/**
 * Settle a fired transition the caller currently holds a `sending` lease on (transactional-outbox
 * terminal status). Guarded on `delivery_status = 'sending'` so a stale settle from a tick whose
 * lease was reclaimed becomes a deliberate no-op (it can't clobber the row another tick re-claimed
 * and already settled) — mirrors `requeueFiredTransition`.
 */
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
    WHERE watch_id = ${watchId} AND transition = ${transition} AND revision = ${revision}
      AND delivery_status = 'sending'`;
}

/**
 * ATOMICALLY claim up to `limit` of the oldest `attempting` outbox rows for delivery and return them
 * enriched with everything the dispatcher needs to render + send — the WATCH, that watch's latest
 * prediction snapshot, and the device's NEWEST push subscription — so the dispatcher needs no
 * per-row follow-up query (kills the N+1).
 *
 * The claim is the concurrency gate (U8 double-send fix). A single CTE `UPDATE … WHERE id IN
 * (SELECT id … ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED)` moves the rows to `sending` and
 * stamps `claimed_at` in one statement: `FOR UPDATE SKIP LOCKED` means two overlapping cron ticks
 * partition the backlog — each row is leased by exactly one tick — instead of both reading the same
 * `attempting` rows and double-sending. The outer SELECT then joins the enriched read off the
 * just-claimed ids (snapshot/subscription via LEFT JOIN LATERAL, newest-first, NULL when none).
 */
export async function claimFiredTransitions(limit: number): Promise<ClaimedOutboxRow[]> {
  const sql = db();
  return sql<ClaimedOutboxRow[]>`
    WITH claimed AS (
      UPDATE fired_transitions
      SET delivery_status = 'sending', claimed_at = now()
      WHERE id IN (
        SELECT id FROM fired_transitions
        WHERE delivery_status = 'attempting'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, watch_id, transition, revision, kind, lead_time_minutes, created_at
    )
    SELECT c.watch_id, c.transition, c.revision, c.kind, c.lead_time_minutes,
           w.device_id, w.flight_number, w.place_label, w.reschedulable, w.contact,
           w.commitment_zone, w.commitment_instant,
           s.predicted_arrival, s.transit_minutes_used, s.egress_minutes_used, s.margin_minutes_used,
           sub.id AS sub_id, sub.endpoint AS sub_endpoint, sub.p256dh AS sub_p256dh, sub.auth AS sub_auth
    FROM claimed c
    JOIN watches w ON w.id = c.watch_id
    LEFT JOIN LATERAL (
      SELECT predicted_arrival, transit_minutes_used, egress_minutes_used, margin_minutes_used
      FROM prediction_snapshots
      WHERE watch_id = c.watch_id
      ORDER BY fetched_at DESC
      LIMIT 1
    ) s ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE device_id = w.device_id
      ORDER BY created_at DESC
      LIMIT 1
    ) sub ON TRUE
    ORDER BY c.created_at ASC`;
}

/**
 * Crash recovery: return any `sending` rows leased more than `olderThanMinutes` ago back to
 * `attempting` so a later sweep retries them. A dispatcher that died mid-send (or whose pooler
 * connection dropped) leaves rows stranded in `sending`; the TTL is the heuristic for "no live tick
 * still owns this." Clears `claimed_at` on the way out. @returns the number of rows reclaimed.
 */
export async function reclaimStuckSending(olderThanMinutes: number): Promise<number> {
  const sql = db();
  const rows = await sql`
    UPDATE fired_transitions
    SET delivery_status = 'attempting', claimed_at = NULL
    WHERE delivery_status = 'sending'
      AND claimed_at < now() - make_interval(mins => ${olderThanMinutes})
    RETURNING id`;
  return rows.count;
}

/**
 * Return a single claimed (`sending`) row to `attempting` after a TRANSIENT send failure (5xx / 429
 * / timeout / network) so the next sweep retries it — at-least-once delivery. Distinct from
 * `recordDelivery(... 'failed')`, which is the TERMINAL drop for a permanent 4xx. Clears
 * `claimed_at`; only acts on a row still in `sending` (idempotent under a concurrent reclaim).
 */
export async function requeueFiredTransition(
  watchId: string,
  transition: string,
  revision: string,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE fired_transitions
    SET delivery_status = 'attempting', claimed_at = NULL
    WHERE watch_id = ${watchId} AND transition = ${transition} AND revision = ${revision}
      AND delivery_status = 'sending'`;
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

/**
 * Set the OWNER'S in-app "was this useful?" answer on the calibration row — the real signal behind
 * the cascadeAlertUsefulness metric, captured when a logged-in owner reacts in the Alerts feed.
 * Distinct from recordSelfReport's `was_useful`, which arrives bundled with the made/missed outcome;
 * this writes `was_useful` ALONE, which is safe because it isn't bound by the answered<->outcome CHECK
 * (only `outcome` is). FIRST-write-wins semantics aren't imposed — a toggle re-affirms the latest
 * answer. Does NOT create a row: if no calibration row exists (watch armed before enrichment), the
 * UPDATE matches nothing and we report updated:false rather than fabricating an outcome shell.
 */
export async function setOwnerUsefulness(
  watchId: string,
  wasUseful: boolean,
): Promise<{ updated: boolean }> {
  const sql = db();
  const rows = await sql`
    UPDATE calibration
    SET was_useful = ${wasUseful}
    WHERE watch_id = ${watchId}
    RETURNING watch_id`;
  return { updated: rows.length > 0 };
}

/** Frozen-contract conformance: a single object implementing the CalibrationWriter surface. */
export const calibrationWriter: CalibrationWriter = {
  appendSnapshot,
  recordFiredTransition,
  recordDelivery,
  claimFiredTransitions,
  reclaimStuckSending,
  requeueFiredTransition,
  backfillActual,
  recordSelfReport,
};
