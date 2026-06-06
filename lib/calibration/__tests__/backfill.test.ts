import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";

import { actualFromFlight, SELF_REPORT_WINDOW_MINUTES } from "@/lib/calibration/backfill";
import type { FlightArrival } from "@/lib/engine/types";
import type { AdapterResult } from "@/lib/adapters/result";

// ---------------------------------------------------------------------------------------------
// Mock the live adapter so the IO backfill shell is exercised without a RapidAPI key. Each test
// sets the next result. parseFlightStatus stays the real, separately-tested mapper.
// ---------------------------------------------------------------------------------------------
let nextFetchResult: AdapterResult<FlightArrival> = { kind: "not_found" };
vi.mock("@/lib/adapters/flight", () => ({
  fetchFlight: vi.fn(async (): Promise<AdapterResult<FlightArrival>> => nextFetchResult),
}));

const flight = (over: Partial<FlightArrival> = {}): FlightArrival => ({
  scheduledUtc: "2026-12-20T18:00:00Z",
  predictedUtc: "2026-12-20T18:20:00Z",
  actualUtc: null,
  status: "active",
  arrivalAirport: "JFK",
  revision: "r",
  ...over,
});

// =============================================================================================
// PURE: actualFromFlight — always runs (no DB).
// =============================================================================================
describe("actualFromFlight (pure)", () => {
  it("returns null while the flight is still en route (no actual, not landed)", () => {
    expect(actualFromFlight(flight({ status: "active", actualUtc: null }))).toBeNull();
    expect(actualFromFlight(flight({ status: "scheduled", actualUtc: null }))).toBeNull();
  });

  it("lands on an explicit runway time even when status still reads active", () => {
    const got = actualFromFlight(flight({ status: "active", actualUtc: "2026-12-20T18:40:00Z" }));
    expect(got).toEqual({ actualUtc: "2026-12-20T18:40:00Z", arrivalAirport: "JFK" });
  });

  it("lands on a 'landed' status, preferring the true runway time", () => {
    const got = actualFromFlight(
      flight({ status: "landed", actualUtc: "2026-12-20T18:42:00Z", predictedUtc: "2026-12-20T18:20:00Z" }),
    );
    expect(got).toEqual({ actualUtc: "2026-12-20T18:42:00Z", arrivalAirport: "JFK" });
  });

  it("falls back to revised, then scheduled, when status is landed but the runway time lags", () => {
    expect(
      actualFromFlight(flight({ status: "landed", actualUtc: null, predictedUtc: "2026-12-20T18:25:00Z" })),
    ).toEqual({ actualUtc: "2026-12-20T18:25:00Z", arrivalAirport: "JFK" });

    expect(
      actualFromFlight(
        flight({ status: "landed", actualUtc: null, predictedUtc: null, scheduledUtc: "2026-12-20T18:00:00Z" }),
      ),
    ).toEqual({ actualUtc: "2026-12-20T18:00:00Z", arrivalAirport: "JFK" });
  });

  it("returns null when it claims landed but carries no usable instant (nothing honest to write)", () => {
    expect(
      actualFromFlight(flight({ status: "landed", actualUtc: null, predictedUtc: null, scheduledUtc: null })),
    ).toBeNull();
  });

  it("does not treat a diversion or cancellation as a landed actual at the watched airport", () => {
    expect(actualFromFlight(flight({ status: "diverted", actualUtc: null }))).toBeNull();
    expect(actualFromFlight(flight({ status: "cancelled", actualUtc: null }))).toBeNull();
  });

  it("carries the arrival airport through (diversion detection happens in the writer)", () => {
    const got = actualFromFlight(flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z", arrivalAirport: "EWR" }));
    expect(got?.arrivalAirport).toBe("EWR");
  });
});

// =============================================================================================
// INTEGRATION: backfill orchestration, expiry sweep, and the route — DB-gated.
// =============================================================================================
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("calibration backfill + self-report (integration)", () => {
  // Lazy import: pulling these in at module top level would import @/lib/db's lazy client fine, but
  // we acquire the live connection only inside beforeAll so a skipped (no-DB) run never connects.
  let sql: import("postgres").Sql;
  let backfillActualForWatch: typeof import("@/lib/calibration/backfill").backfillActualForWatch;
  let expireStaleSelfReports: typeof import("@/lib/calibration/backfill").expireStaleSelfReports;
  let POST: typeof import("@/app/api/self-report/route").POST;
  const created: string[] = [];

  beforeAll(async () => {
    const dbMod = await import("@/lib/db");
    sql = dbMod.db();
    ({ backfillActualForWatch, expireStaleSelfReports } = await import("@/lib/calibration/backfill"));
    ({ POST } = await import("@/app/api/self-report/route"));
  });

  afterAll(async () => {
    for (const id of created) await sql`DELETE FROM watches WHERE id = ${id}`;
    await sql.end();
  });

  /**
   * Insert a watch + its calibration row. `commitmentOffsetMin` shifts the commitment relative to
   * now (negative = already passed) so the expiry sweep can be driven deterministically. Returns the
   * watch id and the raw capability token (only its hash is stored).
   */
  async function makeWatch(opts: {
    airport?: string;
    commitmentOffsetMin?: number;
    selfReportStatus?: string;
  } = {}): Promise<{ id: string; token: string }> {
    const { airport = "JFK", commitmentOffsetMin = -120, selfReportStatus = "pending" } = opts;
    const id = randomUUID();
    const token = randomBytes(16).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    created.push(id);
    const commitment = new Date(Date.now() + commitmentOffsetMin * 60_000).toISOString();
    await sql`
      INSERT INTO watches
        (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
         commitment_local, commitment_zone, commitment_instant, place_label, place_resolved,
         margin_minutes, margin_source, egress_minutes, transit_minutes, transit_source,
         reschedulable, state)
      VALUES
        (${id}, ${id}, ${hash}, 'AA1', '2026-12-20', ${airport},
         '2026-12-20 20:00:00', 'America/New_York', ${commitment}, 'P', true,
         0, 'default', 35, 30, 'osrm', true, 'OK')`;
    await sql`INSERT INTO calibration (watch_id, self_report_status) VALUES (${id}, ${selfReportStatus})`;
    return { id, token };
  }

  const cal = (watchId: string) =>
    sql`SELECT actual_arrival, diverted_to_airport, self_report_status, outcome, was_useful, enrichment_state
        FROM calibration WHERE watch_id = ${watchId}`;

  it("clean trip: a landed flight backfills the actual and the self-report still records", async () => {
    const { id, token } = await makeWatch();
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z", arrivalAirport: "JFK" }) };

    const attempted = await backfillActualForWatch(id);
    expect(attempted).toBe(true);

    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: id, token, outcome: "made", wasUseful: true }),
      }),
    );
    expect(res.status).toBe(200);

    const c = (await cal(id))[0];
    expect(new Date(c.actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z");
    expect(c.self_report_status).toBe("answered");
    expect(c.outcome).toBe("made");
    expect(c.was_useful).toBe(true);
    expect(c.enrichment_state).toBe("sealed"); // both halves present
  });

  it("not-ok adapter result is a no-op (try again later)", async () => {
    const { id } = await makeWatch();
    nextFetchResult = { kind: "rate_limited", retryAfterMs: 1000 };
    expect(await backfillActualForWatch(id)).toBe(false);
    expect((await cal(id))[0].actual_arrival).toBeNull();

    nextFetchResult = { kind: "error", message: "boom" };
    expect(await backfillActualForWatch(id)).toBe(false);
    expect((await cal(id))[0].actual_arrival).toBeNull();
  });

  it("a not-yet-landed flight records nothing", async () => {
    const { id } = await makeWatch();
    nextFetchResult = { kind: "ok", data: flight({ status: "active", actualUtc: null }) };
    expect(await backfillActualForWatch(id)).toBe(false);
    expect((await cal(id))[0].actual_arrival).toBeNull();
  });

  it("unanswered prompt expires to status=expired with outcome NULL, actual still recorded", async () => {
    const { id } = await makeWatch({ commitmentOffsetMin: -120 }); // commitment well past the window

    // The flight-actual is captured independently of the (unanswered) self-report.
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z" }) };
    await backfillActualForWatch(id);

    const swept = await expireStaleSelfReports();
    expect(swept).toBeGreaterThanOrEqual(1);

    const c = (await cal(id))[0];
    expect(c.self_report_status).toBe("expired");
    expect(c.outcome).toBeNull(); // non-response never coerced to "missed"
    expect(new Date(c.actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z");
  });

  it("expiry sweep leaves a watch whose commitment is still within the window untouched", async () => {
    const { id } = await makeWatch({ commitmentOffsetMin: -1 }); // 1 min past — inside the window
    await expireStaleSelfReports();
    expect((await cal(id))[0].self_report_status).toBe("pending");
  });

  it("self-report before landing saves the outcome now; a later backfill does not clobber it", async () => {
    const { id, token } = await makeWatch();

    // Answer first, before any actual exists.
    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: id, token, outcome: "made", wasUseful: false }),
      }),
    );
    expect(res.status).toBe(200);
    let c = (await cal(id))[0];
    expect(c.outcome).toBe("made");
    expect(c.actual_arrival).toBeNull();
    expect(c.enrichment_state).toBe("awaiting_actual");

    // Backfill later — must not null-clobber the outcome, and should seal.
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z" }) };
    await backfillActualForWatch(id);
    c = (await cal(id))[0];
    expect(c.outcome).toBe("made"); // preserved
    expect(new Date(c.actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z");
    expect(c.enrichment_state).toBe("sealed");
  });

  it("a late/revised actual keeps the first real actual; a diversion writes diverted_to_airport", async () => {
    const { id } = await makeWatch({ airport: "JFK" });

    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z", arrivalAirport: "JFK" }) };
    await backfillActualForWatch(id);

    // A later poll reports a revised (wrong, later) actual at a different airport — first write wins,
    // but our first write was at JFK so no diversion is recorded here.
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T20:00:00Z", arrivalAirport: "JFK" }) };
    await backfillActualForWatch(id);

    const c = (await cal(id))[0];
    expect(new Date(c.actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z"); // first real actual kept
    expect(c.diverted_to_airport).toBeNull();

    // A separate watch whose first landed actual is at a different airport => diversion recorded.
    const div = await makeWatch({ airport: "JFK" });
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:50:00Z", arrivalAirport: "EWR" }) };
    await backfillActualForWatch(div.id);
    expect((await cal(div.id))[0].diverted_to_airport).toBe("EWR");
  });

  it("a late answer after expiry STILL WINS (recordSelfReport updates pending OR expired)", async () => {
    const { id, token } = await makeWatch({ commitmentOffsetMin: -120 });
    await expireStaleSelfReports();
    expect((await cal(id))[0].self_report_status).toBe("expired");

    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: id, token, outcome: "missed", wasUseful: false }),
      }),
    );
    expect(res.status).toBe(200);
    const c = (await cal(id))[0];
    expect(c.self_report_status).toBe("answered"); // expired -> answered
    expect(c.outcome).toBe("missed");
  });

  it("self-report POST without a valid capability token is rejected 403", async () => {
    const { id } = await makeWatch();
    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: id, token: "not-the-real-token", outcome: "made" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await cal(id))[0].self_report_status).toBe("pending"); // untouched
  });

  it("self-report POST for a missing watch is 403 (uniform denial — no existence oracle)", async () => {
    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: randomUUID(), token: "x", outcome: "made" }),
      }),
    );
    expect(res.status).toBe(403); // a missing watch and a bad token are indistinguishable
  });

  it("self-report POST with a malformed body is 400", async () => {
    const res = await POST(
      new Request("http://t/api/self-report", {
        method: "POST",
        body: JSON.stringify({ watchId: "w", token: "t", outcome: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("concurrent backfill + self-report do not clobber (column-scoped writes)", async () => {
    const { id, token } = await makeWatch();
    nextFetchResult = { kind: "ok", data: flight({ status: "landed", actualUtc: "2026-12-20T18:40:00Z" }) };

    await Promise.all([
      backfillActualForWatch(id),
      POST(
        new Request("http://t/api/self-report", {
          method: "POST",
          body: JSON.stringify({ watchId: id, token, outcome: "made", wasUseful: true }),
        }),
      ),
    ]);

    const c = (await cal(id))[0];
    expect(new Date(c.actual_arrival).toISOString()).toBe("2026-12-20T18:40:00.000Z");
    expect(c.outcome).toBe("made");
    expect(c.was_useful).toBe(true);
    expect(c.self_report_status).toBe("answered");
    expect(c.enrichment_state).toBe("sealed"); // both halves landed regardless of interleave
  });

  it("the self-report window is the engine's usable-lead scale", () => {
    expect(SELF_REPORT_WINDOW_MINUTES).toBe(30);
  });
});
