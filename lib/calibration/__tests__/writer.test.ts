import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  appendSnapshot,
  backfillActual,
  recordDelivery,
  recordSelfReport,
} from "@/lib/calibration/writer";
import type { PredictionSnapshot } from "@/lib/calibration/types";

// Integration: runs against the live DB when DATABASE_URL is set; otherwise skipped.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("calibration writer (integration)", () => {
  const sql = db();
  const created: string[] = [];

  async function makeWatch(airport = "JFK"): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state)
      VALUES
        (${id}, ${id}, 'h', 'AA1', '2026-12-20', ${airport},
         '2026-12-20 20:00:00', 'Europe/Madrid', '2026-12-20T19:00:00Z', 'P', true,
         0, 'default', 35, 30, 'osrm', true, 'OK')`;
    await sql`INSERT INTO calibration (watch_id) VALUES (${id})`;
    return id;
  }

  const snap = (watchId: string, over: Partial<PredictionSnapshot> = {}): PredictionSnapshot => ({
    watchId,
    fetchedAt: "2026-12-20T12:00:00Z",
    predictedArrivalUtc: "2026-12-20T18:30:00Z",
    transitMinutesUsed: 30,
    egressMinutesUsed: 35,
    marginMinutesUsed: 0,
    slackMinutes: 25,
    verdict: "make",
    resultingState: "OK",
    revision: "r1",
    firedTransition: null,
    ...over,
  });

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  it("appendSnapshot is idempotent on (watch, revision)", async () => {
    const w = await makeWatch();
    await appendSnapshot(snap(w, { revision: "rev-x" }));
    await appendSnapshot(snap(w, { revision: "rev-x", slackMinutes: 999 })); // same revision -> ignored
    const rows = await sql`
      SELECT count(*)::int AS n, max(slack_minutes) AS slack
      FROM prediction_snapshots WHERE watch_id = ${w}`;
    expect(rows[0].n).toBe(1);
    expect(rows[0].slack).toBe(25); // first write wins
  });

  it("appendSnapshot keeps distinct revisions as separate rows (the time series)", async () => {
    const w = await makeWatch();
    await appendSnapshot(snap(w, { revision: "a" }));
    await appendSnapshot(snap(w, { revision: "b", slackMinutes: -10, verdict: "miss" }));
    const rows = await sql`SELECT count(*)::int AS n FROM prediction_snapshots WHERE watch_id = ${w}`;
    expect(rows[0].n).toBe(2);
  });

  it("backfillActual is first-write-wins", async () => {
    const w = await makeWatch();
    await backfillActual(w, "2026-12-20T18:40:00Z", "JFK");
    await backfillActual(w, "2026-12-20T20:00:00Z", "JFK"); // later value ignored
    const c = await sql`SELECT actual_arrival FROM calibration WHERE watch_id = ${w}`;
    expect(new Date(c[0].actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z");
  });

  it("backfillActual records a diversion when the airport differs from baseline", async () => {
    const w = await makeWatch("JFK");
    await backfillActual(w, "2026-12-20T18:40:00Z", "EWR");
    const c = await sql`SELECT diverted_to_airport FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].diverted_to_airport).toBe("EWR");
  });

  it("recordSelfReport sets outcome + answered; an un-reported watch stays pending/NULL", async () => {
    const w = await makeWatch();
    await recordSelfReport(w, "made", true);
    const c = await sql`SELECT outcome, was_useful, self_report_status FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].outcome).toBe("made");
    expect(c[0].was_useful).toBe(true);
    expect(c[0].self_report_status).toBe("answered");

    const w2 = await makeWatch();
    const c2 = await sql`SELECT outcome, self_report_status FROM calibration WHERE watch_id = ${w2}`;
    expect(c2[0].outcome).toBeNull(); // non-response stays NULL, never "missed"
    expect(c2[0].self_report_status).toBe("pending");
  });

  it("recordDelivery updates a fired transition's status and stamps sent_at", async () => {
    const w = await makeWatch();
    await sql`INSERT INTO fired_transitions (watch_id, transition, revision, kind)
              VALUES (${w}, 'OK->AT_RISK', 'rd1', 'CATCH')`;
    await recordDelivery(w, "OK->AT_RISK", "rd1", "sent");
    const f = await sql`SELECT delivery_status, sent_at FROM fired_transitions WHERE watch_id = ${w}`;
    expect(f[0].delivery_status).toBe("sent");
    expect(f[0].sent_at).not.toBeNull();
  });

  it("seals only once both the actual and the self-report have landed", async () => {
    const w = await makeWatch();
    await backfillActual(w, "2026-12-20T18:40:00Z", "JFK");
    let c = await sql`SELECT enrichment_state FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].enrichment_state).toBe("awaiting_self_report");
    await recordSelfReport(w, "made", true);
    c = await sql`SELECT enrichment_state FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].enrichment_state).toBe("sealed");
  });
});
