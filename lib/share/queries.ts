import { db } from "@/lib/db";
import { narrow } from "@/lib/calibration/dashboard";
import { WATCH_STATES, type WatchState } from "@/lib/engine/types";
import { formatInZone } from "@/lib/format/time";
import { isItemKind } from "@/lib/itinerary/itinerary";
import { deriveSharedStatus, type NextItem, type SharedStatus, type SharedStep } from "@/lib/share/share";

/**
 * Server-only share reads. Directiveless (NOT "use server") so it can be called from a Server Component
 * and keeps cookie context — but the PUBLIC status path below deliberately does NOT use the authenticated
 * Supabase client. It uses the raw postgres.js pooler db() (which bypasses RLS) so a LOGGED-OUT viewer can
 * resolve a share token to a friendly, redacted status. The owner's mint/revoke path uses the
 * authenticated client and lives in actions.ts; loadActiveShareToken below is the owner's READ.
 *
 * Columns read are kept MINIMAL and read-only: onboarding.answers (for dest + a friendly owner name),
 * the soonest active watch (state only), and today's itinerary stops (for the mini-timeline). We never
 * select tokens, emails, flight numbers, or document contents — the SharedStatus type has no field for
 * them, and the SELECTs below don't fetch them.
 */

/** A flattened itinerary stop the timeline builder shapes — only display fields, no row identity. */
type StopRow = {
  title: string;
  placeName: string;
  ianaZone: string;
  startTs: string | null;
  kind: string;
  status: string;
};

/**
 * Resolve a share token to a redacted, read-only trip status for a logged-out viewer. Returns null when
 * the token is unknown/revoked, or on ANY failure (a share link must never leak an error stack to a
 * public viewer — it just 404s/"link expired" upstream). The whole body is wrapped so a missing table,
 * a bad row, or a thrown narrow() degrades to null rather than throwing on a public render path.
 */
export async function loadSharedStatus(token: string): Promise<SharedStatus | null> {
  try {
    const sql = db();

    // 1. Resolve the token to its owner. A revoked or unknown token is indistinguishable: null.
    const shareRows = await sql`
      SELECT user_id FROM trip_shares WHERE token = ${token} AND revoked_at IS NULL LIMIT 1`;
    if (shareRows.length === 0) return null;
    const userId = String(shareRows[0].user_id);

    // 2. Pull the owner's trip facts in parallel: onboarding answers (dest + owner name fallback), the
    //    soonest ACTIVE watch (state only), and today's itinerary stops for the timeline. db() reads
    //    these directly — the pooler role bypasses RLS, so no per-user auth context is needed.
    const [onboardingRows, watchRows, stopRows] = await Promise.all([
      sql`SELECT answers FROM onboarding WHERE user_id = ${userId} LIMIT 1`,
      // Mirror loadWatchesForUser's ownership scope, but keep only the soonest non-terminal watch.
      sql`
        SELECT state FROM watches
        WHERE user_id = ${userId} AND terminal = FALSE
        ORDER BY commitment_instant ASC
        LIMIT 1`,
      // Today's stops, soonest first. CURRENT_DATE is the pooler's date; a share is a "where are they
      // today" glance, so a single day's worth of stops is the right granularity (and keeps it minimal).
      sql`
        SELECT title, place_name, iana_zone, start_ts, kind, status
        FROM itinerary_items
        WHERE user_id = ${userId} AND day = CURRENT_DATE
        ORDER BY start_ts ASC NULLS LAST, created_at ASC`,
    ]);

    // dest + a friendly owner name come from the onboarding JSON blob. There is no dedicated owner-name
    // column, so we fall back through the answers we DO have, then to a generic, never an email.
    const answers: Record<string, unknown> =
      onboardingRows.length > 0 && onboardingRows[0].answers && typeof onboardingRows[0].answers === "object"
        ? (onboardingRows[0].answers as Record<string, unknown>)
        : {};
    const dest = strField(answers.dest);
    const ownerName = strField(answers.party) || "Your traveler";

    // The soonest active watch's state (or null when none is live). narrow() fails loud on a drifted enum
    // value — but this is a public path, so a throw here is caught by the outer try and becomes null.
    const state: WatchState | null =
      watchRows.length === 0 ? null : narrow(watchRows[0].state, WATCH_STATES, "watches.state");

    const stops: StopRow[] = stopRows.map((r) => ({
      title: String(r.title),
      placeName: String(r.place_name),
      ianaZone: String(r.iana_zone),
      startTs: r.start_ts === null ? null : toIso(r.start_ts),
      // narrow() not used for kind/status here: an item's coarse kind/status is non-load-bearing for the
      // share view, so a drifted value should degrade (isItemKind guard) rather than 404 the whole link.
      kind: isItemKind(r.kind) ? r.kind : "other",
      status: String(r.status),
    }));

    // 3. Shape the timeline + derive the friendly headline/sub. The "now" row is the first not-yet-done
    //    stop (the next thing happening); everything before it reads as done.
    const steps = buildSteps(stops);
    const nextStop = stops.find((s) => !isDone(s.status)) ?? null;
    const nextItem: NextItem = nextStop
      ? {
          title: nextStop.title,
          placeName: nextStop.placeName,
          when: formatInZone(nextStop.startTs, nextStop.ianaZone, "weekday-24h"),
        }
      : null;

    const { headline, sub } = deriveSharedStatus(state, dest, ownerName, nextItem);

    return {
      ownerName,
      dest,
      state,
      headline,
      sub,
      steps,
      updatedAt: formatInZone(new Date().toISOString(), zoneOf(stops), "datetime-24h"),
    };
  } catch (e) {
    // Public path: never surface an error to a logged-out viewer. Log for the owner-facing operators.
    console.error("[share] loadSharedStatus failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * The current non-revoked share token for the authenticated owner, or null. This is the OWNER's READ —
 * it lives here in queries.ts (directiveless), NOT in actions.ts, so it can be called from a Server
 * Component and keep cookie context. The most recently created active token wins (one effective link).
 *
 * Implemented with the raw db() pooler scoped by an EXPLICIT user_id the caller passes in (the owner's
 * uid from getCurrentUser()): the public read path already uses db(), and keeping both reads on one
 * client avoids a second auth round-trip. RLS is bypassed by the pooler, so scoping is the WHERE clause's
 * job — callers must pass their own verified uid and nothing else.
 */
export async function loadActiveShareToken(userId: string): Promise<string | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT token FROM trip_shares
      WHERE user_id = ${userId} AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`;
    return rows.length === 0 ? null : String(rows[0].token);
  } catch (e) {
    console.error("[share] loadActiveShareToken failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Map the day's stops into render-ready steps, marking the first not-yet-done stop as "now". */
function buildSteps(stops: StopRow[]): SharedStep[] {
  const nowIndex = stops.findIndex((s) => !isDone(s.status));
  return stops.map((s, i) => ({
    title: s.title,
    detail: s.placeName,
    when: formatInZone(s.startTs, s.ianaZone, "weekday-24h"),
    done: isDone(s.status),
    now: i === nowIndex,
  }));
}

/** A stop is "done" when completed (missed/rescheduled read as not-current for the family glance). */
function isDone(status: string): boolean {
  return status === "completed";
}

/** Trim a possibly-non-string answers field to a clean string ("" when absent). */
function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Pick a zone for the "updated at" footer — the first stop's zone, or UTC when there are no stops. */
function zoneOf(stops: StopRow[]): string {
  return stops.length > 0 ? stops[0].ianaZone : "UTC";
}

/** Normalize a driver timestamp (Date | string) to a UTC ISO string for the contract boundary. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
