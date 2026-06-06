import { db } from "@/lib/db";

/** Stop chasing an actual once the flight is this long past its commitment — it won't land now. */
const BACKFILL_WINDOW_HOURS = 24;

/**
 * Select watches that need an actual-arrival backfill (U9 calibration outcome capture).
 *
 * A candidate is a TERMINAL, non-cancelled watch whose calibration row still has `actual_arrival IS
 * NULL`, within a bounded recent window. Each constraint is load-bearing:
 *
 *  - `terminal = TRUE`: a landed flight seals to LANDED_CAPTURE and a missed-en-route flight (which
 *    still lands, late) seals to DEFINITE_MISS — both terminal. Non-terminal watches are still being
 *    reconciled (the due-watch selector handles them, `WHERE terminal = FALSE`), so restricting to
 *    terminal here means the backfill sweep and the reconcile batch never fetch the SAME watch in one
 *    tick — no double-charge, and the two passes' upstream ceilings stay disjoint.
 *  - `state <> 'CANCELLED'`: a cancelled flight never produces a landed actual, so it would otherwise
 *    keep `actual_arrival IS NULL` forever and burn a paid fetch every tick in perpetuity.
 *  - `commitment_instant > now() - <window>`: a flight lands near its commitment; if no actual has
 *    materialized within the window the feed never captured it, so we give up rather than re-fetch
 *    forever — this bounds the standing upstream cost of a never-resolving watch.
 *  - excludes already-diverted rows (known different outcome).
 *
 * We re-fetch in {@link backfillActualForWatch} and only WRITE on a true landed actual, so a
 * not-yet-landed candidate is a harmless NO-OP; the row drops out the instant its actual is written
 * (first-write-wins). `LIMIT` bounds upstream calls per tick (R24).
 */
export async function selectWatchesNeedingActual(limit: number): Promise<string[]> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    SELECT w.id
    FROM watches w
    JOIN calibration c ON c.watch_id = w.id
    WHERE c.actual_arrival IS NULL
      AND c.diverted_to_airport IS NULL
      AND w.terminal = TRUE
      AND w.state <> 'CANCELLED'
      AND w.commitment_instant > now() - make_interval(hours => ${BACKFILL_WINDOW_HOURS})
    ORDER BY w.commitment_instant ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}
