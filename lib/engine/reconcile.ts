import { DateTime } from "luxon";

import { db } from "@/lib/db";
import { appendSnapshot, recordFiredTransition } from "@/lib/calibration/writer";
import type { FiredTransitionRecord, PredictionSnapshot } from "@/lib/calibration/types";
import { detectCollision } from "./collision";
import { step, isTerminalState } from "./state";
import { ENGINE } from "./constants";
import { toInstant } from "./time";
import type {
  CollisionResult,
  Commitment,
  FlightArrival,
  FlightStatus,
  WatchState,
} from "./types";

/**
 * The reconciliation engine (U6) — one idempotent, concurrency-safe reconcile per watch.
 *
 * Split into a PURE planner and a thin IO shell:
 *  - `planReconcile` is the deterministic decision core (verdict → transition → snapshot + outbox
 *    row + scheduling). No DB, no clock, no adapter — the entire test matrix runs against it.
 *  - `reconcileWatch` is the transaction: `SELECT … FOR UPDATE`, run the planner, then commit the
 *    watch-state update, the appended snapshot, and the fired-transition outbox row TOGETHER. The
 *    unique insert on `fired_transitions` is the commit gate that authorizes exactly one push.
 *
 * Adapters are fetched OUTSIDE this path and handed in as a {@link FlightFetch}, so a future
 * webhook reuses the same entry point. Transit stays the cached arm-time value (off the hot path).
 */

/** The watch facts the planner reasons over (a normalized projection of the DB row). */
export interface WatchRow {
  id: string;
  state: WatchState;
  revision: string | null; // last processed input fingerprint
  recoveryProgress: number; // persisted dwell counter
  commitmentInstantUtc: string; // resolved commitment instant (UTC ISO)
  commitmentZone: string; // IANA zone of the place
  marginMinutes: number;
  reschedulable: boolean;
  egressMinutes: number;
  transitMinutes: number; // cached airport→place duration
  arrivalAirport: string | null;
  lastFetchedAt: string | null; // UTC ISO of the last successful fetch, or null
  terminal: boolean;
}

/** The outcome of fetching the flight datum for this tick (handed in from outside the lock). */
export type FlightFetch = { kind: "fresh"; flight: FlightArrival } | { kind: "unavailable" };

/**
 * A firing transition ready to become an outbox row — the pure-planner half of a
 * {@link FiredTransitionRecord}; the IO shell adds watchId + revision at write time.
 */
export type FiredRow = Omit<FiredTransitionRecord, "watchId" | "revision">;

export type SkipReason = "terminal" | "unchanged" | "awaiting_retry";

export type ReconcilePlan =
  | { kind: "skip"; reason: SkipReason; nextPollMinutes: number | null }
  | {
      kind: "apply";
      state: WatchState;
      revision: string;
      recoveryProgress: number;
      terminal: boolean;
      nextPollMinutes: number | null;
      snapshot: PredictionSnapshot;
      fired: FiredRow | null;
    };

const INDETERMINATE: CollisionResult = {
  verdict: "indeterminate",
  projectedAtPlaceUtc: null,
  slackMinutes: null,
  leadMinutes: null,
};

const minutesBetween = (from: DateTime, to: DateTime): number => to.diff(from, "minutes").minutes;

/** Stable within one staleness window, advancing across windows — bounds degraded snapshots. */
const staleBucket = (now: DateTime): number =>
  Math.floor(now.toMillis() / (ENGINE.stalenessCeilingMinutes * 60_000));

/**
 * Rebuild the {@link Commitment} for the collision core from the stored instant + zone. The instant
 * was `resolveLocal(localWallTime, zone)` at arm, so round-tripping through the zone recovers the
 * same wall-time and `detectCollision` recomputes an identical deadline (then subtracts the margin).
 *
 * We deliberately invert the stored UTC instant (unambiguous) rather than reloading the stored
 * `commitment_local` wall string: instant->zone->wall is DST-stable for both the spring-forward gap
 * (an instant always maps to exactly one valid wall time) and the fall-back fold (Luxon resolves the
 * recovered wall time back to the same earlier instant arm chose). Pinned by the DST tests.
 */
const reconstructCommitment = (watch: WatchRow): Commitment => ({
  localWallTime: DateTime.fromISO(watch.commitmentInstantUtc, { zone: "utc" })
    .setZone(watch.commitmentZone)
    .toISO({ includeOffset: false }) as string,
  ianaZone: watch.commitmentZone,
  marginMinutes: watch.marginMinutes,
  reschedulable: watch.reschedulable,
});

/** Scheduling policy lives with the engine, not the scheduler. null = terminal, never poll again. */
const pollMinutes = (
  state: WatchState,
  terminal: boolean,
  watch: WatchRow,
  now: DateTime,
  flightLanded: boolean,
): number | null => {
  if (terminal) return null;
  if (state === "DEGRADED") return ENGINE.pollDegradedRetryMinutes;
  const minutesUntil = minutesBetween(now, toInstant(watch.commitmentInstantUtc));
  if (flightLanded || minutesUntil <= ENGINE.arrivalWindowMinutes) return ENGINE.pollInWindowMinutes;
  return ENGINE.pollOutOfWindowMinutes;
};

/**
 * PURE reconcile decision. Returns a skip (terminal / already-processed / transient-no-data) or the
 * full apply plan. Never throws, never touches IO.
 */
export function planReconcile(watch: WatchRow, fetch: FlightFetch, nowUtc: string): ReconcilePlan {
  if (watch.terminal) {
    return { kind: "skip", reason: "terminal", nextPollMinutes: null };
  }

  const now = toInstant(nowUtc);
  const commitmentPassed = now.toMillis() >= toInstant(watch.commitmentInstantUtc).toMillis();

  let revision: string;
  let predicted: string | null;
  let collision: CollisionResult;
  let flightStatus: FlightStatus;
  let flightLanded: boolean;
  let feedStale: boolean;

  if (fetch.kind === "fresh") {
    const f = fetch.flight;
    revision = f.revision;
    predicted = f.predictedUtc ?? f.scheduledUtc;
    collision = detectCollision({
      predictedArrivalUtc: predicted,
      egressMinutes: watch.egressMinutes,
      transitMinutes: watch.transitMinutes,
      commitment: reconstructCommitment(watch),
      nowUtc,
    });
    flightStatus = f.status;
    flightLanded = f.status === "landed" || f.actualUtc !== null;
    feedStale = false;
  } else {
    // No fresh datum. A single failed poll within the freshness ceiling is transient — retry soon
    // without polluting the corpus or crying wolf. Only past the ceiling do we honestly degrade.
    // arm seeds last_fetched_at, but a missing clock counts as just-fetched (grace window from now),
    // never infinitely stale — otherwise a freshly-armed watch would degrade on its first blip.
    const minutesSinceFetch =
      watch.lastFetchedAt === null
        ? 0
        : minutesBetween(toInstant(watch.lastFetchedAt), now);
    if (minutesSinceFetch < ENGINE.stalenessCeilingMinutes) {
      return { kind: "skip", reason: "awaiting_retry", nextPollMinutes: ENGINE.pollTransientRetryMinutes };
    }
    revision = `stale:${staleBucket(now)}`;
    predicted = null;
    collision = INDETERMINATE;
    flightStatus = "unknown";
    flightLanded = false;
    feedStale = true;
  }

  // Idempotency gate: this exact input was already processed (a replay, or a concurrent loser that
  // woke after the winner committed and bumped the revision). Re-poll on cadence, write nothing.
  if (revision === watch.revision) {
    return {
      kind: "skip",
      reason: "unchanged",
      nextPollMinutes: pollMinutes(watch.state, false, watch, now, flightLanded),
    };
  }

  const out = step({
    current: watch.state,
    verdict: collision.verdict,
    slackMinutes: collision.slackMinutes,
    flightStatus,
    flightLanded,
    feedStale,
    commitmentPassed,
    recoveryProgress: watch.recoveryProgress,
  });

  const terminal = isTerminalState(out.next);

  let fired: FiredRow | null = null;
  if (out.fired !== null) {
    const isCatch = out.fired === "CATCH";
    const lead = collision.leadMinutes;
    fired = {
      transition: `${watch.state}->${out.next}`,
      kind: out.fired,
      leadTimeMinutes: isCatch ? lead : null,
      usefulLead: isCatch ? lead !== null && lead >= ENGINE.usableLeadMinutes : null,
    };
  }

  const snapshot: PredictionSnapshot = {
    watchId: watch.id,
    fetchedAt: nowUtc,
    predictedArrivalUtc: predicted,
    transitMinutesUsed: watch.transitMinutes,
    egressMinutesUsed: watch.egressMinutes,
    marginMinutesUsed: watch.marginMinutes,
    slackMinutes: collision.slackMinutes,
    verdict: collision.verdict,
    resultingState: out.next,
    revision,
    firedTransition: out.fired,
  };

  return {
    kind: "apply",
    state: out.next,
    revision,
    recoveryProgress: out.recoveryProgress,
    terminal,
    nextPollMinutes: pollMinutes(out.next, terminal, watch, now, flightLanded),
    snapshot,
    fired,
  };
}

/** Raw watch columns read under the row lock. */
interface WatchDbRow {
  id: string;
  state: WatchState;
  revision: string | null;
  recovery_progress: number;
  commitment_instant: Date;
  commitment_zone: string;
  margin_minutes: number;
  reschedulable: boolean;
  egress_minutes: number;
  transit_minutes: number;
  arrival_airport: string | null;
  last_fetched_at: Date | null;
  terminal: boolean;
}

const rowToWatchRow = (r: WatchDbRow): WatchRow => ({
  id: r.id,
  state: r.state,
  revision: r.revision,
  recoveryProgress: r.recovery_progress,
  commitmentInstantUtc: r.commitment_instant.toISOString(),
  commitmentZone: r.commitment_zone,
  marginMinutes: r.margin_minutes,
  reschedulable: r.reschedulable,
  egressMinutes: r.egress_minutes,
  transitMinutes: r.transit_minutes,
  arrivalAirport: r.arrival_airport,
  lastFetchedAt: r.last_fetched_at ? r.last_fetched_at.toISOString() : null,
  terminal: r.terminal,
});

const isoAfter = (nowUtc: string, minutes: number): string =>
  toInstant(nowUtc).plus({ minutes }).toUTC().toISO() as string;

export type ReconcileOutcome =
  | { kind: "missing" }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "applied"; state: WatchState; fired: FiredRow | null };

/**
 * Reconcile one watch inside a single short transaction. Re-reads state under `FOR UPDATE` so the
 * dwell counter can't be double-incremented by overlapping ticks; appends the snapshot and (on a
 * firing edge) the outbox row through the sole writer so all three commit atomically. The unique
 * constraints on `(watch_id, revision)` and `(watch_id, transition, revision)` make a replayed or
 * concurrent tick a no-op beyond the first.
 */
export async function reconcileWatch(
  watchId: string,
  fetch: FlightFetch,
  nowUtc: string,
): Promise<ReconcileOutcome> {
  const sql = db();
  let outcome: ReconcileOutcome = { kind: "missing" };

  await sql.begin(async (tx) => {
    // Bound the row-lock wait. We use plain FOR UPDATE (not SKIP LOCKED) on purpose: a concurrent
    // tick on the same watch should BLOCK, then re-read the committed revision and no-op via the
    // dedup gate — SKIP LOCKED would instead return zero rows and look like a missing watch.
    // lock_timeout caps the wait so a stuck holder can't pin a pooler connection; the U7 batch
    // treats the resulting error as a transient skip.
    await tx`SET LOCAL lock_timeout = '5s'`;

    const rows = await tx<WatchDbRow[]>`
      SELECT id, state, revision, recovery_progress, commitment_instant, commitment_zone,
             margin_minutes, reschedulable, egress_minutes, transit_minutes, arrival_airport,
             last_fetched_at, terminal
      FROM watches
      WHERE id = ${watchId}
      FOR UPDATE`;
    if (rows.length === 0) {
      outcome = { kind: "missing" };
      return;
    }

    const watch = rowToWatchRow(rows[0]);
    const plan = planReconcile(watch, fetch, nowUtc);
    // A successful fresh fetch advances the freshness clock; an unavailable one leaves it untouched.
    const fetchedAtPatch = fetch.kind === "fresh" ? nowUtc : null;
    const nextPollAt = plan.nextPollMinutes === null ? null : isoAfter(nowUtc, plan.nextPollMinutes);

    if (plan.kind === "skip") {
      // A terminal watch is excluded by the watches_due index and has nothing to reschedule —
      // skip the write entirely rather than re-stamping next_poll_at = NULL on every stray tick.
      if (plan.reason === "terminal") {
        outcome = { kind: "skipped", reason: plan.reason };
        return;
      }
      await tx`
        UPDATE watches
        SET next_poll_at = ${nextPollAt},
            last_fetched_at = COALESCE(${fetchedAtPatch}::timestamptz, last_fetched_at)
        WHERE id = ${watchId}`;
      outcome = { kind: "skipped", reason: plan.reason };
      return;
    }

    await tx`
      UPDATE watches
      SET state = ${plan.state},
          revision = ${plan.revision},
          recovery_progress = ${plan.recoveryProgress},
          terminal = ${plan.terminal},
          next_poll_at = ${nextPollAt},
          last_fetched_at = COALESCE(${fetchedAtPatch}::timestamptz, last_fetched_at)
      WHERE id = ${watchId}`;

    await appendSnapshot(plan.snapshot, tx);
    if (plan.fired !== null) {
      await recordFiredTransition({ watchId, revision: plan.revision, ...plan.fired }, tx);
    }

    outcome = { kind: "applied", state: plan.state, fired: plan.fired };
  });

  return outcome;
}
