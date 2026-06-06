import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IO collaborators so the route's wiring is testable without a DB. The shared gate
// (watchGate) and the sole calibration writer (recordSelfReport) are the seams; we assert the route
// enforces UNIFORM denial (a missing watch and a bad token both 403) and only writes once authorized.
vi.mock("@/lib/security/watchGate", () => ({ loadAndVerifyWatch: vi.fn() }));
vi.mock("@/lib/calibration/writer", () => ({ recordSelfReport: vi.fn() }));

import { POST } from "@/app/api/self-report/route";
import { loadAndVerifyWatch } from "@/lib/security/watchGate";
import { recordSelfReport } from "@/lib/calibration/writer";

const post = (body: unknown): Request =>
  new Request("http://localhost/api/self-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const okBody = { watchId: "w-1", token: "tok-abc", outcome: "made" as const, wasUseful: true };

describe("/api/self-report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordSelfReport).mockResolvedValue(undefined);
  });

  it("returns 200 and records the outcome through the sole writer on a valid, authorized report", async () => {
    vi.mocked(loadAndVerifyWatch).mockResolvedValue({
      ok: true,
      watch: {
        id: "w-1",
        ownerTokenHash: "h",
        state: "AT_RISK",
        placeLabel: "p",
        flightNumber: "EK1",
        commitmentZone: "Europe/London",
        commitmentInstantUtc: "2026-12-20T20:00:00.000Z",
        transitMinutes: 30,
        reschedulable: true,
        contact: null,
      },
    });

    const res = await POST(post(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recordSelfReport).toHaveBeenCalledWith("w-1", "made", true);
  });

  it("defaults wasUseful to false when omitted", async () => {
    vi.mocked(loadAndVerifyWatch).mockResolvedValue({
      ok: true,
      watch: {
        id: "w-1",
        ownerTokenHash: "h",
        state: "OK",
        placeLabel: "p",
        flightNumber: "EK1",
        commitmentZone: "Europe/London",
        commitmentInstantUtc: "2026-12-20T20:00:00.000Z",
        transitMinutes: 30,
        reschedulable: true,
        contact: null,
      },
    });

    const res = await POST(post({ watchId: "w-1", token: "tok-abc", outcome: "missed" }));
    expect(res.status).toBe(200);
    expect(recordSelfReport).toHaveBeenCalledWith("w-1", "missed", false);
  });

  it("denies a bad token with 403 and writes nothing", async () => {
    vi.mocked(loadAndVerifyWatch).mockResolvedValue({ ok: false });

    const res = await POST(post(okBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden." });
    expect(recordSelfReport).not.toHaveBeenCalled();
  });

  it("denies a MISSING watch with the SAME 403 (no 404 existence oracle)", async () => {
    // The gate returns the same { ok: false } for missing-watch and wrong-token; the route must not
    // leak which it was. A 404 here would let a guesser enumerate live watch ids.
    vi.mocked(loadAndVerifyWatch).mockResolvedValue({ ok: false });

    const res = await POST(post({ watchId: "does-not-exist", token: "tok-abc", outcome: "made" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden." });
  });

  it("rejects invalid JSON with 400 before touching the gate", async () => {
    const res = await POST(post("{ not json"));
    expect(res.status).toBe(400);
    expect(loadAndVerifyWatch).not.toHaveBeenCalled();
  });

  it("rejects an unknown outcome value with 400", async () => {
    const res = await POST(post({ watchId: "w-1", token: "tok-abc", outcome: "maybe" }));
    expect(res.status).toBe(400);
    expect(loadAndVerifyWatch).not.toHaveBeenCalled();
  });

  it("rejects a missing token with 400 (schema guard) before the gate", async () => {
    const res = await POST(post({ watchId: "w-1", outcome: "made" }));
    expect(res.status).toBe(400);
    expect(loadAndVerifyWatch).not.toHaveBeenCalled();
  });
});
