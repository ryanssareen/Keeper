import { db } from "@/lib/db";
import type { DueWatch } from "./types";

/**
 * Select watches due for reconciliation, most-due first, capped (U7). Deliberately a dumb query:
 * the scheduling policy (`next_poll_at`, back-off) is computed and persisted by the U6 reconcile
 * transaction, so the scheduler never decides when a watch is due — it only reads the decision.
 *
 * Excludes terminal watches and never-scheduled rows (`next_poll_at IS NULL`); both are filtered by
 * the `watches_due` partial index. The `LIMIT` is the per-tick work ceiling — a forged authorized
 * call can never select (and therefore never fan out to) more than `limit` watches.
 */
export async function selectDueWatches(limit: number): Promise<DueWatch[]> {
  const sql = db();
  const rows = await sql<{ id: string; flight_number: string; flight_date: string }[]>`
    SELECT id, flight_number, to_char(flight_date, 'YYYY-MM-DD') AS flight_date
    FROM watches
    WHERE terminal = FALSE
      AND next_poll_at IS NOT NULL
      AND next_poll_at <= now()
    ORDER BY next_poll_at ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, flightNumber: r.flight_number, flightDate: r.flight_date }));
}
