import { db } from "@/lib/db";
import { verifyToken } from "@/lib/security/capability";

/**
 * The single home for the capability gate (R23). A watch is owned by an unguessable token minted at
 * arm; only its hash is stored. Every read/mutation must present the token and have it verified, in
 * constant time, against that stored hash. This used to be duplicated inline in the self-report
 * route, the watch GET route, and the dashboard page — three copies of the same SELECT-then-verify,
 * three chances to diverge (a 404 existence oracle here, a forgotten constant-time compare there).
 *
 * Architecture mirrors the rest of the codebase: a PURE decision (`decideWatchAccess`) that owns the
 * deny-vs-allow logic and is exhaustively unit-tested without a database, plus a thin `loadAndVerifyWatch`
 * IO that does only the SELECT and hands the row to the decider.
 *
 * UNIFORM DENIAL: a missing watch and a wrong token are the SAME outcome ({ ok: false }). Callers map
 * both to one indistinguishable response (the routes' 403, the dashboard's "denied" gate) so a guesser
 * can never use the status code to learn which watch ids are live. Never surface a distinct 404 here.
 */

/** A row the gate loads to authorize: the stored hash plus the fields the watch GET route renders. */
export interface GateWatchRow {
  id: string;
  ownerTokenHash: string;
  state: string;
  placeLabel: string;
  flightNumber: string;
  commitmentZone: string;
  commitmentInstantUtc: string;
  transitMinutes: number;
  reschedulable: boolean;
  contact: string | null;
}

/**
 * The gate decision. On `ok` the row is returned (sans hash — callers never need it once verified).
 * On a miss the result carries NO data, so a denied caller has nothing to leak.
 */
export type WatchAccess = { ok: true; watch: GateWatchRow } | { ok: false };

/**
 * PURE: decide access from a loaded row (or null) + the presented token. A null row (watch not found)
 * and a token that fails the constant-time verify both deny identically — there is exactly one
 * `{ ok: false }`, so existence and authorization are indistinguishable to the caller. No IO, no
 * globals; this is where the gate's security property is asserted in tests.
 */
export function decideWatchAccess(row: GateWatchRow | null, token: string): WatchAccess {
  if (row === null) return { ok: false };
  if (!verifyToken(token, row.ownerTokenHash)) return { ok: false };
  return { ok: true, watch: row };
}

/**
 * Thin IO: load the watch by id, then run the pure decision. The ONLY place the gate's SELECT lives.
 * Selects the owner hash (for the verify) plus the fields the watch GET route renders, so that route
 * needs no second query. Returns the uniform `WatchAccess` — the caller maps a miss to its own
 * indistinguishable response. Not unit-tested directly (no DB in CI); the decision it delegates to is.
 */
export async function loadAndVerifyWatch(id: string, token: string): Promise<WatchAccess> {
  const sql = db();
  const rows = await sql`
    SELECT id, owner_token_hash, state, place_label, flight_number, commitment_zone,
           commitment_instant, transit_minutes, reschedulable, contact
    FROM watches WHERE id = ${id}`;

  if (rows.length === 0) return decideWatchAccess(null, token);

  const w = rows[0];
  // DB boundary: coerce the untyped driver row into the typed gate projection before deciding.
  const row: GateWatchRow = {
    id: String(w.id),
    ownerTokenHash: String(w.owner_token_hash),
    state: String(w.state),
    placeLabel: String(w.place_label),
    flightNumber: String(w.flight_number),
    commitmentZone: String(w.commitment_zone),
    commitmentInstantUtc: toIso(w.commitment_instant),
    transitMinutes: Number(w.transit_minutes),
    reschedulable: Boolean(w.reschedulable),
    contact: w.contact === null ? null : String(w.contact),
  };
  return decideWatchAccess(row, token);
}

/** Normalize a driver timestamp (Date | string) to a UTC ISO string for the contract boundary. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
