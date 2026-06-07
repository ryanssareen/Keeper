import { describe, it, expect } from "vitest";
import { buildTripFlight, loadTripFlight } from "@/lib/trips/flight";
import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";

const ok = (data: Partial<FlightArrival>): AdapterResult<FlightArrival> => ({
  kind: "ok",
  data: {
    scheduledUtc: "2026-06-09T10:00:00Z",
    predictedUtc: "2026-06-09T10:00:00Z",
    actualUtc: null,
    status: "scheduled",
    arrivalAirport: "LIS",
    revision: "r",
    ...data,
  },
});

describe("buildTripFlight — pure provider-result mapping", () => {
  it("maps each non-ok provider result to a labelled unavailable card (never blank)", () => {
    for (const kind of ["not_found", "rate_limited", "error"] as const) {
      const result = (kind === "error" ? { kind, message: "boom" } : { kind }) as AdapterResult<FlightArrival>;
      const f = buildTripFlight(result, "TP123", "", "simulator");
      expect(f.state).toBe("unavailable");
      if (f.state === "unavailable") {
        expect(f.flightNo).toBe("TP123");
        expect(f.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("promotes a scheduled flight with a >=15 min predicted delay from muted to warn", () => {
    const f = buildTripFlight(ok({ predictedUtc: "2026-06-09T10:20:00Z" }), "TP1", "", "simulator");
    expect(f.state).toBe("ok");
    if (f.state === "ok") {
      expect(f.delayMinutes).toBe(20);
      expect(f.tone).toBe("warn");
      expect(f.statusLabel).toBe("Scheduled");
    }
  });

  it("keeps a small (<15 min) delay muted", () => {
    const f = buildTripFlight(ok({ predictedUtc: "2026-06-09T10:10:00Z" }), "TP1", "", "simulator");
    if (f.state === "ok") {
      expect(f.delayMinutes).toBe(10);
      expect(f.tone).toBe("muted");
    }
  });

  it("keeps a cancelled flight 'bad' regardless of delay, and an active flight 'ok'", () => {
    const cancelled = buildTripFlight(ok({ status: "cancelled" }), "TP1", "", "simulator");
    expect(cancelled.state === "ok" && cancelled.tone).toBe("bad");
    const active = buildTripFlight(ok({ status: "active" }), "TP1", "", "simulator");
    expect(active.state === "ok" && active.tone).toBe("ok");
  });

  it("falls back to actualUtc for the delay when predictedUtc is null, and passes seat + airport through", () => {
    const f = buildTripFlight(
      ok({ predictedUtc: null, actualUtc: "2026-06-09T10:30:00Z", arrivalAirport: "OPO" }),
      "TP9",
      "14A, 14B",
      "aviationstack",
    );
    if (f.state === "ok") {
      expect(f.delayMinutes).toBe(30);
      expect(f.seat).toBe("14A, 14B");
      expect(f.arrivalAirport).toBe("OPO");
      expect(f.provider).toBe("aviationstack");
      expect(f.actualArrival).not.toBeNull();
    }
  });
});

describe("loadTripFlight — booking gate (short-circuits before any provider call)", () => {
  it("returns state 'none' when the flight isn't booked", async () => {
    expect(await loadTripFlight({ flight: "Not yet", flightNo: "TP1" })).toEqual({ state: "none" });
  });

  it("returns state 'none' when booked but no flight number is given", async () => {
    expect(await loadTripFlight({ flight: "Booked", flightNo: "  " })).toEqual({ state: "none" });
  });
});
