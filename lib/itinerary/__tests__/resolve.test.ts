import { describe, it, expect, vi } from "vitest";
import { assessGeocodeHit, assessPhotonHit, resolveCandidates } from "@/lib/itinerary/resolve";
import type { CandidatePlan } from "@/lib/itinerary/generate";

// A real, low-importance POI hit (the U0 regression: importance ~0 but a genuine place).
const teamLabHit = [
  { lat: "35.6256", lon: "139.7756", name: "teamLab Borderless", display_name: "teamLab Borderless, Aomi, Koto, Tokyo", importance: 0.00009 },
];

describe("assessGeocodeHit — geocode-success, not importance (U0 fix)", () => {
  it("KEEPS a real POI that resolves at importance ~0 (the regression U0 caught)", () => {
    const hit = assessGeocodeHit("teamLab Borderless", teamLabHit);
    expect(hit).toEqual({ lat: 35.6256, lng: 139.7756 });
  });

  it("drops a zero-result and a coordinate-less response", () => {
    expect(assessGeocodeHit("Nowhere", [])).toBeNull();
    expect(assessGeocodeHit("Nowhere", [{ name: "x", display_name: "x" }])).toBeNull();
  });

  it("drops a clearly-wrong match (no name-token overlap, Latin query)", () => {
    const wrong = [{ lat: "19.4", lon: "-99.1", name: "Calle Falsa", display_name: "Calle Falsa, Centro" }];
    expect(assessGeocodeHit("Pujol", wrong)).toBeNull();
  });

  it("accepts a correctly-named match regardless of importance", () => {
    const right = [{ lat: "19.41", lon: "-99.17", name: "Pujol", display_name: "Pujol, Polanco, CDMX", importance: 0 }];
    expect(assessGeocodeHit("Pujol", right)).toEqual({ lat: 19.41, lng: -99.17 });
  });

  it("accepts on geocode-success alone when the query has no Latin tokens to match", () => {
    const jp = [{ lat: "35.65", lon: "139.74", name: "東京タワー", display_name: "..." }];
    expect(assessGeocodeHit("東京", jp)).toEqual({ lat: 35.65, lng: 139.74 });
  });

  it("keeps a CJK place whose geocoded result is ROMANIZED (no token overlap) — script detection, not the U0 drop", () => {
    // Old code: "東京タワー" forms a >=4-char token, romanized "Tokyo Tower" has no overlap -> dropped.
    const romanized = [{ lat: "35.6586", lon: "139.7454", name: "Tokyo Tower", display_name: "Tokyo Tower, Minato, Tokyo" }];
    expect(assessGeocodeHit("東京タワー", romanized)).toEqual({ lat: 35.6586, lng: 139.7454 });
  });
});

describe("assessPhotonHit — same acceptance against Photon GeoJSON ([lon, lat] coords)", () => {
  it("accepts a correctly-named Photon feature and maps [lon,lat] → {lat,lng}", () => {
    const fc = { features: [{ geometry: { coordinates: [-9.216, 38.6916] }, properties: { name: "Torre de Belém", city: "Lisboa", country: "Portugal" } }] };
    expect(assessPhotonHit("Torre de Belém", fc)).toEqual({ lat: 38.6916, lng: -9.216 });
  });

  it("drops empty collections and clearly-wrong Latin matches", () => {
    expect(assessPhotonHit("Pujol", { features: [] })).toBeNull();
    expect(assessPhotonHit("Pujol", {})).toBeNull();
    const wrong = { features: [{ geometry: { coordinates: [-99.1, 19.4] }, properties: { name: "Calle Falsa" } }] };
    expect(assessPhotonHit("Pujol", wrong)).toBeNull();
  });

  it("accepts a non-Latin query on geocode-success alone", () => {
    const fc = { features: [{ geometry: { coordinates: [139.7454, 35.6586] }, properties: { name: "Tokyo Tower" } }] };
    expect(assessPhotonHit("東京タワー", fc)).toEqual({ lat: 35.6586, lng: 139.7454 });
  });
});

const plan: CandidatePlan = {
  days: [
    { date: "2026-06-09", places: [
      { name: "Belém Tower", localName: "Torre de Belém", kind: "sight" },
      { name: "Made-up place", localName: "Made-up place", kind: "food" },
    ] },
    { date: "2026-06-10", places: [
      { name: "Belém Tower again", localName: "Torre de Belém", kind: "sight" }, // same place → cache hit
    ] },
  ],
};

describe("resolveCandidates — keeps monitorable, drops unresolved, caches", () => {
  it("maps resolved candidates to monitorable items and counts drops", async () => {
    const geocode = vi.fn(async (localName: string) =>
      localName === "Torre de Belém" ? { lat: 38.6916, lng: -9.216 } : null,
    );
    const { items, dropped } = await resolveCandidates(plan, "Lisbon", { geocode, rateMs: 0 });

    expect(items).toHaveLength(2); // two Torre de Belém entries resolve
    expect(items[0]).toMatchObject({ title: "Belém Tower", placeName: "Torre de Belém", kind: "sight", day: "2026-06-09" });
    expect(items[0]!.ianaZone).toBe("Europe/Lisbon");
    expect(dropped).toBe(1); // the made-up place
    // Same place across two days geocoded once (cache hit on the second).
    expect(geocode).toHaveBeenCalledTimes(2);
  });

  it("returns an empty result (no crash) when everything drops", async () => {
    const geocode = vi.fn(async () => null);
    const { items, dropped } = await resolveCandidates(plan, "Lisbon", { geocode, rateMs: 0 });
    expect(items).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it("caps total geocodes so a long trip can't blow the time budget", async () => {
    // 60 unique candidates across days; geocoder must be called at most the cap (40), rest dropped.
    const bigPlan: CandidatePlan = {
      days: [{ date: "2026-06-09", places: Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, localName: `Place ${i}`, kind: "sight" as const })) }],
    };
    const geocode = vi.fn(async () => ({ lat: 38.7, lng: -9.1 }));
    const { items, dropped } = await resolveCandidates(bigPlan, "Lisbon", { geocode, rateMs: 0 });
    expect(geocode.mock.calls.length).toBeLessThanOrEqual(40);
    expect(items.length + dropped).toBe(60); // every candidate accounted for (kept or dropped)
    expect(dropped).toBeGreaterThanOrEqual(20);
  });
});
