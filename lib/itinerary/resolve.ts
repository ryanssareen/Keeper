import { buildGeocodeUrl, zoneFor } from "@/lib/adapters/osm";
import { monitorableItemSchema, type MonitorableItem } from "@/lib/itinerary/itinerary";
import type { CandidatePlan } from "@/lib/itinerary/generate";

/**
 * The monitorability gate (U3) — revised by U0. A candidate is monitorable when it GEOCODES to a
 * confident, correctly-named POI, NOT when Nominatim `importance >= 0.3` (a Wikipedia-fame prior that
 * dropped 50–77% of real POIs — see docs/u0-itinerary-grounding-probe.md). Unresolved candidates are
 * dropped, never persisted. Server-only (network); never imported by a client component.
 */

const USER_AGENT = "keeper-itinerary/0.1 (+https://github.com/ryanssareen/Keeper)";
// Photon is the primary geocoder (Nominatim blocks datacenter IPs, so from the serverless function it
// rarely resolves — see the photon_fallback logs). Photon has no hard 1-req/s rule, so a small spacer
// keeps the run polite while staying well under the function budget for a multi-day trip.
const RATE_MS = 250;
const GEOCODE_TIMEOUT_MS = 7000; // a hung connection must not block the whole run
const MAX_GEOCODES = 36; // cap total un-cached geocodes so worst-case wall time stays well under the budget

const sig = (s: string): string[] =>
  s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4);

/**
 * Name-match core (U0): a non-Latin-script query (Japanese, Arabic, …) can't be reliably token-matched
 * against a possibly-romanized result, so it's accepted on geocode-success alone; a Latin-script query
 * must share a significant name token with the result text so clearly-wrong matches are dropped.
 */
function nameMatches(query: string, hay: string): boolean {
  if (!/[A-Za-z]/.test(query)) return true;
  const qTokens = sig(query);
  if (qTokens.length === 0) return true;
  const h = hay.toLowerCase();
  return qTokens.some((t) => h.includes(t));
}

/**
 * U0-corrected acceptance for a Nominatim result. Pure — testable with fixtures, no network. Accepts
 * when the first hit has valid coordinates AND clears the name-match, so real POIs at importance ~0 are
 * kept while clearly-wrong matches are dropped.
 */
export function assessGeocodeHit(query: string, raw: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as Record<string, unknown>;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hay = `${String(first.name ?? "")} ${String(first.display_name ?? "")}`;
  return nameMatches(query, hay) ? { lat, lng } : null;
}

/** Same acceptance against a Photon (komoot) GeoJSON FeatureCollection — its coords are [lon, lat]. */
export function assessPhotonHit(query: string, raw: unknown): { lat: number; lng: number } | null {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const f = (features[0] ?? {}) as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
  const coords = f.geometry?.coordinates;
  if (!Array.isArray(coords)) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = f.properties ?? {};
  const hay = ["name", "street", "city", "state", "country", "osm_value"].map((k) => String(p[k] ?? "")).join(" ");
  return nameMatches(query, hay) ? { lat, lng } : null;
}

const photonUrl = (query: string): string =>
  `https://photon.komoot.io/api/?q=${encodeURIComponent(query.slice(0, 200))}&limit=1`;

/** Geocode via Nominatim. Logs hard failures (403/429 = the classic datacenter-IP block; timeouts). */
async function geocodeNominatim(localName: string, city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(buildGeocodeUrl(`${localName}, ${city}`), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[itinerary.geocode] nominatim http_error ${JSON.stringify({ q: localName, status: res.status })}`);
      return null;
    }
    return assessGeocodeHit(localName, await res.json());
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : "unknown";
    console.warn(`[itinerary.geocode] nominatim network_error ${JSON.stringify({ q: localName, err })}`);
    return null;
  }
}

/** Fallback geocoder (keyless, datacenter-tolerant) used when Nominatim blocks or misses. */
async function geocodePhoton(localName: string, city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(photonUrl(`${localName}, ${city}`), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[itinerary.geocode] photon http_error ${JSON.stringify({ q: localName, status: res.status })}`);
      return null;
    }
    return assessPhotonHit(localName, await res.json());
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : "unknown";
    console.warn(`[itinerary.geocode] photon network_error ${JSON.stringify({ q: localName, err })}`);
    return null;
  }
}

// Query "<local name>, <city>" for disambiguation, but name-match on the place name only (the city token
// would otherwise trivially match every hit in that city). Photon FIRST — it's the geocoder that actually
// resolves from the serverless function (Nominatim blocks datacenter IPs); fall back to Nominatim only on
// a Photon miss, so neither provider's outage silently drops the whole itinerary.
async function geocodeOne(localName: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const photon = await geocodePhoton(localName, city);
  if (photon) return photon;
  const nominatim = await geocodeNominatim(localName, city);
  if (nominatim) console.info(`[itinerary.geocode] nominatim_fallback_hit ${JSON.stringify({ q: localName })}`);
  else console.warn(`[itinerary.geocode] dropped ${JSON.stringify({ q: localName })}`);
  return nominatim;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const safeZone = (lat: number, lng: number): string | null => {
  try {
    return zoneFor(lat, lng);
  } catch {
    return null;
  }
};

export type ResolveDeps = {
  geocode?: (localName: string, city: string) => Promise<{ lat: number; lng: number } | null>;
  rateMs?: number;
};

/**
 * Resolve a candidate plan into monitorable items. Sequential with a >= 1s spacer between un-cached
 * geocodes (cache hits skip the spacer); unresolved candidates are dropped and counted. The geocoder
 * is injectable so tests run without network or real delays.
 */
export async function resolveCandidates(
  plan: CandidatePlan,
  city: string,
  deps: ResolveDeps = {},
): Promise<{ items: MonitorableItem[]; dropped: number }> {
  const geocode = deps.geocode ?? geocodeOne;
  const rateMs = deps.rateMs ?? RATE_MS;
  const cache = new Map<string, { lat: number; lng: number } | null>();
  const items: MonitorableItem[] = [];
  let dropped = 0;
  let firstCall = true;
  let geocodeCount = 0;
  let totalPlaces = 0;
  let noZone = 0;

  for (const day of plan.days) {
    for (const place of day.places) {
      totalPlaces += 1;
      const key = `${place.localName.toLowerCase()}|${city.toLowerCase()}`;
      let hit: { lat: number; lng: number } | null;
      if (cache.has(key)) {
        hit = cache.get(key)!;
      } else if (geocodeCount >= MAX_GEOCODES) {
        // Hard cap on un-cached geocodes so a long trip can't blow the function time budget.
        dropped += 1;
        continue;
      } else {
        if (!firstCall && rateMs > 0) await sleep(rateMs);
        firstCall = false;
        geocodeCount += 1;
        hit = await geocode(place.localName, city);
        cache.set(key, hit);
      }
      if (!hit) {
        dropped += 1;
        continue;
      }
      const zone = safeZone(hit.lat, hit.lng);
      if (!zone) {
        dropped += 1;
        noZone += 1;
        continue;
      }
      const candidate = {
        title: place.name,
        placeName: place.localName,
        lat: hit.lat,
        lng: hit.lng,
        ianaZone: zone,
        kind: place.kind,
        day: day.date,
        startTs: null,
        endTs: null,
      };
      const parsed = monitorableItemSchema.safeParse(candidate);
      if (parsed.success) items.push(parsed.data);
      else dropped += 1;
    }
  }
  // One line per run so a prod failure is diagnosable from Vercel runtime logs: how many candidates came
  // in, how many we actually geocoded (vs cache), how many survived, and how many hit the geocode cap.
  console.info(
    `[itinerary.resolve] summary ${JSON.stringify({
      city,
      totalPlaces,
      geocoded: geocodeCount,
      capped: geocodeCount >= MAX_GEOCODES,
      noZone,
      accepted: items.length,
      dropped,
    })}`,
  );
  return { items, dropped };
}
