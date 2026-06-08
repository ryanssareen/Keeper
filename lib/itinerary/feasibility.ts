import { toInstant } from "@/lib/engine/time";
import { ITINERARY } from "@/lib/itinerary/constants";
import type { MonitorableItem } from "@/lib/itinerary/itinerary";

/**
 * Plan-time feasibility / seam checker (U5) — pure, no I/O. Reconciliation applied at plan-time: flag
 * fragile seams as ADVISORIES (detect-and-advise, never auto-fix). v1 estimates transit from
 * straight-line (haversine) distance — flagged as approximate; the tiered OSRM precision path is a
 * follow-up (needs a new routeMinutes export from osm.ts). Reuses lib/engine/time for instant math.
 */

export type Advisory = {
  kind: "tight_transfer" | "over_packed" | "short_stay";
  day: string;
  message: string;
  fromTitle?: string;
  toTitle?: string;
};

const R_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Approximate transit minutes between two points (haversine-only, v1). */
export function estimateTransitMinutes(km: number): number {
  return Math.round((km / ITINERARY.transitSpeedKmh) * 60 + ITINERARY.transitBaseMinutes);
}

const minutesBetween = (aIso: string, bIso: string): number =>
  toInstant(bIso).diff(toInstant(aIso), "minutes").minutes;

/**
 * Examine a scheduled item set (each carries startTs/endTs + coords) and return advisories for tight
 * transfers, over-packed days, and too-short stops. Items without times are ignored (unschedulable).
 */
export function checkFeasibility(items: MonitorableItem[]): Advisory[] {
  const advisories: Advisory[] = [];
  const byDay = new Map<string, MonitorableItem[]>();
  for (const it of items) {
    const list = byDay.get(it.day) ?? [];
    list.push(it);
    byDay.set(it.day, list);
  }

  for (const [day, dayItems] of byDay) {
    if (dayItems.length > ITINERARY.maxItemsPerDay) {
      advisories.push({
        kind: "over_packed",
        day,
        message: `${dayItems.length} stops on one day is a lot — consider trimming to ~${ITINERARY.maxItemsPerDay}.`,
      });
    }

    const scheduled = dayItems
      .filter((i) => i.startTs && i.endTs)
      .sort((a, b) => (a.startTs! < b.startTs! ? -1 : 1));

    for (const it of scheduled) {
      const stay = minutesBetween(it.startTs!, it.endTs!);
      if (stay < ITINERARY.minStayMinutes) {
        advisories.push({
          kind: "short_stay",
          day,
          toTitle: it.title,
          message: `Only ${Math.round(stay)} min at ${it.title} — that may be too short.`,
        });
      }
    }

    for (let i = 0; i < scheduled.length - 1; i += 1) {
      const a = scheduled[i]!;
      const b = scheduled[i + 1]!;
      const gap = minutesBetween(a.endTs!, b.startTs!);
      const transit = estimateTransitMinutes(haversineKm(a.lat, a.lng, b.lat, b.lng));
      const slack = gap - transit;
      if (slack < ITINERARY.transferSlackMarginMinutes) {
        advisories.push({
          kind: "tight_transfer",
          day,
          fromTitle: a.title,
          toTitle: b.title,
          message: `Tight: ~${Math.round(gap)} min to cover an estimated ~${transit} min hop from ${a.title} to ${b.title} (approx).`,
        });
      }
    }
  }

  return advisories;
}
