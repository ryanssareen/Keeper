// Client-safe share types + the PURE status-deriving helper. NO server imports here — this module is
// pulled into the browser bundle by the read-only "Shared with family" page, so the db() pooler and the
// node:crypto token mint live in queries.ts / actions.ts instead (the documented module-boundary rule).
//
// What a share surfaces is deliberately NARROW: a friendly, redacted read-only status (who, where, a
// one-line headline + sub, and a tiny day timeline). It never carries tokens, emails, flight numbers, or
// document contents — those are stripped at the query boundary, and this type has no field to hold them.
import type { WatchState } from "@/lib/engine/types";

/** One step in the shared mini-timeline: a single itinerary stop, flattened for a logged-out viewer. */
export type SharedStep = {
  title: string;
  detail: string;
  /** Pre-formatted local wall-time (e.g. "14:30"), or "" for an all-day / untimed stop. */
  when: string;
  done: boolean;
  /** The one stop happening "now" / next — drives the single highlighted row. */
  now: boolean;
};

/** The complete, render-ready, redacted status a share token resolves to. Safe to ship to the browser. */
export type SharedStatus = {
  ownerName: string;
  dest: string;
  /** The soonest active watch's state, or null when the owner has no live watch. */
  state: WatchState | null;
  headline: string;
  sub: string;
  steps: SharedStep[];
  /** Pre-formatted "last updated" wall-time for the footer. */
  updatedAt: string;
};

/** The minimal next-stop shape the pure deriver reads — a flattened itinerary item, no row identity. */
export type NextItem = {
  title: string;
  placeName: string;
  /** Pre-formatted local wall-time (e.g. "Sat, 14:30"), or "" when untimed. */
  when: string;
} | null;

/**
 * PURE: derive the friendly headline + sub from a watch state, the destination, the owner's name, and
 * (optionally) the next itinerary stop. No IO, no clock — exhaustively unit-tested across watch states.
 *
 * The wording is reassurance-first and family-facing: it answers "are they OK / on track?" without
 * exposing flight numbers, predicted instants, or any of the engine's internal vocabulary. A null state
 * (no live watch) reads as a calm "planning / no active travel" rather than an error. Every known
 * WatchState has an explicit branch; an unmapped value falls through to a safe generic line (never throws
 * on a render path).
 */
export function deriveSharedStatus(
  state: WatchState | null,
  dest: string,
  ownerName: string,
  nextItem: NextItem,
): { headline: string; sub: string } {
  const who = ownerName.trim() || "Your traveler";
  const where = dest.trim() || "their trip";
  const next = nextItem ? nextStopClause(nextItem) : "";

  // No live watch — they're between flights / still planning. Keep it calm and non-alarming.
  if (state === null) {
    return {
      headline: `${who} is planning ${where}`,
      sub: next || "Nothing on the move right now — check back closer to travel day.",
    };
  }

  switch (state) {
    case "OK":
      return {
        headline: `${who} is on track in ${where}`,
        sub: next || "Everything looks good — no delays expected.",
      };
    case "AT_RISK":
      return {
        headline: `${who}'s timing is getting tight`,
        sub: next || "Running a little behind — they may be cutting it close.",
      };
    case "MISS_PREDICTED":
      return {
        headline: `${who} may be running late in ${where}`,
        sub: next || "The next plan might slip — they're aware and adjusting.",
      };
    case "RECOVERED":
      return {
        headline: `${who} is back on track`,
        sub: next || "Things settled down — they're good for what's next.",
      };
    case "DEGRADED":
      return {
        headline: `${who}'s status is unconfirmed`,
        sub: next || "We can't confirm the latest just now — no news isn't bad news.",
      };
    case "CANCELLED":
      return {
        headline: `${who}'s flight was cancelled`,
        sub: "They're sorting out a new plan — this status will update once it's set.",
      };
    case "DEFINITE_MISS":
      return {
        headline: `${who} won't make the next plan in time`,
        sub: next || "They're rearranging the schedule — nothing to worry about.",
      };
    case "LANDED_CAPTURE":
      return {
        headline: `${who} has landed in ${where}`,
        sub: next || "On the ground and on their way.",
      };
    default:
      // Unknown/drifted state — never throw on the render path; give a safe, neutral line.
      return {
        headline: `${who} is travelling to ${where}`,
        sub: next || "Follow along here for updates.",
      };
  }
}

/** Friendly "next up" sentence for a stop, used as the sub when we have a concrete next item. */
function nextStopClause(item: NonNullable<NextItem>): string {
  const place = item.placeName.trim() || item.title.trim();
  if (!place) return "";
  return item.when.trim() ? `Next up: ${place} at ${item.when.trim()}.` : `Next up: ${place}.`;
}
