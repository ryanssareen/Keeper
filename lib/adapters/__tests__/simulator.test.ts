import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";

import { scenarioFor, simulateFlight } from "../simulator";

const DATE = "2026-06-06";

/** Narrow an ok result to its FlightArrival, failing loudly otherwise. */
function arrival(res: AdapterResult<FlightArrival>): FlightArrival {
  if (res.kind !== "ok") throw new Error(`expected ok, got ${res.kind}`);
  return res.data;
}

/** Simulate at an instant expressed as a UTC ISO string. */
const at = (flight: string, nowIso: string) => simulateFlight(flight, DATE, nowIso);

/** The deterministic scheduled-arrival instant for a flight/date, as a luxon DateTime (UTC). */
function scheduledArrival(flight: string): DateTime {
  const sched = arrival(at(flight, `${DATE}T00:00:00Z`));
  return DateTime.fromISO(sched.scheduledUtc as string, { zone: "utc" });
}

describe("scenarioFor — marker overrides", () => {
  it("maps cancellation markers regardless of case", () => {
    expect(scenarioFor("AA100CNCL")).toBe("cancelled");
    expect(scenarioFor("aa100cxl")).toBe("cancelled");
  });

  it("maps diversion markers", () => {
    expect(scenarioFor("UA9DVRT")).toBe("diverted");
    expect(scenarioFor("ua9dvt")).toBe("diverted");
  });

  it("maps delay markers", () => {
    expect(scenarioFor("BA286DLY")).toBe("major_delay");
    expect(scenarioFor("ba286late")).toBe("major_delay");
  });

  it("is deterministic for an unmarked number (stable scenario)", () => {
    const a = scenarioFor("DL4242");
    const b = scenarioFor("DL4242");
    expect(a).toBe(b);
    expect(["on_time", "minor_delay", "major_delay"]).toContain(a);
  });

  it("never silently returns a marker scenario for an unmarked number", () => {
    // A plain number can never be cancelled/diverted (those require explicit markers).
    for (const n of ["AA1", "UA2", "DL3", "WN4", "B61234"]) {
      expect(["on_time", "minor_delay", "major_delay"]).toContain(scenarioFor(n));
    }
  });
});

describe("simulateFlight — contract shape", () => {
  it("returns not_found for an unparseable date", () => {
    expect(simulateFlight("AA1", "not-a-date", `${DATE}T12:00:00Z`).kind).toBe("not_found");
  });

  it("returns not_found (never throws) for an unparseable `now`, even on a delayed scenario", () => {
    // A delayed scenario drives the delay ramp; without a now-guard this throws NaN-minutes.
    expect(simulateFlight("BA286DLY", DATE, "garbage").kind).toBe("not_found");
    expect(simulateFlight("AA1", DATE, "garbage").kind).toBe("not_found");
  });

  it("produces the full FlightArrival contract with a real IATA airport", () => {
    const f = arrival(at("AA1", `${DATE}T00:00:00Z`));
    expect(f.scheduledUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(f.predictedUtc).not.toBeNull();
    expect(f.arrivalAirport).toMatch(/^[A-Z]{3}$/);
    expect(f.revision).toBe(`${f.predictedUtc}|${f.status}|${f.arrivalAirport}`);
  });

  it("is fully deterministic — same inputs, identical datum", () => {
    const now = `${DATE}T12:34:00Z`;
    expect(at("DL4242", now)).toEqual(at("DL4242", now));
  });
});

describe("simulateFlight — on-time flight", () => {
  // Find an unmarked number that hashes to on_time so predicted == scheduled forever.
  const onTime = ["AA1", "AA2", "AA3", "AA4", "AA5", "AA6", "AA7", "AA8"].find(
    (n) => scenarioFor(n) === "on_time",
  ) as string;

  it("never drifts: predicted equals scheduled at every instant", () => {
    const sched = scheduledArrival(onTime);
    for (const offsetH of [-5, -2, -0.5, 0, 2]) {
      const f = arrival(at(onTime, sched.plus({ hours: offsetH }).toISO() as string));
      expect(f.predictedUtc).toBe(f.scheduledUtc);
    }
  });

  it("lands at its scheduled time once the slot passes", () => {
    const sched = scheduledArrival(onTime);
    const f = arrival(at(onTime, sched.plus({ minutes: 1 }).toISO() as string));
    expect(f.status).toBe("landed");
    expect(f.actualUtc).toBe(f.scheduledUtc);
  });
});

describe("simulateFlight — delay ramps up toward the slot (the catch signal)", () => {
  const flight = "BA286DLY"; // forced major_delay

  it("reads on-time early, then the predicted arrival slips later", () => {
    const sched = scheduledArrival(flight);
    const early = arrival(at(flight, sched.minus({ hours: 4 }).toISO() as string));
    const near = arrival(at(flight, sched.minus({ minutes: 10 }).toISO() as string));

    // ~4h out, before the delay becomes visible (3h window), predicted == scheduled.
    expect(early.predictedUtc).toBe(early.scheduledUtc);

    const earlyPred = DateTime.fromISO(early.predictedUtc as string, { zone: "utc" });
    const nearPred = DateTime.fromISO(near.predictedUtc as string, { zone: "utc" });
    expect(nearPred.toMillis()).toBeGreaterThan(earlyPred.toMillis());
  });

  it("delay is monotonically non-decreasing as now advances toward the slot", () => {
    const sched = scheduledArrival(flight);
    let prev = -1;
    for (const minsOut of [200, 180, 120, 60, 30, 10, 0]) {
      const f = arrival(at(flight, sched.minus({ minutes: minsOut }).toISO() as string));
      const delay = DateTime.fromISO(f.predictedUtc as string, { zone: "utc" })
        .diff(sched, "minutes").minutes;
      expect(delay).toBeGreaterThanOrEqual(prev);
      prev = delay;
    }
  });

  it("reaches the scenario's final delay (~95m) at the slot and then lands", () => {
    const sched = scheduledArrival(flight);
    const final = arrival(at(flight, sched.toISO() as string));
    const delay = DateTime.fromISO(final.predictedUtc as string, { zone: "utc" })
      .diff(sched, "minutes").minutes;
    expect(delay).toBeGreaterThanOrEqual(90);

    const after = arrival(at(flight, sched.plus({ hours: 2 }).toISO() as string));
    expect(after.status).toBe("landed");
    expect(after.actualUtc).toBe(after.predictedUtc);
  });

  it("rounds the delay to discrete 5-minute steps (revision changes in jumps)", () => {
    const sched = scheduledArrival(flight);
    const f = arrival(at(flight, sched.minus({ minutes: 45 }).toISO() as string));
    const delay = DateTime.fromISO(f.predictedUtc as string, { zone: "utc" })
      .diff(sched, "minutes").minutes;
    expect(delay % 5).toBe(0);
  });
});

describe("simulateFlight — status lifecycle", () => {
  const flight = "AA1";

  it("scheduled before departure, active in the air, landed after arrival", () => {
    const sched = scheduledArrival(flight);
    // Departure is 2–6h before arrival; 8h out is always pre-departure.
    expect(arrival(at(flight, sched.minus({ hours: 8 }).toISO() as string)).status).toBe("scheduled");
    // 1 minute before the predicted arrival is in the air (post-departure, pre-arrival).
    expect(arrival(at(flight, sched.minus({ minutes: 1 }).toISO() as string)).status).toBe("active");
    // After the slot: landed.
    expect(arrival(at(flight, sched.plus({ hours: 1 }).toISO() as string)).status).toBe("landed");
  });

  it("actualUtc is null until landing, then set to the realized arrival", () => {
    const sched = scheduledArrival(flight);
    expect(arrival(at(flight, sched.minus({ hours: 8 }).toISO() as string)).actualUtc).toBeNull();
    expect(arrival(at(flight, sched.plus({ hours: 1 }).toISO() as string)).actualUtc).not.toBeNull();
  });
});

describe("simulateFlight — cancelled", () => {
  const flight = "AA100CNCL";

  it("is scheduled before departure, then terminally cancelled with no usable ETA drift", () => {
    const sched = scheduledArrival(flight);
    expect(arrival(at(flight, sched.minus({ hours: 8 }).toISO() as string)).status).toBe("scheduled");

    const f = arrival(at(flight, sched.toISO() as string));
    expect(f.status).toBe("cancelled");
    expect(f.predictedUtc).toBe(f.scheduledUtc);
    expect(f.actualUtc).toBeNull();
  });
});

describe("simulateFlight — diverted", () => {
  const flight = "UA9DVRT";

  it("keeps the base airport early but switches airports near arrival", () => {
    const sched = scheduledArrival(flight);
    const early = arrival(at(flight, sched.minus({ hours: 8 }).toISO() as string));
    const late = arrival(at(flight, sched.plus({ hours: 1 }).toISO() as string));

    expect(early.arrivalAirport).toMatch(/^[A-Z]{3}$/);
    expect(late.status).toBe("diverted");
    expect(late.arrivalAirport).not.toBe(early.arrivalAirport);
    // The revision encodes the airport, so a diversion changes the fingerprint.
    expect(late.revision).not.toBe(early.revision);
  });

  it("never sets actualUtc on a diverted datum (no fabricated landing at the watched airport)", () => {
    // Matches AeroDataBox: a divert leaves the watched airport's runwayTime (=> actualUtc) absent, so
    // actualFromFlight (backfill) must NOT treat it as a landed actual. Check across the whole window.
    const sched = scheduledArrival(flight);
    for (const offsetH of [-8, -1, -0.25, 0, 1, 3]) {
      const f = arrival(at(flight, sched.plus({ hours: offsetH }).toISO() as string));
      if (f.status === "diverted") expect(f.actualUtc).toBeNull();
    }
  });
});
