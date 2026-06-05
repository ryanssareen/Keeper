import tzlookup from "tz-lookup";
import { type AdapterResult, ok, adapterError } from "@/lib/adapters/result";
import type { PlaceResolution } from "@/lib/engine/types";

/**
 * Geocoding + transit via free, keyless OpenStreetMap services:
 *   - Nominatim (geocoding)  https://nominatim.openstreetmap.org
 *   - OSRM driving routes    https://router.project-osrm.org
 * No API key, no account, no card. Free-flow driving duration (no live traffic) — Slice 1 accepts
 * this; a hard geocode/route failure falls back to a user-entered manual buffer.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
// Nominatim policy requires an identifying User-Agent.
const USER_AGENT = "keeper-travel-app/0.1 (reconciliation walking skeleton)";
const MAX_QUERY = 200;
const CONFIDENCE_MIN = 0.3; // Nominatim "importance" below this is treated as ambiguous

/** Build a Nominatim search URL with an encoded, length-capped query. */
export function buildGeocodeUrl(query: string): string {
  const q = query.slice(0, MAX_QUERY);
  return `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=0`;
}

/** Parse the first Nominatim hit; null on zero results or malformed input. */
export function parseGeocode(
  raw: unknown,
): { lat: number; lng: number; confident: boolean } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as Record<string, unknown>;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const importance = Number(first.importance);
  const confident = Number.isFinite(importance) ? importance >= CONFIDENCE_MIN : true;
  return { lat, lng, confident };
}

/** IANA zone for a coordinate (offline, keyless). */
export function zoneFor(lat: number, lng: number): string {
  return tzlookup(lat, lng);
}

/** Geocode an airport (by IATA code or name) to coordinates via Nominatim. */
export async function geocodeAirport(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const geo = parseGeocode(await fetchJson(buildGeocodeUrl(`${query} airport`)));
  return geo ? { lat: geo.lat, lng: geo.lng } : null;
}

/** Parse an OSRM driving response to minutes; null when there is no usable route. */
export function parseDirectionsMinutes(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { code?: string; routes?: { duration?: number }[] };
  if (r.code !== "Ok" || !Array.isArray(r.routes) || r.routes.length === 0) return null;
  const seconds = r.routes[0]?.duration;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return Math.round(seconds / 60);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function buildRouteUrl(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `${OSRM}/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
}

function fallback(
  query: string,
  reason: PlaceResolution["reason"],
  lat: number | null,
  lng: number | null,
  ianaZone: string | null,
): PlaceResolution {
  return {
    label: query,
    lat,
    lng,
    ianaZone,
    placeResolved: false,
    transitMinutes: 0,
    transitSource: "manual_buffer",
    reason,
  };
}

/** Geocode the place, derive its zone, and compute airport->place driving minutes. */
export async function resolvePlace(
  query: string,
  airportLat: number,
  airportLng: number,
): Promise<AdapterResult<PlaceResolution>> {
  try {
    const geo = parseGeocode(await fetchJson(buildGeocodeUrl(query)));
    if (!geo) return ok(fallback(query, "geocode_miss", null, null, null));

    const ianaZone = zoneFor(geo.lat, geo.lng);
    if (!geo.confident) return ok(fallback(query, "ambiguous", geo.lat, geo.lng, ianaZone));

    const minutes = parseDirectionsMinutes(
      await fetchJson(buildRouteUrl(airportLat, airportLng, geo.lat, geo.lng)),
    );
    if (minutes === null) return ok(fallback(query, "unroutable", geo.lat, geo.lng, ianaZone));

    return ok({
      label: query,
      lat: geo.lat,
      lng: geo.lng,
      ianaZone,
      placeResolved: true,
      transitMinutes: minutes,
      transitSource: "osrm",
      reason: "ok",
    });
  } catch (e) {
    return adapterError(e instanceof Error ? e.message : "geocode/route failed");
  }
}
