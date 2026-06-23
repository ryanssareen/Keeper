import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Every trip-scoped table keyed by `user_id`, in safe deletion order. `watches` is last among the
 * corpus tables because its FKs cascade (ON DELETE CASCADE) to prediction_snapshots, fired_transitions
 * and calibration — deleting the watch row clears that whole append-only chain in one statement.
 * `onboarding` is the trip DEFINITION itself (destination, dates, flight, hotel), so it is removed last:
 * once it is gone the account is back to its brand-new, pre-onboarding state and the (app) layout will
 * route the user into onboarding again.
 *
 * `user_preferences` is intentionally EXCLUDED — theme/accent are account chrome, not the trip, so a
 * reset must not silently flip someone's UI back to defaults.
 *
 * These are a FIXED allowlist (never user input), which is why interpolating them into the SQL string
 * for the per-table loop below is safe — the only runtime value, the user-id list, is always bound as a
 * parameter.
 */
export const TRIP_TABLES = [
  "itinerary_items",
  "checklist_items",
  "trip_attachments",
  "trip_shares",
  "watches",
  "onboarding",
] as const;

export type TripTable = (typeof TRIP_TABLES)[number];
export type ResetCounts = Record<TripTable, number>;

/**
 * Remove (or, in `dryRun`, just count) every trip-scoped row owned by `userIds`. Runs on the raw
 * pooler connection, which bypasses RLS on purpose: this is a service-level admin sweep, not a
 * user-scoped read. Returns the per-table affected-row counts so the caller can report exactly what
 * was cleared. A no-op (`userIds` empty) returns all-zero without touching the database.
 */
export async function resetTripsForUsers(
  sql: Sql,
  userIds: readonly string[],
  dryRun: boolean,
): Promise<ResetCounts> {
  const counts = Object.fromEntries(TRIP_TABLES.map((t) => [t, 0])) as ResetCounts;
  if (userIds.length === 0) return counts;

  const ids = [...userIds];
  for (const table of TRIP_TABLES) {
    if (dryRun) {
      const rows = await sql.unsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = ANY($1::text[])`,
        [ids],
      );
      counts[table] = rows[0]?.n ?? 0;
    } else {
      const res = await sql.unsafe(`DELETE FROM ${table} WHERE user_id = ANY($1::text[])`, [ids]);
      counts[table] = res.count ?? 0;
    }
  }
  return counts;
}
