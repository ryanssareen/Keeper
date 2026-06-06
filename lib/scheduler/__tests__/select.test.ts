import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { selectDueWatches } from "@/lib/scheduler/select";

/**
 * Integration coverage for the due-watch selector (U7). Runs only when DATABASE_URL is set; skipped
 * otherwise. db() is acquired lazily in beforeAll so a skipped run never throws during collection.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("selectDueWatches (integration)", () => {
  let sql: ReturnType<typeof db>;
  const created: string[] = [];

  beforeAll(() => {
    sql = db();
  });

  /** Insert a watch with an explicit next_poll_at offset (minutes from now; null = unscheduled). */
  async function makeWatch(opts: {
    pollOffsetMinutes: number | null;
    terminal?: boolean;
    flightNumber?: string;
  }): Promise<string> {
    const id = randomUUID();
    created.push(id);
    const pollExpr =
      opts.pollOffsetMinutes === null
        ? null
        : new Date(Date.now() + opts.pollOffsetMinutes * 60_000).toISOString();
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state, next_poll_at, terminal)
      VALUES
        (${id}, ${id}, 'h', ${opts.flightNumber ?? "AA1"}, '2026-12-20', 'JFK',
         '2026-12-20 20:00:00', 'UTC', '2026-12-20T20:00:00Z', 'P', true,
         0, 'default', 35, 30, 'osrm', true, 'OK', ${pollExpr}, ${opts.terminal ?? false})`;
    return id;
  }

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  it("returns only non-terminal watches whose next_poll_at has passed", async () => {
    const duePast = await makeWatch({ pollOffsetMinutes: -5 });
    const future = await makeWatch({ pollOffsetMinutes: 60 });
    const unscheduled = await makeWatch({ pollOffsetMinutes: null });
    const terminalPast = await makeWatch({ pollOffsetMinutes: -5, terminal: true });

    const ids = (await selectDueWatches(100)).map((w) => w.id);
    expect(ids).toContain(duePast);
    expect(ids).not.toContain(future);
    expect(ids).not.toContain(unscheduled);
    expect(ids).not.toContain(terminalPast);
  });

  it("orders most-due first and honors the limit", async () => {
    const older = await makeWatch({ pollOffsetMinutes: -30, flightNumber: "ZZ30" });
    const newer = await makeWatch({ pollOffsetMinutes: -1, flightNumber: "ZZ1" });

    const mine = (await selectDueWatches(500)).filter((w) => w.id === older || w.id === newer);
    expect(mine.map((w) => w.id)).toEqual([older, newer]); // older (more overdue) first

    const limited = await selectDueWatches(1);
    expect(limited).toHaveLength(1);
  });

  it("projects flight number and a YYYY-MM-DD date string", async () => {
    const id = await makeWatch({ pollOffsetMinutes: -2, flightNumber: "BA75" });
    const row = (await selectDueWatches(500)).find((w) => w.id === id);
    expect(row).toMatchObject({ flightNumber: "BA75", flightDate: "2026-12-20" });
  });
});
