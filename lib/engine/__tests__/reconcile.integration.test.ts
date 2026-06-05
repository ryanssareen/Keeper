import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { reconcileWatch, type FlightFetch } from "@/lib/engine/reconcile";
import type { FlightArrival, WatchState } from "@/lib/engine/types";

/**
 * Integration coverage for the reconcile transaction (U6) — the parts the pure planner can't prove:
 * atomic snapshot + outbox commit, persisted recovery dwell across ticks, and exactly-once behavior
 * under replay AND genuine concurrency. Runs only when DATABASE_URL is set; skipped otherwise.
 *
 * db() is acquired lazily in beforeAll (not at describe-body level) so a skipped run never throws.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

// Geometry: commitment 20:00Z, margin 0, egress 35 + transit 30 = 65 min buffer → deadline 20:00Z.
const NOW = "2026-12-20T17:00:00.000Z";

const flight = (predictedUtc: string | null, over: Partial<FlightArrival> = {}): FlightArrival => ({
  scheduledUtc: "2026-12-20T17:00:00Z",
  predictedUtc,
  actualUtc: null,
  status: "active",
  arrivalAirport: "JFK",
  revision: "r-new",
  ...over,
});

const fresh = (f: FlightArrival): FlightFetch => ({ kind: "fresh", flight: f });

describe.skipIf(!hasDb)("reconcileWatch (integration)", () => {
  let sql: ReturnType<typeof db>;
  const created: string[] = [];

  beforeAll(() => {
    sql = db();
  });

  async function makeWatch(state: WatchState, revision: string, recoveryProgress = 0): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state, revision, recovery_progress)
      VALUES
        (${id}, ${id}, 'h', 'AA1', '2026-12-20', 'JFK',
         '2026-12-20 20:00:00', 'UTC', '2026-12-20T20:00:00Z', 'P', true,
         0, 'default', 35, 30, 'osrm', true, ${state}, ${revision}, ${recoveryProgress})`;
    await sql`INSERT INTO calibration (watch_id) VALUES (${id})`;
    return id;
  }

  const counts = async (id: string) => {
    const s = await sql`SELECT count(*)::int AS n FROM prediction_snapshots WHERE watch_id = ${id}`;
    const f = await sql`SELECT count(*)::int AS n FROM fired_transitions WHERE watch_id = ${id}`;
    return { snapshots: s[0].n as number, fired: f[0].n as number };
  };

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  it("a threshold cross commits the state, snapshot, and exactly one CATCH outbox row together", async () => {
    const w = await makeWatch("AT_RISK", "r0");
    const out = await reconcileWatch(w, fresh(flight("2026-12-20T19:15:00Z", { revision: "rMISS" })), NOW);

    expect(out).toMatchObject({ kind: "applied", state: "MISS_PREDICTED" });

    const watch = await sql`SELECT state, revision, recovery_progress, next_poll_at FROM watches WHERE id = ${w}`;
    expect(watch[0].state).toBe("MISS_PREDICTED");
    expect(watch[0].revision).toBe("rMISS");
    expect(watch[0].next_poll_at).not.toBeNull();

    const fired = await sql`
      SELECT transition, kind, lead_time_minutes, useful_lead, delivery_status
      FROM fired_transitions WHERE watch_id = ${w}`;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      transition: "AT_RISK->MISS_PREDICTED",
      kind: "CATCH",
      lead_time_minutes: 150,
      useful_lead: true,
      delivery_status: "attempting",
    });

    expect((await counts(w)).snapshots).toBe(1);
  });

  it("a replay at the same revision is a no-op: no second snapshot, no second catch", async () => {
    const w = await makeWatch("AT_RISK", "r0");
    const miss = fresh(flight("2026-12-20T19:15:00Z", { revision: "rMISS" }));

    const first = await reconcileWatch(w, miss, NOW);
    const second = await reconcileWatch(w, miss, NOW); // identical revision

    expect(first.kind).toBe("applied");
    expect(second).toMatchObject({ kind: "skipped", reason: "unchanged" });
    expect(await counts(w)).toEqual({ snapshots: 1, fired: 1 });
  });

  it("two concurrent reconciles at the same new revision fire exactly once (idempotent under overlap)", async () => {
    const w = await makeWatch("AT_RISK", "r0");
    const miss = fresh(flight("2026-12-20T19:15:00Z", { revision: "rMISS2" }));

    const [a, b] = await Promise.all([reconcileWatch(w, miss, NOW), reconcileWatch(w, miss, NOW)]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["applied", "skipped"]); // FOR UPDATE serializes; the loser sees no change
    // The loser blocked on FOR UPDATE, then re-read the winner's committed revision → dedup gate.
    const loser = [a, b].find((r) => r.kind === "skipped");
    expect(loser).toMatchObject({ kind: "skipped", reason: "unchanged" });
    expect(await counts(w)).toEqual({ snapshots: 1, fired: 1 });
  });

  it("returns {kind:'missing'} for an unknown watch id without writing anything", async () => {
    const out = await reconcileWatch(randomUUID(), fresh(flight("2026-12-20T19:15:00Z")), NOW);
    expect(out).toEqual({ kind: "missing" });
  });

  it("recovery dwell persists across ticks: ALL_CLEAR fires only on the second sustained update", async () => {
    const w = await makeWatch("MISS_PREDICTED", "r0", 0);
    const recovering = "2026-12-20T18:40:00Z"; // projected 19:45 → slack 15 (≥ recovery band 10)

    const t1 = await reconcileWatch(w, fresh(flight(recovering, { revision: "rRec1" })), NOW);
    const afterT1 = await sql`SELECT state, recovery_progress FROM watches WHERE id = ${w}`;
    expect(t1).toMatchObject({ kind: "applied", state: "MISS_PREDICTED" }); // dwell building, no fire
    expect((t1 as { fired: unknown }).fired).toBeNull();
    expect(afterT1[0].recovery_progress).toBe(1);

    const t2 = await reconcileWatch(w, fresh(flight(recovering, { revision: "rRec2" })), NOW);
    const afterT2 = await sql`SELECT state, recovery_progress FROM watches WHERE id = ${w}`;
    expect(t2).toMatchObject({ kind: "applied", state: "RECOVERED" });
    expect(afterT2[0].recovery_progress).toBe(2);

    const fired = await sql`SELECT kind FROM fired_transitions WHERE watch_id = ${w} ORDER BY id`;
    expect(fired.map((r) => r.kind)).toEqual(["ALL_CLEAR"]); // exactly one, on t2
  });
});
