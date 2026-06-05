import type { Commitment } from "./types";
import { resolveLocal, toInstant } from "./time";

export type ArmValidation =
  | { ok: true; commitmentInstantUtc: string }
  | { ok: false; reason: string };

/**
 * Validate an arm request's commitment (R19). Rejects an unparseable time/zone, a past commitment,
 * and a commitment that precedes the earliest instant the flight could deliver the traveler to the
 * place. Returns the resolved commitment instant for storage.
 */
export function validateArm(
  commitment: Commitment,
  nowUtc: string,
  earliestFeasibleArrivalUtc: string | null,
): ArmValidation {
  const deadline = resolveLocal(commitment.localWallTime, commitment.ianaZone);
  if (!deadline.isValid) {
    return { ok: false, reason: "Invalid commitment time or zone." };
  }
  const now = toInstant(nowUtc);
  if (deadline.toMillis() <= now.toMillis()) {
    return { ok: false, reason: "Commitment is in the past." };
  }
  if (earliestFeasibleArrivalUtc) {
    const earliest = toInstant(earliestFeasibleArrivalUtc);
    if (earliest.isValid && deadline.toMillis() < earliest.toMillis()) {
      return { ok: false, reason: "Commitment is before the flight could possibly get you there." };
    }
  }
  return { ok: true, commitmentInstantUtc: deadline.toUTC().toISO() as string };
}
