import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { db } from "./index";

// U1 gate: seed insert/select across the corpus tables, then clean up.
config({ path: ".env.local" });

async function main() {
  const sql = db();
  const id = randomUUID();
  try {
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date,
         commitment_local, commitment_zone, commitment_instant, place_label,
         place_resolved, margin_minutes, margin_source, egress_minutes,
         transit_minutes, transit_source, reschedulable, state)
      VALUES
        (${id}, 'smoke-device', 'smoke-hash', 'AA123', '2026-12-20',
         '2026-12-20 20:00:00', 'Europe/Madrid', '2026-12-20T19:00:00Z', 'Test Place',
         true, 0, 'default', 35,
         30, 'mapbox', true, 'OK')`;

    await sql`
      INSERT INTO prediction_snapshots
        (watch_id, fetched_at, predicted_arrival, transit_minutes_used,
         egress_minutes_used, margin_minutes_used, slack_minutes, verdict, resulting_state, revision)
      VALUES
        (${id}, now(), '2026-12-20T18:30:00Z', 30, 35, 0, 25, 'make', 'OK', 'rev-1')`;

    await sql`
      INSERT INTO fired_transitions (watch_id, transition, revision, kind)
      VALUES (${id}, 'AT_RISK->MISS_PREDICTED', 'rev-2', 'CATCH')`;

    await sql`INSERT INTO calibration (watch_id) VALUES (${id})`;

    const watch = await sql`SELECT id, state FROM watches WHERE id = ${id}`;
    const snaps = await sql`SELECT count(*)::int AS n FROM prediction_snapshots WHERE watch_id = ${id}`;
    const cal = await sql`SELECT self_report_status, enrichment_state FROM calibration WHERE watch_id = ${id}`;

    console.log("watch:       ", watch[0]);
    console.log("snapshots:   ", snaps[0]);
    console.log("calibration: ", cal[0]);

    // Cleanup cascades to prediction_snapshots, fired_transitions, calibration.
    await sql`DELETE FROM watches WHERE id = ${id}`;

    console.log("✅ U1 gate passed: seed insert/select/cleanup succeeded across all corpus tables.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌ smoke failed:", e);
  process.exit(1);
});
