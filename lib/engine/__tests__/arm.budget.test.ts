import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Focused test of the monthly-spend circuit-breaker WIRING inside armWatch (R24, Task 3). The pure
 * `budgetOk` decision is unit-tested in lib/security/__tests__/ratelimit.test.ts; here we prove the
 * arm flow consults it correctly:
 *   - MONTHLY_BUDGET_UNITS unset / non-positive => the gate is SKIPPED entirely (never rejects).
 *   - a positive threshold => arming past the month-to-date spend proxy is refused with a clear
 *     reason, BEFORE any upstream fetch is paid for.
 *
 * We mock arm.ts's IO collaborators. `db()` returns a tagged-template stub whose results are queued
 * in call order: call 1 is the per-device active-watch cap (kept low so the cap always passes), call
 * 2 (only reached when a budget IS configured) is the month-to-date spend proxy. When the budget gate
 * passes (or is skipped), the flow reaches fetchFlight, which we stub to `not_found` so it
 * short-circuits with a DISTINCT reason — proving the gate let it through rather than rejecting.
 */

const sqlResults: unknown[][] = [];
const sqlTag = vi.fn(() => Promise.resolve(sqlResults.shift() ?? []));
vi.mock("@/lib/db", () => ({ db: () => sqlTag }));

const fetchFlight = vi.fn();
vi.mock("@/lib/adapters/aerodatabox", () => ({ fetchFlight: (...a: unknown[]) => fetchFlight(...a) }));

// Place/geocode/token/writer collaborators are never reached in these tests (we stop at fetchFlight),
// but they're imported by arm.ts, so stub them to keep the module graph self-contained.
vi.mock("@/lib/adapters/osm", () => ({ geocodeAirport: vi.fn(), resolvePlace: vi.fn() }));
vi.mock("@/lib/security/capability", () => ({ mintToken: vi.fn(), hashToken: vi.fn() }));
vi.mock("@/lib/calibration/writer", () => ({ appendSnapshot: vi.fn() }));

import { armWatch, type ArmRequest } from "@/lib/engine/arm";

const baseReq: ArmRequest = {
  deviceId: "device-budget-test",
  flightNumber: "AA1",
  flightDate: "2026-12-20",
  placeQuery: "Some Place",
  commitmentLocal: "2026-12-20 20:00:00",
  reschedulable: true,
};

const NOW = "2026-12-20T17:00:00Z";
const BUDGET_REASON = "We've hit this month's capacity. Please try again next month.";

describe("armWatch monthly-budget circuit-breaker wiring", () => {
  const prev = process.env.MONTHLY_BUDGET_UNITS;

  beforeEach(() => {
    vi.clearAllMocks();
    sqlResults.length = 0;
    fetchFlight.mockResolvedValue({ kind: "not_found" }); // stop the flow right after the budget gate
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.MONTHLY_BUDGET_UNITS;
    else process.env.MONTHLY_BUDGET_UNITS = prev;
  });

  it("SKIPS the gate when MONTHLY_BUDGET_UNITS is unset (no rejection, no spend query)", async () => {
    delete process.env.MONTHLY_BUDGET_UNITS;
    sqlResults.push([{ n: 0 }]); // call 1: device cap (only this query runs — spend is never read)

    const res = await armWatch(baseReq, NOW);

    // Passed the budget gate and reached fetchFlight => the reason is the flight one, NOT the budget one.
    expect(res).toEqual({ ok: false, reason: "No flight found for that number and date." });
    expect(sqlTag).toHaveBeenCalledTimes(1); // ONLY the cap query; the spend proxy was never consulted
    expect(fetchFlight).toHaveBeenCalledTimes(1);
  });

  it("SKIPS the gate when MONTHLY_BUDGET_UNITS is non-positive (breaker disabled, not fail-closed)", async () => {
    process.env.MONTHLY_BUDGET_UNITS = "0";
    sqlResults.push([{ n: 0 }]); // call 1: device cap

    const res = await armWatch(baseReq, NOW);

    expect(res).toEqual({ ok: false, reason: "No flight found for that number and date." });
    expect(sqlTag).toHaveBeenCalledTimes(1); // disabled => spend proxy not queried
    expect(fetchFlight).toHaveBeenCalledTimes(1);
  });

  it("REFUSES the arm when month-to-date spend has reached the configured threshold (before any fetch)", async () => {
    process.env.MONTHLY_BUDGET_UNITS = "100";
    sqlResults.push([{ n: 0 }]); // call 1: device cap (passes)
    sqlResults.push([{ n: 100 }]); // call 2: spend proxy — at the threshold => shed

    const res = await armWatch(baseReq, NOW);

    expect(res).toEqual({ ok: false, reason: BUDGET_REASON });
    expect(fetchFlight).not.toHaveBeenCalled(); // validate-before-spend: refused before upstream cost
    expect(sqlTag).toHaveBeenCalledTimes(2); // cap + spend, then short-circuit
  });

  it("ALLOWS the arm when spend is under the configured threshold (gate passes through to fetch)", async () => {
    process.env.MONTHLY_BUDGET_UNITS = "100";
    sqlResults.push([{ n: 0 }]); // call 1: device cap
    sqlResults.push([{ n: 42 }]); // call 2: spend proxy — under budget => proceed

    const res = await armWatch(baseReq, NOW);

    expect(res).toEqual({ ok: false, reason: "No flight found for that number and date." }); // reached fetch
    expect(fetchFlight).toHaveBeenCalledTimes(1);
    expect(sqlTag).toHaveBeenCalledTimes(2);
  });
});
