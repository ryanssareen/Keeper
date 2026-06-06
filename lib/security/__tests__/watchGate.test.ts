import { describe, it, expect } from "vitest";
import { decideWatchAccess, type GateWatchRow } from "@/lib/security/watchGate";
import { hashToken, mintToken } from "@/lib/security/capability";

/**
 * The capability gate's security property, asserted on the PURE decision (no DB). The IO half only
 * runs the SELECT and delegates here, so locking the decision locks the gate: a real token verifies,
 * and a missing watch and a wrong token DENY IDENTICALLY ({ ok: false }) — no existence oracle.
 */

const token = mintToken();

const row = (over: Partial<GateWatchRow> = {}): GateWatchRow => ({
  id: "w-1",
  ownerTokenHash: hashToken(token),
  state: "AT_RISK",
  placeLabel: "Trafalgar Square, London",
  flightNumber: "EK1",
  commitmentZone: "Europe/London",
  commitmentInstantUtc: "2026-12-20T20:00:00.000Z",
  transitMinutes: 30,
  reschedulable: true,
  contact: null,
  ...over,
});

describe("decideWatchAccess — allow", () => {
  it("authorizes when the presented token matches the stored hash", () => {
    const res = decideWatchAccess(row(), token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.watch.id).toBe("w-1");
      expect(res.watch.flightNumber).toBe("EK1");
      expect(res.watch.commitmentZone).toBe("Europe/London");
    }
  });

  it("passes the loaded watch fields through on success (so callers need no second query)", () => {
    const res = decideWatchAccess(row({ contact: "the venue", reschedulable: false }), token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.watch.contact).toBe("the venue");
      expect(res.watch.reschedulable).toBe(false);
    }
  });
});

describe("decideWatchAccess — uniform denial (no existence oracle)", () => {
  it("denies a missing watch (null row) with no data", () => {
    const res = decideWatchAccess(null, token);
    expect(res).toEqual({ ok: false });
  });

  it("denies a wrong token against an existing watch", () => {
    const res = decideWatchAccess(row(), mintToken());
    expect(res).toEqual({ ok: false });
  });

  it("denies garbage and empty tokens", () => {
    expect(decideWatchAccess(row(), "garbage")).toEqual({ ok: false });
    expect(decideWatchAccess(row(), "")).toEqual({ ok: false });
  });

  it("returns the SAME shape for a missing watch and a wrong token (indistinguishable)", () => {
    // The whole point of the gate: a guesser cannot tell 'no such watch' from 'not your watch'.
    const missing = decideWatchAccess(null, token);
    const wrongToken = decideWatchAccess(row(), mintToken());
    expect(missing).toEqual(wrongToken);
  });

  it("never leaks the owner hash or any watch field on denial", () => {
    const res = decideWatchAccess(row(), mintToken());
    expect(Object.keys(res)).toEqual(["ok"]);
  });
});
