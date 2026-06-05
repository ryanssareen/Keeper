import { describe, expect, it } from "vitest";

import {
  buildGeocodeUrl,
  parseDirectionsMinutes,
  parseGeocode,
  zoneFor,
} from "@/lib/adapters/mapbox";

describe("buildGeocodeUrl", () => {
  it("URL-encodes a hostile string so spaces, ?, & and # cannot break the URL", () => {
    const url = buildGeocodeUrl("Sagrada Familia? & #hash");

    // The raw separators must not appear unescaped inside the path/query.
    const pathAndQuery = url.slice("https://api.mapbox.com/geocoding/v5/mapbox.places/".length);
    expect(pathAndQuery).not.toContain(" ");
    expect(pathAndQuery).not.toContain("#");
    // The encoded forms are present instead.
    expect(url).toContain("Sagrada%20Familia");
    expect(url).toContain("%3F"); // ?
    expect(url).toContain("%26"); // &
    expect(url).toContain("%23"); // #
    expect(url.startsWith("https://api.mapbox.com/geocoding/v5/mapbox.places/")).toBe(true);
  });

  it("caps an over-long raw query to <= 200 chars before encoding", () => {
    const longQuery = "a".repeat(500);
    const url = buildGeocodeUrl(longQuery);

    // Extract the encoded query segment (between the base "/" and ".json").
    const base = "https://api.mapbox.com/geocoding/v5/mapbox.places/";
    const encodedSegment = url.slice(base.length, url.indexOf(".json"));

    // "a" encodes to itself, so length is a direct proxy for the pre-encode cap.
    expect(encodedSegment.length).toBe(200);
    expect(encodedSegment).toBe("a".repeat(200));
  });
});

describe("parseGeocode", () => {
  it("returns coordinates and confident=true for a clean, high-relevance fixture", () => {
    const raw = {
      features: [
        {
          // Mapbox center is [lng, lat].
          center: [2.1743, 41.4036],
          relevance: 1,
          place_name: "Sagrada Familia, Barcelona, Spain",
        },
      ],
    };

    expect(parseGeocode(raw)).toEqual({ lat: 41.4036, lng: 2.1743, confident: true });
  });

  it("returns confident=false when the best feature has low relevance", () => {
    const raw = {
      features: [
        {
          center: [2.1743, 41.4036],
          relevance: 0.42,
        },
      ],
    };

    expect(parseGeocode(raw)).toEqual({ lat: 41.4036, lng: 2.1743, confident: false });
  });

  it("returns null for a zero-result fixture", () => {
    expect(parseGeocode({ features: [] })).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseGeocode(null)).toBeNull();
    expect(parseGeocode({})).toBeNull();
    expect(parseGeocode({ features: [{ center: [2.17] }] })).toBeNull();
  });
});

describe("zoneFor", () => {
  it("resolves Barcelona to Europe/Madrid", () => {
    expect(zoneFor(41.4, 2.17)).toBe("Europe/Madrid");
  });

  it("resolves a New York coordinate to an America/ zone", () => {
    expect(zoneFor(40.69, -74.04).startsWith("America/")).toBe(true);
  });
});

describe("parseDirectionsMinutes", () => {
  it("converts routes[0].duration seconds to rounded minutes for a clean fixture", () => {
    // 1530s / 60 = 25.5 -> rounds to 26.
    const raw = { routes: [{ duration: 1530 }] };
    expect(parseDirectionsMinutes(raw)).toBe(26);
  });

  it("returns null when there is no route", () => {
    expect(parseDirectionsMinutes({ routes: [] })).toBeNull();
    expect(parseDirectionsMinutes({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseDirectionsMinutes(null)).toBeNull();
  });
});
