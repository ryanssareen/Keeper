import { describe, it, expect } from "vitest";
import { haversineKm, estimateTransitMinutes, checkFeasibility } from "@/lib/itinerary/feasibility";
import type { MonitorableItem } from "@/lib/itinerary/itinerary";

const it1 = (over: Partial<MonitorableItem>): MonitorableItem => ({
  title: "X",
  placeName: "X",
  lat: 38.7,
  lng: -9.1,
  ianaZone: "Europe/Lisbon",
  kind: "sight",
  day: "2026-06-09",
  startTs: null,
  endTs: null,
  ...over,
});

describe("haversine + transit estimate", () => {
  it("computes a plausible great-circle distance and transit time", () => {
    // ~5 km apart in Lisbon.
    const km = haversineKm(38.7, -9.1, 38.74, -9.15);
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(8);
    expect(estimateTransitMinutes(5)).toBeGreaterThan(0);
  });
});

describe("checkFeasibility — detect-and-advise", () => {
  it("flags a tight transfer when the gap is shorter than the hop", () => {
    const a = it1({ title: "A", lat: 38.69, lng: -9.21, startTs: "2026-06-09T08:00:00Z", endTs: "2026-06-09T09:00:00Z" });
    const b = it1({ title: "B", lat: 38.74, lng: -9.14, startTs: "2026-06-09T09:08:00Z", endTs: "2026-06-09T10:00:00Z" }); // 8-min gap, ~7km
    const adv = checkFeasibility([a, b]);
    expect(adv.some((x) => x.kind === "tight_transfer" && x.fromTitle === "A" && x.toTitle === "B")).toBe(true);
  });

  it("passes a comfortable plan with no advisories", () => {
    const a = it1({ title: "A", lat: 38.7, lng: -9.1, startTs: "2026-06-09T08:00:00Z", endTs: "2026-06-09T09:30:00Z" });
    const b = it1({ title: "B", lat: 38.705, lng: -9.105, startTs: "2026-06-09T11:00:00Z", endTs: "2026-06-09T12:30:00Z" }); // 90-min gap, ~0.7km
    expect(checkFeasibility([a, b])).toHaveLength(0);
  });

  it("flags an over-packed day", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      it1({ title: `A${i}`, startTs: `2026-06-09T0${i}:00:00Z`, endTs: `2026-06-09T0${i}:40:00Z` }),
    );
    expect(checkFeasibility(many).some((x) => x.kind === "over_packed")).toBe(true);
  });

  it("flags a too-short stop", () => {
    const a = it1({ title: "Quick", startTs: "2026-06-09T08:00:00Z", endTs: "2026-06-09T08:15:00Z" }); // 15 min
    expect(checkFeasibility([a]).some((x) => x.kind === "short_stay" && x.toTitle === "Quick")).toBe(true);
  });

  it("ignores unscheduled (timeless) items", () => {
    expect(checkFeasibility([it1({ title: "Z" })])).toHaveLength(0);
  });
});
