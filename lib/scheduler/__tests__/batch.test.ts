import { describe, it, expect, vi } from "vitest";
import { reconcileDueBatch, type BatchDeps, type DueWatch } from "@/lib/scheduler/batch";
import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";
import type { FlightFetch, ReconcileOutcome } from "@/lib/engine/reconcile";

/**
 * Pure-orchestrator matrix for the reconcile batch (U7). Adapters + the reconcile transaction are
 * injected, so the cap/ceiling/throttle/error-isolation behavior is proven without a DB or network.
 */

const NOW = "2026-06-05T17:00:00.000Z";

const dueWatches = (n: number): DueWatch[] =>
  Array.from({ length: n }, (_, i) => ({ id: `w${i}`, flightNumber: `AA${i}`, flightDate: "2026-06-05" }));

const okResult: AdapterResult<FlightArrival> = {
  kind: "ok",
  data: {
    scheduledUtc: null,
    predictedUtc: "2026-06-05T18:00:00Z",
    actualUtc: null,
    status: "active",
    arrivalAirport: "JFK",
    revision: "r1",
  },
};
const rateLimited: AdapterResult<FlightArrival> = { kind: "rate_limited" };
const notFound: AdapterResult<FlightArrival> = { kind: "not_found" };
const applied: ReconcileOutcome = { kind: "applied", state: "OK", fired: null };

const deps = (over: Partial<BatchDeps> = {}): BatchDeps => ({
  fetchFlight: vi.fn(async () => okResult),
  reconcileWatch: vi.fn(async () => applied),
  backoffWatch: vi.fn(async () => {}),
  ...over,
});

describe("reconcileDueBatch", () => {
  it("an empty batch does nothing and spends no upstream calls", async () => {
    const d = deps();
    const s = await reconcileDueBatch([], d, NOW, 25);
    expect(s).toMatchObject({ due: 0, processed: 0, upstreamCalls: 0, applied: 0, errors: 0, throttled: false });
    expect(d.fetchFlight).not.toHaveBeenCalled();
    expect(d.reconcileWatch).not.toHaveBeenCalled();
  });

  it("reconciles every due watch and tallies outcomes", async () => {
    const d = deps();
    const s = await reconcileDueBatch(dueWatches(3), d, NOW, 25);
    expect(s).toMatchObject({ due: 3, processed: 3, upstreamCalls: 3, applied: 3, throttled: false });
    expect(d.reconcileWatch).toHaveBeenCalledTimes(3);
  });

  it("honors the upstream-call ceiling (never fans out past the cap)", async () => {
    const d = deps();
    const s = await reconcileDueBatch(dueWatches(5), d, NOW, 2);
    expect(s).toMatchObject({ processed: 2, upstreamCalls: 2 });
    expect(d.fetchFlight).toHaveBeenCalledTimes(2);
    expect(d.reconcileWatch).toHaveBeenCalledTimes(2);
  });

  it("a thrown fetch becomes 'unavailable' and is still reconciled (no skip, no hot-loop)", async () => {
    const seen: Record<string, FlightFetch> = {};
    const fetchFlight = vi.fn(async (flightNumber: string) => {
      if (flightNumber === "AA1") throw new Error("network down");
      return okResult;
    });
    const reconcileWatch = vi.fn(async (id: string, fetch: FlightFetch) => {
      seen[id] = fetch;
      return applied;
    });
    const d = deps({ fetchFlight, reconcileWatch });
    const s = await reconcileDueBatch(dueWatches(3), d, NOW, 25);
    expect(s).toMatchObject({ due: 3, processed: 3, errors: 0, upstreamCalls: 3 });
    expect(seen.w1).toEqual({ kind: "unavailable" }); // the thrown-fetch watch degrades honestly
  });

  it("a thrown reconcile is isolated, recorded by id, and backed off (no hot-loop)", async () => {
    const reconcileWatch = vi.fn(async (watchId: string) => {
      if (watchId === "w1") throw new Error("db deadlock");
      return applied;
    });
    const backoffWatch = vi.fn(async () => {});
    const d = deps({ reconcileWatch, backoffWatch });
    const s = await reconcileDueBatch(dueWatches(3), d, NOW, 25);
    expect(s).toMatchObject({ processed: 2, applied: 2, errors: 1, failedWatchIds: ["w1"] });
    expect(backoffWatch).toHaveBeenCalledWith("w1");
    expect(backoffWatch).toHaveBeenCalledTimes(1);
  });

  it("a failing backoff does not abort the batch", async () => {
    const reconcileWatch = vi.fn(async (watchId: string) => {
      if (watchId === "w0") throw new Error("db deadlock");
      return applied;
    });
    const backoffWatch = vi.fn(async () => {
      throw new Error("backoff write failed");
    });
    const d = deps({ reconcileWatch, backoffWatch });
    const s = await reconcileDueBatch(dueWatches(3), d, NOW, 25);
    expect(s).toMatchObject({ processed: 2, errors: 1, failedWatchIds: ["w0"] });
  });

  it("an upstream rate-limit mid-batch throttles the tick: stop spending calls, leave the rest", async () => {
    let calls = 0;
    const fetchFlight = vi.fn(async () => {
      calls += 1;
      return calls >= 2 ? rateLimited : okResult;
    });
    const d = deps({ fetchFlight });
    const s = await reconcileDueBatch(dueWatches(5), d, NOW, 25);
    expect(s).toMatchObject({ processed: 1, throttled: true, upstreamCalls: 2 });
    expect(d.reconcileWatch).toHaveBeenCalledTimes(1); // only the first (pre-throttle) watch
  });

  it("a rate-limit on the very first watch stops the tick with nothing processed", async () => {
    const d = deps({ fetchFlight: vi.fn(async () => rateLimited) });
    const s = await reconcileDueBatch(dueWatches(5), d, NOW, 25);
    expect(s).toMatchObject({ processed: 0, throttled: true, upstreamCalls: 1 });
    expect(d.reconcileWatch).not.toHaveBeenCalled();
  });

  it("the upstream ceiling bounds attempts even when every fetch throws", async () => {
    const fetchFlight = vi.fn(async () => {
      throw new Error("net");
    });
    const d = deps({ fetchFlight });
    const s = await reconcileDueBatch(dueWatches(5), d, NOW, 2);
    // Throws become 'unavailable' and are reconciled; the cap still bounds upstream attempts at 2.
    expect(s).toMatchObject({ upstreamCalls: 2, processed: 2 });
    expect(d.fetchFlight).toHaveBeenCalledTimes(2);
  });

  it("maps a non-ok (but not rate-limited) fetch to an 'unavailable' FlightFetch", async () => {
    const seen: FlightFetch[] = [];
    const reconcileWatch = vi.fn(async (_id: string, fetch: FlightFetch) => {
      seen.push(fetch);
      return { kind: "skipped", reason: "awaiting_retry" } as ReconcileOutcome;
    });
    const d = deps({ fetchFlight: vi.fn(async () => notFound), reconcileWatch });
    const s = await reconcileDueBatch(dueWatches(1), d, NOW, 25);
    expect(seen).toEqual([{ kind: "unavailable" }]);
    expect(s).toMatchObject({ processed: 1, skipped: 1 });
  });

  it("tallies applied / skipped / missing outcomes separately", async () => {
    const reconcileWatch = vi.fn(async (watchId: string): Promise<ReconcileOutcome> => {
      if (watchId === "w0") return { kind: "applied", state: "MISS_PREDICTED", fired: null };
      if (watchId === "w1") return { kind: "skipped", reason: "unchanged" };
      return { kind: "missing" };
    });
    const d = deps({ reconcileWatch });
    const s = await reconcileDueBatch(dueWatches(3), d, NOW, 25);
    expect(s).toMatchObject({ processed: 3, applied: 1, skipped: 1, missing: 1 });
  });
});
