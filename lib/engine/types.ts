/**
 * Core engine domain types. Frozen in the Step 2 contract pass.
 *
 * Instants are UTC ISO-8601 strings ("...Z") at the contract boundary — serializable and
 * unambiguous. The commitment is the one exception: a local wall-time + IANA zone, resolved
 * to an instant only during the collision computation (R17).
 */

/** A timed, place-anchored commitment. */
export interface Commitment {
  /** Local wall-time at the place, no offset, e.g. "2026-12-20T20:00:00". */
  localWallTime: string;
  /** IANA zone of the geocoded place, e.g. "Europe/Madrid". */
  ianaZone: string;
  /** How early the traveler must be there, in minutes. */
  marginMinutes: number;
  reschedulable: boolean;
}

export type FlightStatus =
  | "scheduled"
  | "active"
  | "landed"
  | "cancelled"
  | "diverted"
  | "unknown";

/** Flight arrival facts. All instants are UTC ISO. predicted is null pre-data; actual is null pre-landing. */
export interface FlightArrival {
  scheduledUtc: string | null;
  /** AeroDataBox revisedTime.utc — the prediction. */
  predictedUtc: string | null;
  /** AeroDataBox runwayTime.utc — the actual, post-landing. */
  actualUtc: string | null;
  status: FlightStatus;
  /** IATA/ICAO arrival airport; a change signals a diversion. */
  arrivalAirport: string;
  /** Data-derived fingerprint of the load-bearing fields (predicted + status + airport). */
  revision: string;
}

/** Resolution of the place string to coordinates + zone + transit (U4). */
export interface PlaceResolution {
  label: string;
  lat: number | null;
  lng: number | null;
  ianaZone: string | null;
  /** Geocode succeeded with adequate confidence — gates "thesis-exercising". */
  placeResolved: boolean;
  transitMinutes: number;
  transitSource: "osrm" | "manual_buffer";
  reason: "ok" | "geocode_miss" | "ambiguous" | "unroutable";
}

export type Verdict = "make" | "miss" | "indeterminate";

/** Inputs to one collision computation. Durations in minutes. */
export interface CollisionInput {
  /** UTC ISO predicted arrival at the airport; null => indeterminate verdict. */
  predictedArrivalUtc: string | null;
  egressMinutes: number;
  transitMinutes: number;
  commitment: Commitment;
  /** "now" as a UTC instant — for lead-time and en-route reasoning. */
  nowUtc: string;
}

export interface CollisionResult {
  verdict: Verdict;
  /** Projected arrival-at-place instant (UTC ISO); null when indeterminate. */
  projectedAtPlaceUtc: string | null;
  /** Positive = slack, negative = deficit, in minutes; null when indeterminate. */
  slackMinutes: number | null;
  /** Minutes until the traveler must leave the airport to make it; null when indeterminate. */
  leadMinutes: number | null;
}

/** The frozen collision-core signature U2 implements (test-first). */
export type DetectCollision = (input: CollisionInput) => CollisionResult;

/** State-machine states (U6). */
export type WatchState =
  | "OK"
  | "AT_RISK"
  | "MISS_PREDICTED"
  | "RECOVERED"
  | "DEGRADED"
  | "CANCELLED"
  | "DEFINITE_MISS"
  | "LANDED_CAPTURE";

/** Notification kinds emitted on a firing transition. */
export type FiredKind = "CATCH" | "ALL_CLEAR" | "CANNOT_CONFIRM" | "DEFINITE_MISS" | "CANCELLED";
