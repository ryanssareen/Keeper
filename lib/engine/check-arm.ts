import { config } from "dotenv";
config({ path: ".env.local" });

import { armWatch } from "./arm";
import { db } from "@/lib/db";

// DEV: live end-to-end arm (real flight + OSM geocode/route + live DB), then clean up.
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const nowUtc = new Date().toISOString();
  const res = await armWatch(
    {
      deviceId: `check-${Date.now()}`,
      flightNumber: process.argv[2] ?? "EK1",
      flightDate: today,
      placeQuery: "Trafalgar Square, London",
      commitmentLocal: `${today}T14:00:00`,
      reschedulable: true,
      marginMinutes: 15,
      contact: "The venue",
    },
    nowUtc,
  );
  console.log(JSON.stringify(res, null, 2));

  if (res.ok) {
    const sql = db();
    const w = await sql`
      SELECT state, place_label, place_resolved, transit_minutes, transit_source,
             arrival_airport, commitment_zone, commitment_instant
      FROM watches WHERE id = ${res.watch.watchId}`;
    const snap = await sql`
      SELECT verdict, slack_minutes, resulting_state
      FROM prediction_snapshots WHERE watch_id = ${res.watch.watchId}`;
    console.log("watch row:", w[0]);
    console.log("snapshot: ", snap[0]);
    await sql`DELETE FROM watches WHERE id = ${res.watch.watchId}`;
    await sql.end();
    console.log("✅ armed, persisted, verified, cleaned up");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
