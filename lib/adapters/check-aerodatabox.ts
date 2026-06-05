import { config } from "dotenv";
import { fetchFlight } from "./aerodatabox";

// DEV: verify the AeroDataBox key authenticates against a live flight.
// Usage: pnpm exec tsx lib/adapters/check-aerodatabox.ts [FLIGHT_NUMBER]
config({ path: ".env.local" });

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const flight = process.argv[2] ?? "EK1";
  console.log(`Querying ${flight} for ${date} ...`);
  const result = await fetchFlight(flight, date);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
