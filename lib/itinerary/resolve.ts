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
const RATE_MS = 1100; // Nominatim policy: <= 1 req/s, sequential

const sig = (s: string): string[] =>
  s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4);

/**
 * U0-corrected acceptance. Pure — testable with fixtures, no network. Accepts when the first hit has
 * valid coordinates AND (for a Latin-script query) shares a significant name token, so real POIs at
 * importance ~0 are kept while clearly-wrong matches are dropped. A non-Latin-script query (e.g. a
 * Japanese local name) can't token-match, so it's accepted on geocode-success alone.
 */
export function assessGeocodeHit(query: string, raw: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as Record<string, unknown>;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const qTokens = sig(query);
  if (qTokens.length === 0) return { lat, lng }; // non-Latin query: accept on geocode-success
  const hay = `${String(first.name ?? "")} ${String(first.display_name ?? "")}`.toLowerCase();
  return qTokens.some((t) => hay.includes(t)) ? { lat, lng } : null;
}

async function geocodeOne(localName: string, city: string): Promise<{ lat: number; lng: number } | null> {
  // Query "<local name>, <city>" for Nominatim disambiguation, but name-match on the place name only
  // (the city token would otherwise trivially match every hit in that city).
  try {
    const res = await fetch(buildGeocodeUrl(`${localName}, ${city}`), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return assessGeocodeHit(localName, await res.json());
  } catch {
    return null;
  }
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

  for (const day of plan.days) {
    for (const place of day.places) {
      const key = `${place.localName.toLowerCase()}|${city.toLowerCase()}`;
      let hit: { lat: number; lng: number } | null;
      if (cache.has(key)) {
        hit = cache.get(key)!;
      } else {
        if (!firstCall && rateMs > 0) await sleep(rateMs);
        firstCall = false;
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
  return { items, dropped };
}
