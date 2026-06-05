import { describe, it, expect } from "vitest";
import { validateArm } from "@/lib/engine/validation";
import type { Commitment } from "@/lib/engine/types";

const c = (over: Partial<Commitment> = {}): Commitment => ({
  localWallTime: "2026-12-20T20:00:00",
  ianaZone: "Europe/Madrid",
  marginMinutes: 0,
  reschedulable: true,
  ...over,
});

describe("validateArm", () => {
  it("accepts a future, feasible commitment and resolves its instant", () => {
    const r = validateArm(c(), "2026-12-20T10:00:00Z", "2026-12-20T17:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commitmentInstantUtc).toBe("2026-12-20T19:00:00.000Z"); // Madrid CET
  });

  it("rejects a past commitment", () => {
    const r = validateArm(c(), "2026-12-21T00:00:00Z", null);
    expect(r.ok).toBe(false);
  });

  it("rejects a commitment that precedes the earliest feasible arrival", () => {
    const r = validateArm(c(), "2026-12-20T10:00:00Z", "2026-12-20T20:00:00Z"); // 20:00Z > 19:00Z deadline
    expect(r.ok).toBe(false);
  });

  it("rejects an unparseable zone", () => {
    const r = validateArm(c({ ianaZone: "Not/AZone" }), "2026-12-20T10:00:00Z", null);
    expect(r.ok).toBe(false);
  });
});
