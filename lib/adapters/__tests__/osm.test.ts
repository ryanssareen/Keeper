import { describe, it, expect } from "vitest";
import {
  buildGeocodeUrl,
  parseGeocode,
  zoneFor,
  parseDirectionsMinutes,
} from "@/lib/adapters/osm";

describe("osm geocoding (Nominatim)", () => {
  it("encodes specials and caps an over-long query", () => {
    expect(buildGeocodeUrl("a b")).toContain("a%20b"); // space encoded, never raw
    const long = buildGeocodeUrl("x".repeat(500));
    const q = new URL(long).searchParams.get("q") ?? "";
    expect(q.length).toBe(200); // capped pre-encode
  });

  it("parses the first hit; null on zero results or malformed", () => {
    expect(parseGeocode([{ lat: "41.40", lon: "2.17", importance: 0.7 }])).toEqual({
      lat: 41.4,
      lng: 2.17,
      confident: true,
    });
    expect(parseGeocode([])).toBeNull();
    expect(parseGeocode([{ lat: "x", lon: "y" }])).toBeNull();
    expect(parseGeocode("nope")).toBeNull();
  });

  it("flags a low-importance hit as not confident (ambiguous)", () => {
    expect(parseGeocode([{ lat: "41.4", lon: "2.17", importance: 0.1 }])?.confident).toBe(false);
  });

  it("derives the IANA zone from coordinates", () => {
    expect(zoneFor(41.4, 2.17)).toBe("Europe/Madrid"); // Barcelona
    expect(zoneFor(40.69, -74.04).startsWith("America/")).toBe(true); // NYC
  });
});

describe("osm routing (OSRM)", () => {
  it("parses driving duration to minutes", () => {
    expect(parseDirectionsMinutes({ code: "Ok", routes: [{ duration: 1530 }] })).toBe(26);
  });

  it("returns null for no route / non-Ok / malformed", () => {
    expect(parseDirectionsMinutes({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseDirectionsMinutes({ code: "Ok", routes: [] })).toBeNull();
    expect(parseDirectionsMinutes(null)).toBeNull();
  });
});
