import { adapterError, type AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";
import type { FlightFetch, ReconcileOutcome } from "@/lib/engine/reconcile";
import type { DueWatch } from "./types";

export type { DueWatch } from "./types";

/**
 * The reconcile batch orchestrator (U7) — pure and injectable. The route hands in the real adapter
 * (`fetchFlight`) and reconcile transaction (`reconcileWatch`); this module owns only the policy:
 * a hard upstream-call ceiling, per-watch error isolation, and rate-limit throttling. Keeping it
 * dependency-injected makes that policy unit-testable without a network or a database.
 *
 * Scheduling policy (next_poll_at, back-off) deliberately lives in the U6 reconcile transaction,
 * not here — so this stays a dumb "process the due list, bounded" loop and the route is scheduler-
 * agnostic.
 */

/** Injected collaborators (the real adapter + reconcile transaction + backoff writer in production). */
export interface BatchDeps {
  fetchFlight: (flightNumber: string, flightDate: string) => Promise<AdapterResult<FlightArrival>>;
  reconcileWatch: (watchId: string, fetch: FlightFetch, nowUtc: string) => Promise<ReconcileOutcome>;
  /** Push a watch whose reconcile threw past `now` so a persistent failure can't hot-loop the tick. */
  backoffWatch: (watchId: string) => Promise<void>;
}

/** A tick's outcome counts — the route returns this as the response body (observability). */
export interface BatchSummary {
  due: number; // due watches handed in
  processed: number; // reconcileWatch invoked
  upstreamCalls: number; // flight fetches spent
  applied: number;
  skipped: number;
  missing: number;
  errors: number; // watches whose reconcile threw (isolated, not fatal)
  failedWatchIds: string[]; // identities behind `errors`, for server-side observability + agents
  throttled: boolean; // stopped early on an upstream rate-limit
}

/** Any non-ok adapter result means "couldn't get fresh data" — the engine degrades honestly. */
const toFlightFetch = (result: AdapterResult<FlightArrival>): FlightFetch =>
  result.kind === "ok" ? { kind: "fresh", flight: result.data } : { kind: "unavailable" };

/**
 * Reconcile a batch of due watches under a hard upstream-call ceiling. One watch's fetch or
 * reconcile throwing never aborts the batch (the error is counted and the loop continues); an
 * upstream rate-limit stops the tick early so we don't hammer a throttled API — the remaining
 * watches stay due and are picked up next tick.
 */
export async function reconcileDueBatch(
  watches: DueWatch[],
  deps: BatchDeps,
  nowUtc: string,
  maxUpstreamCalls: number,
): Promise<BatchSummary> {
  const summary: BatchSummary = {
    due: watches.length,
    processed: 0,
    upstreamCalls: 0,
    applied: 0,
    skipped: 0,
    missing: 0,
    errors: 0,
    failedWatchIds: [],
    throttled: false,
  };

  for (const watch of watches) {
    if (summary.upstreamCalls >= maxUpstreamCalls) break; // never fan out past the ceiling

    summary.upstreamCalls += 1; // count the attempt before it's made — the cap bounds attempts
    let result: AdapterResult<FlightArrival>;
    try {
      result = await deps.fetchFlight(watch.flightNumber, watch.flightDate);
    } catch {
      // A transport failure is just "couldn't get fresh data" — let the engine degrade it honestly
      // (and advance next_poll_at) rather than skipping the watch, which would leave it hot-looping.
      result = adapterError("flight fetch threw");
    }

    if (result.kind === "rate_limited") {
      summary.throttled = true; // back off — leave the rest of the due list for the next tick
      break;
    }

    try {
      const outcome = await deps.reconcileWatch(watch.id, toFlightFetch(result), nowUtc);
      summary.processed += 1;
      if (outcome.kind === "applied") summary.applied += 1;
      else if (outcome.kind === "skipped") summary.skipped += 1;
      else summary.missing += 1;
    } catch {
      // A reconcile (DB) error is isolated, not fatal. The watch's tx rolled back without advancing
      // next_poll_at, so back it off best-effort to stop a persistent failure burning quota each tick.
      summary.errors += 1;
      summary.failedWatchIds.push(watch.id);
      try {
        await deps.backoffWatch(watch.id);
      } catch {
        /* best-effort: a failed backoff must not abort the batch */
      }
    }
  }

  return summary;
}
