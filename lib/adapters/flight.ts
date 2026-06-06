import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";
import { fetchFlight as fetchAeroDataBox } from "@/lib/adapters/aerodatabox";
import { fetchFlight as fetchAirLabs } from "@/lib/adapters/airlabs";
import { fetchFlight as fetchAviationStack } from "@/lib/adapters/aviationstack";
import { fetchSimulatedFlight } from "@/lib/adapters/simulator";

/**
 * The flight-status source, behind one switch. The whole reconciliation loop imports `fetchFlight`
 * from here, so swapping the provider touches nothing else.
 *
 * Provider resolution (FLIGHT_PROVIDER env var):
 *   simulator      -> keyless simulator (always works, no real data)
 *   airlabs        -> AirLabs (1,000 req/month free — set AIRLABS_KEY)
 *   aviationstack  -> AviationStack (100 req/month free — set AVIATIONSTACK_KEY)
 *   aerodatabox    -> AeroDataBox via RapidAPI (paid — set AERODATABOX_KEY)
 *   unset          -> auto-detect: airlabs > aviationstack > aerodatabox > simulator
 */
type Provider = "simulator" | "airlabs" | "aviationstack" | "aerodatabox";

export function resolveProvider(): Provider {
  const p = (process.env.FLIGHT_PROVIDER ?? "").trim().toLowerCase();
  if (p === "simulator") return "simulator";
  if (p === "airlabs") return "airlabs";
  if (p === "aviationstack") return "aviationstack";
  if (p === "aerodatabox") return "aerodatabox";

  // Auto-detect by key presence
  if (process.env.AIRLABS_KEY) return "airlabs";
  if (process.env.AVIATIONSTACK_KEY) return "aviationstack";
  if (process.env.AERODATABOX_KEY) return "aerodatabox";
  return "simulator";
}

export const fetchFlight = (
  flightNumber: string,
  dateIso: string,
): Promise<AdapterResult<FlightArrival>> => {
  switch (resolveProvider()) {
    case "airlabs":
      return fetchAirLabs(flightNumber, dateIso);
    case "aviationstack":
      return fetchAviationStack(flightNumber, dateIso);
    case "aerodatabox":
      return fetchAeroDataBox(flightNumber, dateIso);
    default:
      return fetchSimulatedFlight(flightNumber, dateIso);
  }
};
