import { db } from "@/lib/db";
import { fetchFlight } from "@/lib/adapters/aerodatabox";
import { backfillActual } from "@/lib/calibration/writer";
import { ENGINE } from "@/lib/engine/constants";
import type { FlightArrival } from "@/lib/engine/types";

/**
 * Calibration outcome capture — the actual-arrival backfill orchestration and the self-report
 * expiry sweep (U9). Every corpus mutation routes through the sole writer
 * ({@link backfillActual} / recordSelfReport); this module NEVER issues its own calibration SQL.
 * Its only DB reach is reading the watch's flight identifiers (backfill) and a single
 * column-scoped status transition on the calibration table (expiry sweep), which touches no
 * outcome/actual column so it can never clobber a real datum.
 */

/** A flight datum that represents a landed actual: the instant the aircraft was on the ground. */
export interface LandedActual {
  actualUtc: string;
  arrivalAirport: string;
}

/**
 * PURE decision: does this flight datum represent a LANDED actual we can backfill?
 *
 * Landed when the upstream status is "landed" OR a runway (actual) time is present — a status of
 * "landed" can arrive a poll before the runway timestamp is populated, and a runway time can appear
 * while the status still reads "active", so either signal alone counts. We then need a concrete
 * instant to record: prefer the true runway time, and only when status already says landed but no
 * runway time exists yet do we fall back to the best available estimate (revised, else scheduled).
 * If the datum claims landed but carries no usable instant at all, we return null — there is nothing
 * honest to backfill, and a later poll with a real instant will succeed (backfill is first-write-wins).
 *
 * Diverted/cancelled flights never landed at the watched airport, so they are not treated as a
 * landed actual here (a diversion is recorded by the writer when a landed arrival's airport differs).
 */
export function actualFromFlight(flight: FlightArrival): LandedActual | null {
  const landed = flight.status === "landed" || flight.actualUtc !== null;
  if (!landed) return null;

  const actualUtc = flight.actualUtc ?? flight.predictedUtc ?? flight.scheduledUtc;
  if (actualUtc === null) return null;

  return { actualUtc, arrivalAirport: flight.arrivalAirport };
}

/** The watch identifiers needed to re-fetch the flight for backfill. */
interface WatchFlightRow {
  flight_number: string;
  flight_date: Date | string;
}

/** Format a DATE column (Date or already-"YYYY-MM-DD" string) to the YYYY-MM-DD the adapter expects. */
const toFlightDate = (value: Date | string): string =>
  typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * IO shell: backfill one watch's flight-actual arrival.
 *
 * Reads the watch's flight_number + flight_date, re-fetches the flight, and on a landed actual
 * routes the write through the sole writer ({@link backfillActual}, which is first-write-wins and
 * records a diversion when the arrival airport differs from the watch baseline). A not-ok adapter
 * result (not_found / rate_limited / error) or a not-yet-landed flight is a deliberate NO-OP: the
 * corpus is left untouched and the next sweep tries again. Returns whether a backfill was attempted
 * (the row may still be unchanged if the actual had already been recorded — first-write-wins).
 */
export async function backfillActualForWatch(watchId: string): Promise<boolean> {
  const sql = db();
  const rows = await sql<WatchFlightRow[]>`
    SELECT flight_number, flight_date FROM watches WHERE id = ${watchId}`;
  if (rows.length === 0) return false;

  const result = await fetchFlight(rows[0].flight_number, toFlightDate(rows[0].flight_date));
  if (result.kind !== "ok") return false;

  const landed = actualFromFlight(result.data);
  if (landed === null) return false;

  await backfillActual(watchId, landed.actualUtc, landed.arrivalAirport);
  return true;
}

/**
 * The self-report window: how long after the commitment instant a one-tap prompt stays answerable
 * before it is swept to "expired". We reuse {@link ENGINE.usableLeadMinutes} (the same 30-minute
 * scale that defines a useful catch) — long enough for the traveller to actually respond once they
 * have landed and reached (or missed) the place, short enough that an unanswered prompt is retired
 * promptly so the corpus reflects an honest non-response rather than an indefinitely "pending" row.
 */
export const SELF_REPORT_WINDOW_MINUTES = ENGINE.usableLeadMinutes;

/**
 * Expire stale self-report prompts: a SINGLE column-scoped UPDATE moving calibration rows from
 * self_report_status 'pending' -> 'expired' once the watch's commitment instant has passed by more
 * than {@link SELF_REPORT_WINDOW_MINUTES} AND the row is still pending. It writes only
 * self_report_status — never outcome, was_useful, or actual_arrival — so it can run concurrently
 * with a backfill (different columns) and never coerces a non-response into "missed": outcome stays
 * NULL, honoring the answered<->outcome CHECK.
 *
 * LATE-ANSWER RULE: expiring a prompt does NOT close the door. The sole writer's recordSelfReport
 * updates rows whose status is 'pending' OR 'expired', so a late tap after this sweep STILL WINS —
 * it sets outcome + self_report_status='answered' over the expired row. "Expired" means "we stopped
 * waiting", not "we refuse a late answer".
 *
 * @returns the number of prompts swept to expired.
 */
export async function expireStaleSelfReports(): Promise<number> {
  const sql = db();
  const rows = await sql`
    UPDATE calibration c
    SET self_report_status = 'expired'
    FROM watches w
    WHERE c.watch_id = w.id
      AND c.self_report_status = 'pending'
      AND w.commitment_instant < now() - (${SELF_REPORT_WINDOW_MINUTES} || ' minutes')::interval
    RETURNING c.watch_id`;
  return rows.count;
}
