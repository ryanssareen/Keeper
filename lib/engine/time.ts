import { DateTime } from "luxon";

/** Parse a UTC ISO instant. */
export function toInstant(utcIso: string): DateTime {
  return DateTime.fromISO(utcIso, { zone: "utc" });
}

/**
 * Resolve a local wall-time in an IANA zone to an instant (DST-correct).
 * The string carries no offset; the zone supplies it via current tz rules.
 */
export function resolveLocal(localWallTime: string, ianaZone: string): DateTime {
  return DateTime.fromISO(localWallTime, { zone: ianaZone });
}
