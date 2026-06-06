/**
 * Diagnostic script — test whichever free flight provider is configured.
 *
 * Usage:
 *   npx tsx lib/adapters/check-flight.ts [FLIGHT_NUMBER]
 *   npx tsx lib/adapters/check-flight.ts BA75
 *
 * Reads AIRLABS_KEY / AVIATIONSTACK_KEY / AERODATABOX_KEY from .env.local via dotenv.
 * Prints the raw result and which provider was used.
 *
 * Sign-up links (both free, no credit card):
 *   AirLabs:       https://airlabs.co/            -> set AIRLABS_KEY
 *   AviationStack: https://aviationstack.com/      -> set AVIATIONSTACK_KEY
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

import { fetchFlight, resolveProvider } from "./flight";

const flightNumber = process.argv[2] ?? "BA75";
const dateIso = new Date().toISOString().slice(0, 10);
const provider = resolveProvider();

console.log(`Provider : ${provider}`);
console.log(`Flight   : ${flightNumber}`);
console.log(`Date     : ${dateIso}`);
console.log("---");

void (async () => {
  const result = await fetchFlight(flightNumber, dateIso);
  console.log(JSON.stringify(result, null, 2));
})();
