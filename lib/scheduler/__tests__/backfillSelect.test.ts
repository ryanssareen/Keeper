import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { selectWatchesNeedingActual } from "@/lib/scheduler/backfillSelect";

/**
 * Integration coverage for the actual-arrival backfill candidate selector (U9). Runs only when
 * DATABASE_URL is set; skipped otherwise. db() is acquired lazily in beforeAll so a skipped run never
 * throws during collection.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("selectWatchesNeedingActual (integration)", () => {
  let sql: ReturnType<typeof db>;
  const created: string[] = [];

  beforeAll(() => {
    sql = db();
  });

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  /**
   * Insert a watch + its calibration row. `commitmentOffsetMin` shifts the commitment relative to now
   * (negative = already passed). `actual` / `diverted` / `terminal` drive the three candidate
   * predicates: actual_arrival presence, diversion, and terminal state.
   */
  async function makeWatch(opts: {
    commitmentOffsetMin?: number;
    terminal?: boolean;
    state?: string;
    actual?: string | null;
    diverted?: string | null;
  } = {}): Promise<string> {
    const { commitmentOffsetMin = -60, terminal = true, actual = null, diverted = null } = opts;
    const state = opts.state ?? (terminal ? "LANDED_CAPTURE" : "OK");
    const id = randomUUID();
    created.push(id);
    const commitment = new Date(Date.now() + commitmentOffsetMin * 60_000).toISOString();
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state, terminal)
      VALUES
        (${id}, ${id}, 'h', 'AA1', '2026-12-20', 'JFK',
         '2026-12-20 20:00:00', 'UTC', ${commitment}, 'P', true,
         0, 'default', 35, 30, 'osrm', true, ${state}, ${terminal})`;
    await sql`
      INSERT INTO calibration (watch_id, actual_arrival, diverted_to_airport)
      VALUES (${id}, ${actual}, ${diverted})`;
    return id;
  }

  it("selects a terminal, non-cancelled, in-window watch whose actual is still NULL", async () => {
    const landedNeedsActual = await makeWatch({ terminal: true, state: "LANDED_CAPTURE", commitmentOffsetMin: -30 });
    const definiteMiss = await makeWatch({ terminal: true, state: "DEFINITE_MISS", commitmentOffsetMin: -90 }); // flight lands late
    const nonTerminal = await makeWatch({ terminal: false, commitmentOffsetMin: -30 }); // still reconciling — not ours
    const cancelled = await makeWatch({ terminal: true, state: "CANCELLED", commitmentOffsetMin: -30 }); // never lands
    const tooOld = await makeWatch({ terminal: true, commitmentOffsetMin: -60 * 30 }); // 30h past — aged out of the window
    const alreadyHasActual = await makeWatch({ terminal: true, commitmentOffsetMin: -30, actual: "2026-12-20T18:40:00Z" });
    const diverted = await makeWatch({ terminal: true, commitmentOffsetMin: -30, diverted: "EWR" });

    const ids = await selectWatchesNeedingActual(500);
    expect(ids).toContain(landedNeedsActual);
    expect(ids).toContain(definiteMiss); // a missed-en-route flight still lands — backfill its actual
    expect(ids).not.toContain(nonTerminal); // non-terminal is the reconcile selector's job (no double-fetch)
    expect(ids).not.toContain(cancelled); // a cancelled flight never produces a landed actual
    expect(ids).not.toContain(tooOld); // past the window — give up rather than re-fetch forever
    expect(ids).not.toContain(alreadyHasActual); // actual already recorded — drops out
    expect(ids).not.toContain(diverted); // diversion is a known outcome — not re-fetched
  });

  it("orders most-overdue first and honors the limit (per-tick upstream ceiling)", async () => {
    const older = await makeWatch({ terminal: true, commitmentOffsetMin: -300 });
    const newer = await makeWatch({ terminal: true, commitmentOffsetMin: -10 });

    const mine = (await selectWatchesNeedingActual(500)).filter((id) => id === older || id === newer);
    expect(mine).toEqual([older, newer]); // older (more overdue) first

    expect(await selectWatchesNeedingActual(1)).toHaveLength(1);
  });
});
