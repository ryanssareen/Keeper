import { DateTime } from "luxon";
import { ok, notFound, type AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival, FlightStatus } from "@/lib/engine/types";

/**
 * Keyless flight simulator — a zero-billing stand-in for the AeroDataBox adapter (U3).
 *
 * It produces the SAME {@link FlightArrival} contract `fetchFlight` returns, but deterministically
 * from (flightNumber, date) instead of a paid API: a flight number maps to a stable scenario and a
 * scheduled-arrival instant, and the predicted arrival EVOLVES with `now` — a delay ramps up as the
 * flight nears its slot — so the reconcile loop sees a real, growing collision and fires a catch.
 * Pure and fully unit-testable (`now` is a parameter); the `fetchSimulatedFlight` wrapper supplies
 * the wall clock to match the `fetchFlight(flightNumber, dateIso)` signature.
 *
 * Scenario control: the flight number drives it deterministically, with explicit demo markers —
 *   ...DLY / ...LATE  -> a large, catch-triggering delay
 *   ...CNCL / ...CXL  -> cancelled (terminal miss)
 *   ...DVT / ...DVRT  -> diverted to a different airport
 * otherwise a hash of the number picks on-time (most), a minor delay, or a major delay.
 */

export type SimScenario = "on_time" | "minor_delay" | "major_delay" | "cancelled" | "diverted";

/** Real IATA codes so the keyless OSM geocoder (`"<code> airport"`) resolves the arrival airport. */
const AIRPORTS = ["SFO", "JFK", "LHR", "LAX", "ORD", "SEA", "BOS", "DEN", "ATL", "DFW", "AMS", "SIN"];

/** Deterministic 32-bit FNV-1a hash → an unsigned int, so a flight number maps to a stable scenario. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function scenarioFor(flightNumber: string): SimScenario {
  const f = flightNumber.toUpperCase();
  if (f.includes("CNCL") || f.includes("CXL")) return "cancelled";
  if (f.includes("DVRT") || f.includes("DVT")) return "diverted";
  if (f.includes("DLY") || f.includes("LATE")) return "major_delay";
  const r = hash(f) % 100;
  if (r < 65) return "on_time";
  if (r < 88) return "minor_delay";
  return "major_delay";
}

const FINAL_DELAY_MINUTES: Record<SimScenario, number> = {
  on_time: 0,
  minor_delay: 25,
  major_delay: 95,
  diverted: 50,
  cancelled: 0,
};

interface Schedule {
  scheduledArrival: DateTime;
  scheduledDeparture: DateTime;
  baseAirport: string;
  divertAirport: string;
  scenario: SimScenario;
}

/** Derive a stable schedule + airports for a flight on a given date from its hash. */
function scheduleFor(flightNumber: string, dateIso: string): Schedule | null {
  const h = hash(`${flightNumber}|${dateIso}`);
  const day = DateTime.fromISO(dateIso, { zone: "utc" });
  if (!day.isValid) return null;
  // Arrivals 08:00–19:59 UTC; flight duration 2–6h. Use UNSIGNED shifts (`>>>`): `h` is a 32-bit
  // unsigned hash, but a signed `>>` reintroduces the sign bit, and JS `negative % n` is negative —
  // which would collapse the duration to 0 (no in-air window) or push the minute negative. `>>>`
  // keeps every derived field non-negative so duration ∈ [2,6] and minute ∈ [0,59] always hold.
  const scheduledArrival = day.set({ hour: 8 + (h % 12), minute: (h >>> 4) % 60, second: 0, millisecond: 0 });
  const durationHours = 2 + ((h >>> 8) % 5);
  const baseAirport = AIRPORTS[h % AIRPORTS.length];
  const divertAirport = AIRPORTS[(h + 5) % AIRPORTS.length] === baseAirport
    ? AIRPORTS[(h + 6) % AIRPORTS.length]
    : AIRPORTS[(h + 5) % AIRPORTS.length];
  return {
    scheduledArrival,
    scheduledDeparture: scheduledArrival.minus({ hours: durationHours }),
    baseAirport,
    divertAirport,
    scenario: scenarioFor(flightNumber),
  };
}

/** Delay (minutes), rounded to 5-min steps so the revision changes in discrete jumps, ramping from 0
 *  ~3h before the slot to the scenario's final delay at the slot. A flight watched early reads on-time
 *  and slips as it nears — exactly the signal the engine must catch with lead time. */
function currentDelayMinutes(scenario: SimScenario, scheduledArrival: DateTime, now: DateTime): number {
  const final = FINAL_DELAY_MINUTES[scenario];
  if (final === 0) return 0;
  const visibleFrom = scheduledArrival.minus({ hours: 3 });
  const span = scheduledArrival.toMillis() - visibleFrom.toMillis();
  const progress = Math.min(1, Math.max(0, (now.toMillis() - visibleFrom.toMillis()) / span));
  return Math.round((final * progress) / 5) * 5;
}

const iso = (dt: DateTime): string => dt.toUTC().toISO({ suppressMilliseconds: true }) as string;

/**
 * PURE: simulate one flight datum at instant `now`. Mirrors {@link FlightArrival}; the `revision`
 * fingerprint matches the AeroDataBox adapter (predicted | status | airport) so dedup is consistent.
 */
export function simulateFlight(
  flightNumber: string,
  dateIso: string,
  nowUtc: string,
): AdapterResult<FlightArrival> {
  const sched = scheduleFor(flightNumber, dateIso);
  if (!sched) return notFound();
  const now = DateTime.fromISO(nowUtc, { zone: "utc" });
  // Guard an unparseable clock the same way dateIso is guarded above: collapse to an AdapterResult
  // rather than throwing. Without this, an invalid `now` makes every comparison below false (silently
  // "landing" the flight) and, for a delayed scenario, drives currentDelayMinutes to NaN — which makes
  // `scheduledArrival.plus({ minutes: NaN })` THROW, violating the never-throws contract.
  if (!now.isValid) return notFound();

  const { scheduledArrival, scheduledDeparture, baseAirport, divertAirport, scenario } = sched;
  const scheduledUtc = iso(scheduledArrival);

  // Cancellation announces around departure and is terminal — no usable ETA, status carries it.
  if (scenario === "cancelled" && now >= scheduledDeparture) {
    const revision = `${scheduledUtc}|cancelled|${baseAirport}`;
    return ok({ scheduledUtc, predictedUtc: scheduledUtc, actualUtc: null, status: "cancelled", arrivalAirport: baseAirport, revision });
  }

  const delay = currentDelayMinutes(scenario, scheduledArrival, now);
  const predictedArrival = scheduledArrival.plus({ minutes: delay });
  const predictedUtc = iso(predictedArrival);

  // Diversions surface within ~45 min of the (delayed) arrival and change the airport.
  const diverting = scenario === "diverted" && now >= predictedArrival.minus({ minutes: 45 });
  const airport = diverting ? divertAirport : baseAirport;

  let status: FlightStatus;
  let actualUtc: string | null = null;
  if (now < scheduledDeparture) {
    status = "scheduled";
  } else if (now < predictedArrival) {
    status = diverting ? "diverted" : "active";
  } else {
    status = diverting ? "diverted" : "landed";
    // Only a true landing AT THE WATCHED AIRPORT has a runway (actual) time. A diversion leaves the
    // watched airport's runwayTime absent — matching AeroDataBox, which sources actualUtc solely from
    // runwayTime — so a diverted datum must keep actualUtc null. Setting it here would let
    // actualFromFlight (backfill) fabricate a landed actual at the divert airport, poisoning the corpus.
    if (!diverting) actualUtc = predictedUtc; // the realized arrival
  }

  const revision = `${predictedUtc}|${status}|${airport}`;
  return ok({ scheduledUtc, predictedUtc, actualUtc, status, arrivalAirport: airport, revision });
}

/**
 * `fetchFlight`-compatible wrapper: supplies the wall clock to the pure simulator. Never throws,
 * never makes a network call, never needs a key — the zero-billing flight source.
 */
export const fetchSimulatedFlight = async (
  flightNumber: string,
  dateIso: string,
): Promise<AdapterResult<FlightArrival>> => simulateFlight(flightNumber, dateIso, new Date().toISOString());
