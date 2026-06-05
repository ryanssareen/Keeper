/**
 * AeroDataBox flight-status adapter (U3).
 *
 * The flight-by-number endpoint returns an ARRAY of flight objects. We take the first
 * element, normalize the arrival time fields to UTC ISO-8601 instants, map the upstream
 * status string onto the engine's {@link FlightStatus}, and derive a deterministic
 * `revision` fingerprint of the load-bearing fields (so dedup is data-derived, not a tick
 * counter — see plan KTD "Data-derived idempotency").
 *
 * `parseFlightStatus` is PURE and exhaustively unit-tested with inline fixtures. `fetchFlight`
 * is a thin live fetch (needs a RapidAPI key) and is deliberately left untested here.
 *
 * Frozen contracts: @/lib/adapters/result, @/lib/engine/types.
 */

import { DateTime } from "luxon";

import {
  adapterError,
  notFound,
  ok,
  rateLimited,
  type AdapterResult,
} from "@/lib/adapters/result";
import type { FlightArrival, FlightStatus } from "@/lib/engine/types";

/** Shape of one `arrival.<field>` time object as returned upstream. */
interface RawTime {
  utc?: string;
  local?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Pull a `{ utc }` string out of a candidate time object. Returns null when the field is
 * absent (the common pre-data / pre-landing case) — only a *malformed* object (present but
 * not a record, or `utc` present but not a string) is treated as a parse failure by the caller.
 */
const readUtc = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  const utc = (value as RawTime).utc;
  return isNonEmptyString(utc) ? utc : null;
};

/**
 * Normalize an upstream UTC time string to a canonical ISO-8601 instant ending in `Z`.
 * AeroDataBox emits a space separator ("2026-06-05 18:40Z"); strict ISO requires a `T`, so we
 * swap the first date/time space before parsing. Returns null when the string cannot be parsed
 * as a valid instant.
 */
const normalizeUtc = (raw: string): string | null => {
  const isoCandidate = raw.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  const dt = DateTime.fromISO(isoCandidate, { zone: "utc", setZone: true });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO({ suppressMilliseconds: true });
};

/** Map the upstream status label onto the engine's closed FlightStatus set. */
const mapStatus = (raw: string): FlightStatus => {
  switch (raw.trim().toLowerCase()) {
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "diverted":
      return "diverted";
    case "arrived":
    case "landed":
      return "landed";
    case "enroute":
    case "en route":
    case "active":
      return "active";
    case "scheduled":
    case "expected":
      return "scheduled";
    default:
      return "unknown";
  }
};

/**
 * PURE mapper: array payload -> {@link FlightArrival}. Never throws — malformed or missing
 * required fields collapse to `adapterError`, an empty array to `notFound`.
 */
export const parseFlightStatus = (raw: unknown): AdapterResult<FlightArrival> => {
  if (!Array.isArray(raw)) {
    return adapterError("expected an array of flights");
  }
  if (raw.length === 0) {
    return notFound();
  }

  const flight = raw[0];
  if (!isRecord(flight)) {
    return adapterError("flight entry is not an object");
  }

  const statusRaw = flight.status;
  if (!isNonEmptyString(statusRaw)) {
    return adapterError("missing flight status");
  }
  const status = mapStatus(statusRaw);

  const arrival = flight.arrival;
  if (!isRecord(arrival)) {
    return adapterError("missing arrival block");
  }

  const airport = arrival.airport;
  if (!isRecord(airport)) {
    return adapterError("missing arrival airport");
  }
  const iata = airport.iata;
  const icao = airport.icao;
  const arrivalAirport = isNonEmptyString(iata)
    ? iata
    : isNonEmptyString(icao)
      ? icao
      : null;
  if (arrivalAirport === null) {
    return adapterError("arrival airport missing iata/icao");
  }

  // Distinguish "field absent" (null instant) from "field present but malformed" (error).
  const rawScheduled = readUtc(arrival.scheduledTime);
  const rawRevised = readUtc(arrival.revisedTime);
  const rawRunway = readUtc(arrival.runwayTime);

  if (arrival.scheduledTime !== undefined && arrival.scheduledTime !== null && rawScheduled === null) {
    return adapterError("malformed scheduledTime");
  }
  if (arrival.revisedTime !== undefined && arrival.revisedTime !== null && rawRevised === null) {
    return adapterError("malformed revisedTime");
  }
  if (arrival.runwayTime !== undefined && arrival.runwayTime !== null && rawRunway === null) {
    return adapterError("malformed runwayTime");
  }

  const scheduledUtc = rawScheduled === null ? null : normalizeUtc(rawScheduled);
  const predictedUtc = rawRevised === null ? null : normalizeUtc(rawRevised);
  const actualUtc = rawRunway === null ? null : normalizeUtc(rawRunway);

  if (rawScheduled !== null && scheduledUtc === null) {
    return adapterError("unparseable scheduledTime instant");
  }
  if (rawRevised !== null && predictedUtc === null) {
    return adapterError("unparseable revisedTime instant");
  }
  if (rawRunway !== null && actualUtc === null) {
    return adapterError("unparseable runwayTime instant");
  }

  // Deterministic fingerprint of the load-bearing fields. Prediction wins over schedule so a
  // revised ETA changes the revision; status and airport changes (cancellation, diversion)
  // also move it. Identical payloads yield an identical string.
  const fingerprintInstant = predictedUtc ?? scheduledUtc ?? "";
  const revision = `${fingerprintInstant}|${status}|${arrivalAirport}`;

  return ok({
    scheduledUtc,
    predictedUtc,
    actualUtc,
    status,
    arrivalAirport,
    revision,
  });
};

const RAPIDAPI_HOST = "aerodatabox.p.rapidapi.com";

/**
 * Thin live fetch of the AeroDataBox flight-by-number endpoint via RapidAPI. Maps transport
 * outcomes onto {@link AdapterResult}: 404 -> not_found, 429 -> rate_limited (honoring
 * Retry-After), other non-2xx / network failures -> error, 200 -> parseFlightStatus(json).
 *
 * Untested here (requires a live AERODATABOX_KEY). The key never reaches a log; the URL is
 * derived from validated arguments and carries no secret in its query string.
 *
 * @param flightNumber e.g. "BA75"
 * @param dateIso local departure date "YYYY-MM-DD"
 */
export const fetchFlight = async (
  flightNumber: string,
  dateIso: string,
): Promise<AdapterResult<FlightArrival>> => {
  const key = process.env.AERODATABOX_KEY;
  if (!isNonEmptyString(key)) {
    return adapterError("AERODATABOX_KEY is not configured");
  }

  const path = `/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(dateIso)}`;
  const url = `https://${RAPIDAPI_HOST}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": RAPIDAPI_HOST,
      },
    });
  } catch {
    // Never surface the underlying error object — it can echo the request (and headers).
    return adapterError("network error reaching AeroDataBox");
  }

  if (response.status === 404) {
    return notFound();
  }
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
    const retryAfterMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : undefined;
    return rateLimited(retryAfterMs);
  }
  if (!response.ok) {
    return adapterError(`AeroDataBox responded ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return adapterError("AeroDataBox returned non-JSON body");
  }

  return parseFlightStatus(json);
};
