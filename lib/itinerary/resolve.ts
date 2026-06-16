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
const GEOCODE_TIMEOUT_MS = 8000; // a hung Nominatim connection must not block the whole run
const MAX_GEOCODES = 40; // cap total un-cached geocodes so worst-case wall time stays well under the function budget

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

  // Script check FIRST: a non-Latin-script name (Japanese, Arabic, …) can't be reliably token-matched
  // against a possibly-romanized result, so accept it on geocode-success. Only Latin-script queries go
  // through the name-token match. (Fixes the U0 false-drop for CJK names + the all-short-token case.)
  if (!/[A-Za-z]/.test(query)) return { lat, lng };
  const qTokens = sig(query);
  if (qTokens.length === 0) return { lat, lng };
  const hay = `${String(first.name ?? "")} ${String(first.display_name ?? "")}`.toLowerCase();
  return qTokens.some((t) => hay.includes(t)) ? { lat, lng } : null;
}

async function geocodeOne(localName: string, city: string): Promise<{ lat: number; lng: number } | null> {
  // Query "<local name>, <city>" for Nominatim disambiguation, but name-match on the place name only
  // (the city token would otherwise trivially match every hit in that city).
  try {
    const res = await fetch(buildGeocodeUrl(`${localName}, ${city}`), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 403/429 here is the classic "Nominatim blocks datacenter IPs" failure in serverless prod.
      console.warn(`[itinerary.geocode] http_error ${JSON.stringify({ q: localName, status: res.status })}`);
      return null;
    }
    const raw = await res.json();
    const hit = assessGeocodeHit(localName, raw);
    if (!hit) {
      const reason = !Array.isArray(raw) || raw.length === 0 ? "zero_results" : "name_mismatch";
      console.warn(`[itinerary.geocode] dropped ${JSON.stringify({ q: localName, reason })}`);
    }
    return hit;
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : "unknown";
    console.warn(`[itinerary.geocode] network_error ${JSON.stringify({ q: localName, err })}`);
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
