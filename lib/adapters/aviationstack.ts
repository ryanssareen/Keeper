/**
 * AviationStack flight-status adapter.
 *
 * Free tier: 100 requests/month — no credit card required.
 * Sign up at https://aviationstack.com/ to get your key, then set AVIATIONSTACK_KEY in .env.local.
 *
 * The /flights endpoint returns an array of matching flights. We take the first element and
 * map its arrival block onto {@link FlightArrival}. Time fields are full ISO-8601 with timezone
 * offset — no space-separator quirk unlike AeroDataBox/AirLabs.
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

const normalizeUtc = (raw: string): string | null => {
  const dt = DateTime.fromISO(raw, { setZone: true });
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
    case "active":
    case "en-route":
      return "active";
    case "scheduled":
      return "scheduled";
    default:
      return "unknown";
  }
};

/**
 * PURE mapper: AviationStack /flights response -> {@link FlightArrival}.
 * Never throws — missing or malformed required fields collapse to {@link adapterError}.
 */
export const parseFlightStatus = (raw: unknown): AdapterResult<FlightArrival> => {
  if (!isRecord(raw)) return adapterError("expected a response object");

  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return adapterError("missing data array");
  if (data.length === 0) return notFound();

  const flight = data[0];
  if (!isRecord(flight)) return adapterError("flight entry is not an object");

  const statusRaw = flight.flight_status;
  if (!isNonEmptyString(statusRaw)) return adapterError("missing flight_status");
  const status = mapStatus(statusRaw);

  const arrival = (flight as { arrival?: unknown }).arrival;
  if (!isRecord(arrival)) return adapterError("missing arrival block");

  const iata = arrival.iata;
  if (!isNonEmptyString(iata)) return adapterError("missing arrival.iata");

  const rawScheduled = isNonEmptyString(arrival.scheduled) ? arrival.scheduled : null;
  const rawEstimated = isNonEmptyString(arrival.estimated) ? arrival.estimated : null;
  const rawActual = isNonEmptyString(arrival.actual) ? arrival.actual : null;

  const scheduledUtc = rawScheduled ? normalizeUtc(rawScheduled) : null;
  const predictedUtc = rawEstimated ? normalizeUtc(rawEstimated) : null;
  const actualUtc = rawActual ? normalizeUtc(rawActual) : null;

  if (rawScheduled && !scheduledUtc) return adapterError("unparseable scheduled time");
  if (rawEstimated && !predictedUtc) return adapterError("unparseable estimated time");
  if (rawActual && !actualUtc) return adapterError("unparseable actual time");

  const fingerprintInstant = predictedUtc ?? scheduledUtc ?? "";
  const revision = `${fingerprintInstant}|${status}|${iata}`;

  return ok({ scheduledUtc, predictedUtc, actualUtc, status, arrivalAirport: iata, revision });
};

const FETCH_TIMEOUT_MS = 8000;

/**
 * Live fetch of the AviationStack /flights endpoint.
 * `dateIso` is accepted for API-contract compatibility but not forwarded (no free-tier date
 * filter — the endpoint returns the most recent matching flight for the number).
 */
export const fetchFlight = async (
  flightNumber: string,
  _dateIso: string,
): Promise<AdapterResult<FlightArrival>> => {
  const key = process.env.AVIATIONSTACK_KEY;
  if (!isNonEmptyString(key)) return adapterError("AVIATIONSTACK_KEY is not configured");

  const url =
    `https://api.aviationstack.com/v1/flights` +
    `?access_key=${key}` +
    `&flight_iata=${encodeURIComponent(flightNumber)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return adapterError("network error reaching AviationStack");
  }

  if (response.status === 404) return notFound();
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
    return rateLimited(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : undefined);
  }
  if (!response.ok) return adapterError(`AviationStack responded ${response.status}`);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return adapterError("AviationStack returned non-JSON body");
  }

  return parseFlightStatus(json);
};
