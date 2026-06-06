import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";
import { fetchFlight as fetchRealFlight } from "@/lib/adapters/aerodatabox";
import { fetchSimulatedFlight } from "@/lib/adapters/simulator";

/**
 * The flight-status source, behind one switch. The whole reconciliation loop imports `fetchFlight`
 * from here, so swapping the provider touches nothing else.
 *
 * Defaults to the KEYLESS {@link fetchSimulatedFlight} simulator so the app runs end-to-end with ZERO
 * billing (no RapidAPI/AeroDataBox account). To use the real paid feed, set FLIGHT_PROVIDER=aerodatabox
 * AND provide AERODATABOX_KEY. The resolution:
 *   FLIGHT_PROVIDER=simulator   -> always simulate
 *   FLIGHT_PROVIDER=aerodatabox -> real feed (errors honestly if AERODATABOX_KEY is missing)
 *   unset                       -> real feed IFF AERODATABOX_KEY is present, otherwise simulate
 */
export function useSimulatedFlights(): boolean {
  const provider = (process.env.FLIGHT_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "simulator") return true;
  if (provider === "aerodatabox") return false;
  return !process.env.AERODATABOX_KEY;
}

export const fetchFlight = (
  flightNumber: string,
  dateIso: string,
): Promise<AdapterResult<FlightArrival>> =>
  useSimulatedFlights() ? fetchSimulatedFlight(flightNumber, dateIso) : fetchRealFlight(flightNumber, dateIso);
