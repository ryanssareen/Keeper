import { DateTime } from "luxon";
import { toInstant } from "@/lib/engine/time";
import type { MonitorableItem } from "@/lib/itinerary/itinerary";
import type { OnboardingAnswers } from "@/lib/onboarding/actions";

/**
 * Booking-envelope enforcement (U4) — pure, no I/O, clock-free (all instants passed in), so the whole
 * matrix is TZ-independent like lib/engine. It (1) derives the trip date range defensively from the
 * free-text onboarding strings, and (2) places each day's items on a local-time schedule that respects
 * the immovable booking anchors: nothing before wheels-down + buffer on the arrival day, nothing past
 * departure − buffer on the last day, nothing outside the date range. Over-packed overflow is dropped
 * (U5 advises on tightness; the envelope is the hard floor).
 */

const DAY_START_HOUR = 9;
const DAY_END_HOUR = 19;
const SLOT_MIN = 90;
const GAP_MIN = 30;
const ARRIVAL_BUFFER_MIN = 75; // deplane + reach the city before the first activity
const DEPARTURE_BUFFER_MIN = 180; // leave for the airport before departure

const parseDate = (s?: string | null): string | null => {
  if (!s) return null;
  const dt = DateTime.fromISO(s);
  return dt.isValid ? dt.toISODate() : null;
};

/** Derive the trip date range from hotel dates, falling back to the flight date; null when fully sparse. */
export function deriveTripDates(
  answers: Partial<OnboardingAnswers>,
): { startDate: string; endDate: string; assumed: string[] } | null {
  const assumed: string[] = [];
  const hin = parseDate(answers.hotelIn);
  const hout = parseDate(answers.hotelOut);
  const fdate = parseDate(answers.flightDate);

  if (hin && hout) return { startDate: hin, endDate: hout, assumed };
  if (hin) {
    assumed.push("trip end (no checkout date — assumed +2 days)");
    return { startDate: hin, endDate: DateTime.fromISO(hin).plus({ days: 2 }).toISODate()!, assumed };
  }
  if (fdate) {
    assumed.push("trip dates (only a flight date — assumed a 3-day trip)");
    return { startDate: fdate, endDate: DateTime.fromISO(fdate).plus({ days: 2 }).toISODate()!, assumed };
  }
  return null;
}

export type EnvelopeSpec = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  ianaZone: string; // trip-local zone for day boundaries
  arrivalInstant?: string | null; // UTC ISO wheels-down (raw FlightArrival, not the view-model string)
  departureInstant?: string | null; // UTC ISO departure on the last day
  assumed?: string[];
};

/** Place items on each day's timeline within the envelope; returns scheduled items + a drop count. */
export function scheduleWithinEnvelope(
  items: MonitorableItem[],
  env: EnvelopeSpec,
): { scheduled: MonitorableItem[]; dropped: number; assumed: string[] } {
  const zone = env.ianaZone;
  const start = DateTime.fromISO(env.startDate, { zone });
  const end = DateTime.fromISO(env.endDate, { zone });
  const assumed = env.assumed ?? [];
  if (!start.isValid || !end.isValid) return { scheduled: [], dropped: items.length, assumed };

  const arrivalLocal = env.arrivalInstant ? toInstant(env.arrivalInstant).setZone(zone) : null;
  const departureLocal = env.departureInstant ? toInstant(env.departureInstant).setZone(zone) : null;
  const arrivalDate = arrivalLocal?.toISODate() ?? null;
  const departureDate = departureLocal?.toISODate() ?? null;

  const inRange = (d: string): boolean => {
    const dt = DateTime.fromISO(d, { zone });
    return dt.isValid && dt.startOf("day") >= start.startOf("day") && dt.startOf("day") <= end.startOf("day");
  };

  const byDay = new Map<string, MonitorableItem[]>();
  let dropped = 0;
  for (const it of items) {
    if (!inRange(it.day)) {
      dropped += 1;
      continue;
    }
    const list = byDay.get(it.day) ?? [];
    list.push(it);
    byDay.set(it.day, list);
  }

  const scheduled: MonitorableItem[] = [];
  for (const [day, dayItems] of byDay) {
    const base = DateTime.fromISO(day, { zone });
    let floor = base.set({ hour: DAY_START_HOUR, minute: 0, second: 0, millisecond: 0 });
    if (day === arrivalDate && arrivalLocal) {
      const after = arrivalLocal.plus({ minutes: ARRIVAL_BUFFER_MIN });
      if (after > floor) floor = after;
    }
    let ceiling = base.set({ hour: DAY_END_HOUR, minute: 0, second: 0, millisecond: 0 });
    if (day === departureDate && departureLocal) {
      const before = departureLocal.minus({ minutes: DEPARTURE_BUFFER_MIN });
      if (before < ceiling) ceiling = before;
    }

    let cursor = floor;
    for (const it of dayItems) {
      const endT = cursor.plus({ minutes: SLOT_MIN });
      if (endT > ceiling) {
        dropped += 1; // doesn't fit the day's envelope (over-packed / past the booking edge)
        continue;
      }
      scheduled.push({ ...it, startTs: cursor.toUTC().toISO()!, endTs: endT.toUTC().toISO()! });
      cursor = endT.plus({ minutes: GAP_MIN });
    }
  }
  return { scheduled, dropped, assumed };
}
