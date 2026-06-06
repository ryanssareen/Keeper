/**
 * AirLabs flight-status adapter.
 *
 * Free tier: 1,000 requests/month — no credit card required.
 * Sign up at https://airlabs.co/ to get your key, then set AIRLABS_KEY in .env.local.
 *
 * The /flight endpoint returns the CLOSEST flight for the given IATA code (no date
 * filtering on the free tier). Works well for "track my current trip" — the active or
 * most-recently-landed flight for today's number is always the one returned.
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

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/**
 * Normalize AirLabs UTC time strings to canonical ISO-8601.
 * AirLabs emits a space separator ("2024-03-15 14:30") — same quirk as AeroDataBox.
 */
const normalizeUtc = (raw: string): string | null => {
  const iso = raw.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  const dt = DateTime.fromISO(iso, { zone: "utc", setZone: true });
  return dt.isValid ? dt.toUTC().toISO({ suppressMilliseconds: true }) : null;
};

const mapStatus = (raw: string): FlightStatus => {
  switch (raw.trim().toLowerCase()) {
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "diverted":
      return "diverted";
    case "landed":
      return "landed";
    case "en-route":
    case "active":
      return "active";
    case "scheduled":
      return "scheduled";
    default:
      return "unknown";
  }
};

/**
 * PURE mapper: AirLabs /flight response -> {@link FlightArrival}.
 * Never throws — missing or malformed required fields collapse to {@link adapterError}.
 */
export const parseFlightStatus = (raw: unknown): AdapterResult<FlightArrival> => {
  if (!isRecord(raw)) return adapterError("expected a response object");

  // AirLabs wraps data in { response: { ... } }; errors in { error: { message: "..." } }
  if (isRecord((raw as { error?: unknown }).error)) {
    const msg = (raw as { error: { message?: unknown } }).error.message;
    const text = isNonEmptyString(msg) ? msg.toLowerCase() : "";
    if (text.includes("not found") || text.includes("no flight")) return notFound();
    return adapterError(isNonEmptyString(msg) ? msg : "AirLabs error");
  }

  const resp = (raw as { response?: unknown }).response;
  if (!isRecord(resp)) return adapterError("missing response field");

  const statusRaw = resp.status;
  if (!isNonEmptyString(statusRaw)) return adapterError("missing flight status");
  const status = mapStatus(statusRaw);

  const iata = resp.arr_iata;
  if (!isNonEmptyString(iata)) return adapterError("missing arr_iata");

  const rawScheduled = isNonEmptyString(resp.arr_time_utc) ? resp.arr_time_utc : null;
  const rawEstimated = isNonEmptyString(resp.arr_estimated_utc) ? resp.arr_estimated_utc : null;
  const rawActual = isNonEmptyString(resp.arr_actual_utc) ? resp.arr_actual_utc : null;

  const scheduledUtc = rawScheduled ? normalizeUtc(rawScheduled) : null;
  const predictedUtc = rawEstimated ? normalizeUtc(rawEstimated) : null;
  const actualUtc = rawActual ? normalizeUtc(rawActual) : null;

  if (rawScheduled && !scheduledUtc) return adapterError("unparseable arr_time_utc");
  if (rawEstimated && !predictedUtc) return adapterError("unparseable arr_estimated_utc");
  if (rawActual && !actualUtc) return adapterError("unparseable arr_actual_utc");

  const fingerprintInstant = predictedUtc ?? scheduledUtc ?? "";
  const revision = `${fingerprintInstant}|${status}|${iata}`;

  return ok({ scheduledUtc, predictedUtc, actualUtc, status, arrivalAirport: iata, revision });
};

const FETCH_TIMEOUT_MS = 8000;

/**
 * Live fetch of the AirLabs /flight endpoint.
 * `dateIso` is accepted for API-contract compatibility but not forwarded (no free-tier date
 * filter). The endpoint always returns the closest flight for the flight number.
 */
export const fetchFlight = async (
  flightNumber: string,
  _dateIso: string,
): Promise<AdapterResult<FlightArrival>> => {
  const key = process.env.AIRLABS_KEY;
  if (!isNonEmptyString(key)) return adapterError("AIRLABS_KEY is not configured");

  const url =
    `https://airlabs.co/api/v9/flight` +
    `?flight_iata=${encodeURIComponent(flightNumber)}` +
    `&api_key=${key}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return adapterError("network error reaching AirLabs");
  }

  if (response.status === 404) return notFound();
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
    return rateLimited(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : undefined);
  }
  if (!response.ok) return adapterError(`AirLabs responded ${response.status}`);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return adapterError("AirLabs returned non-JSON body");
  }

  return parseFlightStatus(json);
};
