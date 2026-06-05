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
vi.mock("@/lib/calibration/backfill", () => ({ expireStaleSelfReports: vi.fn() }));

import { GET, POST } from "@/app/api/cron/reconcile/route";
import { selectDueWatches } from "@/lib/scheduler/select";
import { reconcileDueBatch, type BatchSummary } from "@/lib/scheduler/batch";
import { dispatchOutbox } from "@/lib/push/dispatch";
import { expireStaleSelfReports } from "@/lib/calibration/backfill";

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
    // Post-reconcile side effects are best-effort and out of scope for these wiring tests.
    vi.mocked(dispatchOutbox).mockResolvedValue({ claimed: 0, sent: 0, failed: 0, noDevice: 0, pruned: 0 });
    vi.mocked(expireStaleSelfReports).mockResolvedValue(0);
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
    expect(await res.json()).toMatchObject({ ...summary, dispatched: 0, expired: 0 });
    expect(selectDueWatches).toHaveBeenCalledTimes(1);
    expect(dispatchOutbox).toHaveBeenCalledTimes(1); // outbox drained after the batch
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
});
