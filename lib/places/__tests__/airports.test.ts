import { describe, it, expect } from "vitest";
import { searchAirports } from "@/lib/places/airports";

describe("searchAirports", () => {
  it("returns nothing for an empty query", () => {
    expect(searchAirports("")).toEqual([]);
    expect(searchAirports("   ")).toEqual([]);
  });

  it("matches an exact IATA code first", () => {
    const r = searchAirports("LHR");
    expect(r[0]?.code).toBe("LHR");
    expect(r[0]?.city).toBe("London");
  });

  it("ranks a city-name prefix above a country match", () => {
    const r = searchAirports("Lisbon", 5);
    expect(r[0]?.city).toBe("Lisbon");
    expect(r[0]?.country).toBe("Portugal");
  });

  it("is case-insensitive and respects the limit", () => {
    const r = searchAirports("paris", 3);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.some((a) => a.city === "Paris")).toBe(true);
  });

  it("returns entries carrying a real 3-letter code, city and country", () => {
    for (const a of searchAirports("New York", 5)) {
      expect(a.code).toMatch(/^[A-Z]{3}$/);
      expect(a.city).toBeTruthy();
      expect(a.country).toBeTruthy();
    }
  });
});
