import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IO collaborators so the route's wiring is testable without a DB or network. The auth
// guard (cron.ts) and ENGINE constants stay real — the point is to prove the guard runs BEFORE any
// quota-spending call (validate-before-spend, R24).
vi.mock("@/lib/scheduler/select", () => ({ selectDueWatches: vi.fn() }));
vi.mock("@/lib/scheduler/batch", () => ({ reconcileDueBatch: vi.fn() }));
vi.mock("@/lib/adapters/aerodatabox", () => ({ fetchFlight: vi.fn() }));
vi.mock("@/lib/engine/reconcile", () => ({ reconcileWatch: vi.fn() }));
vi.mock("@/lib/scheduler/backoff", () => ({ backoffWatch: vi.fn() }));
vi.mock("@/lib/push/dispatch", () => ({ dispatchOutbox: vi.fn() }));
vi.mock("@/lib/calibration/backfill", () => ({
  expireStaleSelfReports: vi.fn(),
  backfillActualForWatch: vi.fn(),
}));
vi.mock("@/lib/scheduler/backfillSelect", () => ({ selectWatchesNeedingActual: vi.fn() }));

import { GET, POST } from "@/app/api/cron/reconcile/route";
import { selectDueWatches } from "@/lib/scheduler/select";
import { reconcileDueBatch, type BatchSummary } from "@/lib/scheduler/batch";
import { dispatchOutbox } from "@/lib/push/dispatch";
import { expireStaleSelfReports, backfillActualForWatch } from "@/lib/calibration/backfill";
import { selectWatchesNeedingActual } from "@/lib/scheduler/backfillSelect";

const SECRET = "test-cron-secret";

const req = (auth?: string): Request =>
  new Request("http://localhost/api/cron/reconcile", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

const summary: BatchSummary = {
  due: 1,
  processed: 1,
  upstreamCalls: 1,
  applied: 1,
  skipped: 0,
  missing: 0,
  errors: 0,
  failedWatchIds: [],
  throttled: false,
};

describe("/api/cron/reconcile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Post-reconcile side effects are best-effort; default them to clean no-ops so the happy-path
    // wiring tests stay focused. Individual tests override these to exercise the failure isolation.
    vi.mocked(dispatchOutbox).mockResolvedValue({ claimed: 0, sent: 0, failed: 0, deferred: 0, noDevice: 0, pruned: 0, reclaimed: 0 });
    vi.mocked(expireStaleSelfReports).mockResolvedValue(0);
    vi.mocked(selectWatchesNeedingActual).mockResolvedValue([]);
    vi.mocked(backfillActualForWatch).mockResolvedValue(true);
  });

  it("rejects a wrong secret with 401 and spends nothing (validate-before-spend)", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(selectDueWatches).not.toHaveBeenCalled();
    expect(reconcileDueBatch).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(selectDueWatches).not.toHaveBeenCalled();
  });

  it("authorized POST selects due watches and returns the batch summary (200)", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([{ id: "w1", flightNumber: "AA1", flightDate: "2026-06-05" }]);
    vi.mocked(reconcileDueBatch).mockResolvedValue(summary);
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ...summary, dispatched: 0, expired: 0, backfilled: 0 });
    expect(selectDueWatches).toHaveBeenCalledTimes(1);
    expect(dispatchOutbox).toHaveBeenCalledTimes(1); // outbox drained after the batch
  });

  it("runs the actual-arrival backfill sweep and reports the count (200)", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    vi.mocked(selectWatchesNeedingActual).mockResolvedValue(["w1", "w2", "w3"]);
    // Two land, one is not-yet-landed (false) — backfilled counts only the writes.
    vi.mocked(backfillActualForWatch).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ backfilled: 2 });
    expect(selectWatchesNeedingActual).toHaveBeenCalledTimes(1);
    expect(backfillActualForWatch).toHaveBeenCalledTimes(3);
  });

  it("a single backfill error does not abort the sweep (200, the rest still count)", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    vi.mocked(selectWatchesNeedingActual).mockResolvedValue(["w1", "w2"]);
    vi.mocked(backfillActualForWatch).mockRejectedValueOnce(new Error("upstream blip")).mockResolvedValueOnce(true);

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ backfilled: 1 }); // the erroring one is skipped, not fatal
  });

  it("accepts GET too (scheduler method-default safety)", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
  });

  it("returns a 500 with the JSON error shape when the selector fails", async () => {
    vi.mocked(selectDueWatches).mockRejectedValue(new Error("db down"));
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reconcile tick failed." });
  });

  // ── Best-effort post-passes: a failure in any one must STILL return 200 with that count null,
  //    never failing the reconcile tick. ──────────────────────────────────────────────────────────
  it("still returns 200 with dispatched=null when the outbox drain rejects", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    vi.mocked(dispatchOutbox).mockRejectedValue(new Error("redis down"));

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dispatched: null, expired: 0, backfilled: 0 });
  });

  it("still returns 200 with expired=null when the self-report sweep rejects", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    vi.mocked(expireStaleSelfReports).mockRejectedValue(new Error("db down"));

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dispatched: 0, expired: null, backfilled: 0 });
  });

  it("still returns 200 with backfilled=null when the backfill candidate selector rejects", async () => {
    vi.mocked(selectDueWatches).mockResolvedValue([]);
    vi.mocked(reconcileDueBatch).mockResolvedValue({ ...summary, due: 0, processed: 0, upstreamCalls: 0, applied: 0 });
    vi.mocked(selectWatchesNeedingActual).mockRejectedValue(new Error("db down"));

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dispatched: 0, expired: 0, backfilled: null });
  });
});
