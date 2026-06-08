import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { deriveTripDates, scheduleWithinEnvelope, type EnvelopeSpec } from "@/lib/itinerary/envelope";
import type { MonitorableItem } from "@/lib/itinerary/itinerary";

const ZONE = "Europe/Lisbon";
const item = (day: string, title = "X"): MonitorableItem => ({
  title,
  placeName: title,
  lat: 38.7,
  lng: -9.1,
  ianaZone: ZONE,
  kind: "sight",
  day,
  startTs: null,
  endTs: null,
});

const localHour = (utcIso: string): number => DateTime.fromISO(utcIso, { zone: "utc" }).setZone(ZONE).hour;

describe("deriveTripDates — defensive against free-text onboarding strings", () => {
  it("uses hotel check-in/out when both parse", () => {
    expect(deriveTripDates({ hotelIn: "2026-06-09", hotelOut: "2026-06-12" })).toEqual({
      startDate: "2026-06-09",
      endDate: "2026-06-12",
      assumed: [],
    });
  });

  it("assumes an end when only check-in is present", () => {
    const r = deriveTripDates({ hotelIn: "2026-06-09" });
    expect(r?.startDate).toBe("2026-06-09");
    expect(r?.endDate).toBe("2026-06-11");
    expect(r?.assumed.length).toBe(1);
  });

  it("falls back to the flight date, then to null when fully sparse", () => {
    expect(deriveTripDates({ flightDate: "2026-06-09" })?.assumed.length).toBe(1);
    expect(deriveTripDates({ flightDate: "next Tuesday", hotelIn: "" })).toBeNull();
    expect(deriveTripDates({})).toBeNull();
  });
});

describe("scheduleWithinEnvelope", () => {
  const env: EnvelopeSpec = { startDate: "2026-06-09", endDate: "2026-06-10", ianaZone: ZONE };

  it("assigns sequential local-time slots and keeps in-range items", () => {
    const { scheduled, dropped } = scheduleWithinEnvelope([item("2026-06-09", "A"), item("2026-06-09", "B")], env);
    expect(scheduled).toHaveLength(2);
    expect(dropped).toBe(0);
    expect(localHour(scheduled[0]!.startTs!)).toBe(9); // day starts at 09:00 local
    expect(scheduled[1]!.startTs! > scheduled[0]!.startTs!).toBe(true);
  });

  it("drops items on days outside the trip range", () => {
    const { scheduled, dropped } = scheduleWithinEnvelope([item("2026-06-15")], env);
    expect(scheduled).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("pushes the arrival day's first item to after wheels-down + buffer", () => {
    // Arrival 13:00 local (12:00 UTC in summer Lisbon) → first item no earlier than ~14:15 local.
    const arr = DateTime.fromISO("2026-06-09T13:00", { zone: ZONE }).toUTC().toISO()!;
    const { scheduled } = scheduleWithinEnvelope([item("2026-06-09")], { ...env, arrivalInstant: arr });
    expect(localHour(scheduled[0]!.startTs!)).toBeGreaterThanOrEqual(14);
  });

  it("drops over-packed overflow that won't fit the day", () => {
    // Arrival 17:00 local leaves only ~1h45 before the 19:00 day end → at most one 90-min slot.
    const arr = DateTime.fromISO("2026-06-09T17:00", { zone: ZONE }).toUTC().toISO()!;
    const items = [item("2026-06-09", "A"), item("2026-06-09", "B"), item("2026-06-09", "C")];
    const { scheduled, dropped } = scheduleWithinEnvelope(items, { ...env, arrivalInstant: arr });
    expect(scheduled.length).toBeLessThan(3);
    expect(dropped).toBeGreaterThan(0);
  });
});
