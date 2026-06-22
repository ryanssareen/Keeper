/* Client-safe leaf: the shape + derivation behind the live "catch" modal.
 *
 * A "catch" is a state-machine transition into a risk/miss state (see lib/engine). The modal is a
 * read-only, human-facing presentation of the freshest persisted prediction for the user's most
 * at-risk watch — flight delay, the threatened commitment, and the margin. It does NOT call the engine;
 * it reshapes a WatchView (already built from persisted snapshots) into display-ready strings, so it
 * carries no server imports and can be passed straight into the client modal. */

import type { WatchState } from "@/lib/engine/types";
import type { WatchView } from "@/lib/calibration/dashboard";

/** States that warrant surfacing a catch (a downstream commitment is threatened or missed). */
const CATCH_STATES: ReadonlySet<WatchState> = new Set([
  "AT_RISK",
  "MISS_PREDICTED",
  "DEFINITE_MISS",
]);

export interface CatchModel {
  watchId: string;
  state: WatchState;
  flightNumber: string;
  placeLabel: string;
  /** Collide-row labels. */
  flightNode: string; // e.g. "delayed" / "+90m late"
  transferNode: string; // e.g. "no slack" / "tight"
  commitmentNode: string; // e.g. "19:30 miss" / "19:30 at risk"
  /** Metrics row. */
  arriveByLabel: string; // projected arrival at the place
  commitmentLabel: string; // the commitment clock time
  marginMinutes: number | null; // slack; negative = deficit
  /** Copy. */
  live: boolean; // true → "Live · cascade detected"; false → all-clear
  headline: string;
  explanation: string;
  action: string;
}

function clock(iso: string | null, zone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone || "UTC",
    }).format(d);
  } catch {
    return "—";
  }
}

/**
 * Build the catch model for the modal, or null when nothing is at risk. `commitmentLabelOverride`
 * lets a caller pass a friendlier downstream-item name (e.g. "dinner") when one is known; otherwise
 * the watch's own place label is used.
 */
export function buildCatchModel(view: WatchView | null): CatchModel | null {
  if (!view || !CATCH_STATES.has(view.state)) return null;

  const latest = view.timeline[0] ?? null;
  const slack = latest?.slackMinutes ?? null;
  const zone = view.zone || "UTC";

  const commitment = view.commitmentInstantUtc;
  const commitmentLabel = clock(commitment, zone);

  // projected-arrival-at-place = commitment − slack (positive slack = arrive early).
  let arriveByLabel = "—";
  if (slack !== null && commitment) {
    const arriveBy = new Date(new Date(commitment).getTime() - slack * 60_000);
    arriveByLabel = clock(arriveBy.toISOString(), zone);
  }

  const missing = view.state === "MISS_PREDICTED" || view.state === "DEFINITE_MISS";
  const deficit = slack !== null && slack < 0 ? Math.abs(slack) : null;

  const flightArrival = latest?.predictedArrivalUtc
    ? `arriving ${clock(latest.predictedArrivalUtc, zone)}`
    : "running late";

  const headline = missing
    ? `You're about to miss ${view.placeLabel}.`
    : `${view.placeLabel} is at risk.`;

  const marginPhrase =
    deficit !== null
      ? `${deficit} min after`
      : slack !== null
        ? `${slack} min before`
        : "right up against";

  const explanation = missing
    ? `${view.flightNumber} is ${flightArrival}. You'd reach ${view.placeLabel} at ${arriveByLabel} — ${marginPhrase} your ${commitmentLabel} commitment.`
    : `${view.flightNumber} is ${flightArrival} and the margin to ${view.placeLabel} (${commitmentLabel}) has thinned. We're watching it closely.`;

  const action = view.reschedulable
    ? `Move the ${view.placeLabel} booking later, or call ahead so they hold your spot.`
    : `There's no later slot — go straight there and drop anything in between.`;

  return {
    watchId: view.id,
    state: view.state,
    flightNumber: view.flightNumber,
    placeLabel: view.placeLabel,
    flightNode: deficit !== null ? `+${deficit}m late` : "late",
    transferNode: view.transitMinutes <= 15 ? "no slack" : "tight",
    commitmentNode: missing ? `${commitmentLabel} miss` : `${commitmentLabel} risk`,
    arriveByLabel,
    commitmentLabel,
    marginMinutes: slack,
    live: true,
    headline,
    explanation,
    action,
  };
}
