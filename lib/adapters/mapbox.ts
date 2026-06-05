/**
 * Mapbox geocode + transit adapter (U4).
 *
 * Resolves a place string to coordinates + IANA zone and computes the airport->place
 * driving duration, distinguishing failure reasons (geocode_miss / ambiguous / unroutable).
 * The input string is never trusted raw: it is length-capped and URL-encoded before any request.
 *
 * Pure pieces (buildGeocodeUrl / parseGeocode / zoneFor / parseDirectionsMinutes) are unit-tested
 * with inline fixtures; the live `resolvePlace` wrapper is thin and untested (no token/network here).
 */

import tzlookup from "tz-lookup";

import {
  type AdapterResult,
  adapterError,
  ok,
} from "@/lib/adapters/result";
import type { PlaceResolution } from "@/lib/engine/types";

/** Mapbox base endpoints. */
const GEOCODE_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic";

/** Hard cap on the raw query length before encoding (defensive against oversized/injection input). */
const MAX_QUERY_LENGTH = 200;

/**
 * Mapbox relevance is 0..1; below this the single best feature is treated as ambiguous/unconfident
 * so callers fall back to a manual buffer rather than trust a weak geocode.
 */
const MIN_RELEVANCE = 0.8;

/**
 * Build the Mapbox geocoding request URL for `query`.
 *
 * The raw string is length-capped to <= MAX_QUERY_LENGTH chars *before* encoding, then
 * URL-encoded so spaces, "?", "&", "#" and friends can never break out of the path/query.
 */
export function buildGeocodeUrl(query: string): string {
  const capped = query.slice(0, MAX_QUERY_LENGTH);
  const encoded = encodeURIComponent(capped);
  const token = process.env.MAPBOX_TOKEN ?? "";
  return `${GEOCODE_BASE}/${encoded}.json?access_token=${encodeURIComponent(token)}&limit=1`;
}

/** Build the Directions request URL for an origin (airport) -> destination (place) pair. */
function buildDirectionsUrl(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): string {
  // Mapbox coordinate order is lng,lat; pairs are semicolon-separated.
  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const token = process.env.MAPBOX_TOKEN ?? "";
  return `${DIRECTIONS_BASE}/${coords}?access_token=${encodeURIComponent(token)}&overview=false`;
}

/** Narrow an unknown value to a finite number, or null. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parse a Mapbox geocoding response.
 *
 * Returns the first feature's coordinates plus a `confident` flag (relevance >= MIN_RELEVANCE).
 * Returns null when there are zero results or the feature lacks usable coordinates.
 */
export function parseGeocode(
  raw: unknown,
): { lat: number; lng: number; confident: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;

  const features = (raw as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const first = features[0];
  if (typeof first !== "object" || first === null) return null;

  // Mapbox `center` is [lng, lat].
  const center = (first as { center?: unknown }).center;
  if (!Array.isArray(center) || center.length < 2) return null;

  const lng = asFiniteNumber(center[0]);
  const lat = asFiniteNumber(center[1]);
  if (lat === null || lng === null) return null;

  const relevance = asFiniteNumber((first as { relevance?: unknown }).relevance);
  const confident = relevance !== null && relevance >= MIN_RELEVANCE;

  return { lat, lng, confident };
}

/** IANA zone for a coordinate (destination zone, not device or airport). Thin tz-lookup wrapper. */
export function zoneFor(lat: number, lng: number): string {
  return tzlookup(lat, lng);
}

/**
 * Parse a Mapbox Directions response: routes[0].duration (seconds) -> minutes, rounded.
 * Returns null when there is no route.
 */
export function parseDirectionsMinutes(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;

  const routes = (raw as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const first = routes[0];
  if (typeof first !== "object" || first === null) return null;

  const durationSeconds = asFiniteNumber((first as { duration?: unknown }).duration);
  if (durationSeconds === null) return null;

  return Math.round(durationSeconds / 60);
}

/** A geocoded place that did not resolve confidently or could not be routed: manual-buffer fallback. */
function fallback(
  label: string,
  reason: "geocode_miss" | "ambiguous" | "unroutable",
  coords: { lat: number; lng: number } | null,
): PlaceResolution {
  return {
    label,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    ianaZone: coords ? zoneFor(coords.lat, coords.lng) : null,
    placeResolved: false,
    transitMinutes: 0,
    transitSource: "manual_buffer",
    reason,
  };
}

/** Thin JSON fetch helper. Network/HTTP failures surface as a typed adapter error to the caller. */
async function fetchJson(url: string): Promise<AdapterResult<unknown>> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return adapterError(`mapbox http ${res.status}`);
    }
    const body: unknown = await res.json();
    return ok(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "mapbox fetch failed";
    return adapterError(message);
  }
}

/**
 * LIVE wrapper (untested here — no token/network).
 *
 * geocode(query) ->
 *   - zero results           => reason "geocode_miss", placeResolved false, manual_buffer
 *   - low confidence         => reason "ambiguous",    placeResolved false, manual_buffer (zone kept)
 *   - confident => derive destination zone + Directions(driving-traffic) duration:
 *       - no route           => reason "unroutable",   placeResolved false, manual_buffer (zone kept)
 *       - routed             => reason "ok",            placeResolved true,  transitSource "mapbox"
 */
export async function resolvePlace(
  query: string,
  airportLat: number,
  airportLng: number,
): Promise<AdapterResult<PlaceResolution>> {
  const geoResult = await fetchJson(buildGeocodeUrl(query));
  if (geoResult.kind !== "ok") return geoResult;

  const geocoded = parseGeocode(geoResult.data);
  if (geocoded === null) {
    return ok(fallback(query, "geocode_miss", null));
  }

  const coords = { lat: geocoded.lat, lng: geocoded.lng };
  if (!geocoded.confident) {
    return ok(fallback(query, "ambiguous", coords));
  }

  const ianaZone = zoneFor(coords.lat, coords.lng);

  const dirResult = await fetchJson(
    buildDirectionsUrl(airportLat, airportLng, coords.lat, coords.lng),
  );
  if (dirResult.kind !== "ok") return dirResult;

  const transitMinutes = parseDirectionsMinutes(dirResult.data);
  if (transitMinutes === null) {
    return ok(fallback(query, "unroutable", coords));
  }

  return ok({
    label: query,
    lat: coords.lat,
    lng: coords.lng,
    ianaZone,
    placeResolved: true,
    transitMinutes,
    transitSource: "mapbox",
    reason: "ok",
  });
}
