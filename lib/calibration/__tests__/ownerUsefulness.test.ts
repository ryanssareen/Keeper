import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { setOwnerUsefulness } from "@/lib/calibration/writer";

// Integration: runs against the live DB when DATABASE_URL is set; otherwise skipped. Mirrors writer.test.ts.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("setOwnerUsefulness (integration)", () => {
  // Lazy: acquiring the connection at describe-body level would throw during collection on a
  // skipped (no-DB) run, defeating skipIf. beforeAll doesn't run for a skipped suite.
  let sql: ReturnType<typeof db>;
  const created: string[] = [];

  beforeAll(() => {
    sql = db();
  });

  // Insert a watch + its calibration row, matching the writer.test.ts fixture. Pass withCalibration:false
  // to arm a watch WITHOUT a calibration row (the armed-before-enrichment case).
  async function makeWatch(withCalibration = true): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state)
      VALUES
        (${id}, ${id}, 'h', 'AA1', '2026-12-20', 'JFK',
         '2026-12-20 20:00:00', 'Europe/Madrid', '2026-12-20T19:00:00Z', 'P', true,
         0, 'default', 35, 30, 'osrm', true, 'OK')`;
    if (withCalibration) await sql`INSERT INTO calibration (watch_id) VALUES (${id})`;
    return id;
  }

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  it("sets was_useful on an existing calibration row and reports updated:true", async () => {
    const w = await makeWatch();
    const res = await setOwnerUsefulness(w, true);
    expect(res).toEqual({ updated: true });
    const c = await sql`SELECT was_useful FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].was_useful).toBe(true);
  });

  it("toggles the latest answer (a re-affirm overwrites, no first-write-wins lock)", async () => {
    const w = await makeWatch();
    await setOwnerUsefulness(w, true);
    const res = await setOwnerUsefulness(w, false);
    expect(res).toEqual({ updated: true });
    const c = await sql`SELECT was_useful FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].was_useful).toBe(false);
  });

  it("writes was_useful ALONE without touching outcome / self_report_status (no CHECK violation)", async () => {
    const w = await makeWatch();
    await setOwnerUsefulness(w, true);
    const c = await sql`SELECT was_useful, outcome, self_report_status FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].was_useful).toBe(true);
    expect(c[0].outcome).toBeNull(); // outcome stays NULL — the answered<->outcome CHECK is never tripped
    expect(c[0].self_report_status).toBe("pending");
  });

  it("creates NOTHING and reports updated:false when no calibration row exists", async () => {
    const w = await makeWatch(false); // armed before enrichment — no calibration row
    const res = await setOwnerUsefulness(w, true);
    expect(res).toEqual({ updated: false });
    const c = await sql`SELECT count(*)::int AS n FROM calibration WHERE watch_id = ${w}`;
    expect(c[0].n).toBe(0); // never fabricated an outcome shell
  });
});
