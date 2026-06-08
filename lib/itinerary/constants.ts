/**
 * Itinerary feasibility tuning. Deliberately NOT in lib/engine/constants.ts — the engine's ENGINE
 * object is reconcile-loop tuning (egress, poll cadence) and has no transfer/over-packed/min-stay
 * bands (the U0/review finding). These are the itinerary's own thresholds.
 */
export const ITINERARY = {
  /** v1 transit estimate from straight-line distance: km / speed + a fixed base (haversine-only — the
   *  tiered OSRM precision path is a follow-up). Conservative urban average. */
  transitSpeedKmh: 25,
  transitBaseMinutes: 8,
  /** A transfer whose slack (gap − estimated transit) falls below this reads as a "tight" seam. */
  transferSlackMarginMinutes: 10,
  /** More items than this on one day reads as over-packed. */
  maxItemsPerDay: 6,
  /** An item shorter than this reads as a too-brief stop. */
  minStayMinutes: 30,
} as const;
