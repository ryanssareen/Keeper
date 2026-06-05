import type { CollisionInput, CollisionResult } from "./types";
import { resolveLocal, toInstant } from "./time";

/**
 * Deterministic collision verdict — the thesis core.
 * All arithmetic is on instants; durations are added to instants, never to wall-clocks, so DST,
 * overnight, and cross-zone cases reduce to instant comparison.
 */
export function detectCollision(input: CollisionInput): CollisionResult {
  const { predictedArrivalUtc, egressMinutes, transitMinutes, commitment, nowUtc } = input;

  // Deadline = the place's local wall-time resolved through its IANA zone, minus the arrival margin.
  const deadline = resolveLocal(commitment.localWallTime, commitment.ianaZone).minus({
    minutes: commitment.marginMinutes,
  });

  if (predictedArrivalUtc === null) {
    return {
      verdict: "indeterminate",
      projectedAtPlaceUtc: null,
      slackMinutes: null,
      leadMinutes: null,
    };
  }

  const projected = toInstant(predictedArrivalUtc).plus({
    minutes: egressMinutes + transitMinutes,
  });
  const slackMinutes = Math.round(deadline.diff(projected, "minutes").minutes);
  // Inclusive deadline: arriving exactly on time is a make.
  const verdict = projected.toMillis() > deadline.toMillis() ? "miss" : "make";

  // Lead = minutes from now until the latest the traveler can leave the airport and still make it.
  const mustLeave = deadline.minus({ minutes: transitMinutes });
  const leadMinutes = Math.round(mustLeave.diff(toInstant(nowUtc), "minutes").minutes);

  return {
    verdict,
    projectedAtPlaceUtc: projected.toUTC().toISO(),
    slackMinutes,
    leadMinutes,
  };
}
