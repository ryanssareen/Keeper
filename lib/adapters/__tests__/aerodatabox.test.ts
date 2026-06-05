import { describe, expect, it } from "vitest";

import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival } from "@/lib/engine/types";

import { parseFlightStatus } from "../aerodatabox";

/** Build one AeroDataBox-shaped flight object; the endpoint wraps these in an array. */
const flight = (overrides: {
  status: string;
  airport?: { iata?: string; icao?: string; name?: string };
  scheduledTime?: { utc: string; local: string };
  revisedTime?: { utc: string; local: string };
  runwayTime?: { utc: string; local: string };
}): Record<string, unknown> => {
  const arrival: Record<string, unknown> = {
    airport: overrides.airport ?? { iata: "BCN", icao: "LEBL", name: "Barcelona" },
  };
  if (overrides.scheduledTime) arrival.scheduledTime = overrides.scheduledTime;
  if (overrides.revisedTime) arrival.revisedTime = overrides.revisedTime;
  if (overrides.runwayTime) arrival.runwayTime = overrides.runwayTime;
  return { status: overrides.status, arrival };
};

/** Narrow an ok result to its FlightArrival, failing loudly otherwise. */
const expectOk = (result: AdapterResult<FlightArrival>): FlightArrival => {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
  return result.data;
};

describe("parseFlightStatus", () => {
  it("predicted-only (revisedTime, no runwayTime) -> predictedUtc set, actualUtc null, status active", () => {
    const payload = [
      flight({
        status: "EnRoute",
        scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        revisedTime: { utc: "2026-06-05 19:25Z", local: "2026-06-05 21:25+02:00" },
      }),
    ];

    const data = expectOk(parseFlightStatus(payload));

    expect(data.predictedUtc).toBe("2026-06-05T19:25:00Z");
    expect(data.scheduledUtc).toBe("2026-06-05T18:40:00Z");
    expect(data.actualUtc).toBeNull();
    expect(data.status).toBe("active");
    expect(data.arrivalAirport).toBe("BCN");
  });

  it("landed (runwayTime present) -> actualUtc set, status landed", () => {
    const payload = [
      flight({
        status: "Arrived",
        scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        revisedTime: { utc: "2026-06-05 19:25Z", local: "2026-06-05 21:25+02:00" },
        runwayTime: { utc: "2026-06-05 19:31Z", local: "2026-06-05 21:31+02:00" },
      }),
    ];

    const data = expectOk(parseFlightStatus(payload));

    expect(data.status).toBe("landed");
    expect(data.actualUtc).toBe("2026-06-05T19:31:00Z");
    expect(data.predictedUtc).toBe("2026-06-05T19:25:00Z");
  });

  it("cancelled -> status cancelled (handles both spellings)", () => {
    const american = expectOk(
      parseFlightStatus([flight({ status: "Canceled" })]),
    );
    expect(american.status).toBe("cancelled");

    const british = expectOk(
      parseFlightStatus([flight({ status: "Cancelled" })]),
    );
    expect(british.status).toBe("cancelled");
  });

  it("diverted -> status diverted with arrivalAirport differing from a scheduled fixture", () => {
    const scheduled = expectOk(
      parseFlightStatus([
        flight({
          status: "Scheduled",
          airport: { iata: "BCN", icao: "LEBL", name: "Barcelona" },
          scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        }),
      ]),
    );

    const diverted = expectOk(
      parseFlightStatus([
        flight({
          status: "Diverted",
          airport: { iata: "GRO", icao: "LEGE", name: "Girona" },
          scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        }),
      ]),
    );

    expect(scheduled.status).toBe("scheduled");
    expect(diverted.status).toBe("diverted");
    expect(diverted.arrivalAirport).toBe("GRO");
    expect(diverted.arrivalAirport).not.toBe(scheduled.arrivalAirport);
  });

  it("falls back to ICAO when IATA is absent", () => {
    const data = expectOk(
      parseFlightStatus([
        flight({
          status: "Scheduled",
          airport: { icao: "LEBL", name: "Barcelona" },
          scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        }),
      ]),
    );
    expect(data.arrivalAirport).toBe("LEBL");
  });

  it("maps Expected -> scheduled and unknown labels -> unknown", () => {
    const expected = expectOk(parseFlightStatus([flight({ status: "Expected" })]));
    expect(expected.status).toBe("scheduled");

    const weird = expectOk(parseFlightStatus([flight({ status: "Boarding" })]));
    expect(weird.status).toBe("unknown");
  });

  it("empty array -> not_found", () => {
    expect(parseFlightStatus([]).kind).toBe("not_found");
  });

  it("malformed payloads -> error, never throws", () => {
    // Not an array.
    expect(parseFlightStatus({ status: "EnRoute" }).kind).toBe("error");
    // Missing status.
    expect(parseFlightStatus([{ arrival: { airport: { iata: "BCN" } } }]).kind).toBe("error");
    // Missing arrival block.
    expect(parseFlightStatus([{ status: "EnRoute" }]).kind).toBe("error");
    // Missing airport identifiers.
    expect(
      parseFlightStatus([{ status: "EnRoute", arrival: { airport: { name: "Nowhere" } } }]).kind,
    ).toBe("error");
    // Present-but-malformed time object (utc not a string).
    expect(
      parseFlightStatus([
        {
          status: "EnRoute",
          arrival: { airport: { iata: "BCN" }, revisedTime: { utc: 12345 } },
        },
      ]).kind,
    ).toBe("error");
    // Unparseable instant string.
    expect(
      parseFlightStatus([
        {
          status: "EnRoute",
          arrival: { airport: { iata: "BCN" }, revisedTime: { utc: "not-a-date" } },
        },
      ]).kind,
    ).toBe("error");
  });

  it("revision is stable across two identical payloads", () => {
    const make = () => [
      flight({
        status: "EnRoute",
        scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        revisedTime: { utc: "2026-06-05 19:25Z", local: "2026-06-05 21:25+02:00" },
      }),
    ];

    const a = expectOk(parseFlightStatus(make()));
    const b = expectOk(parseFlightStatus(make()));

    expect(a.revision).toBe(b.revision);
    expect(a.revision).toBe("2026-06-05T19:25:00Z|active|BCN");
  });

  it("revision changes when revisedTime changes", () => {
    const before = expectOk(
      parseFlightStatus([
        flight({
          status: "EnRoute",
          revisedTime: { utc: "2026-06-05 19:25Z", local: "2026-06-05 21:25+02:00" },
        }),
      ]),
    );
    const after = expectOk(
      parseFlightStatus([
        flight({
          status: "EnRoute",
          revisedTime: { utc: "2026-06-05 19:55Z", local: "2026-06-05 21:55+02:00" },
        }),
      ]),
    );

    expect(after.revision).not.toBe(before.revision);
  });

  it("revision falls back to scheduledUtc when no prediction is present", () => {
    const data = expectOk(
      parseFlightStatus([
        flight({
          status: "Scheduled",
          scheduledTime: { utc: "2026-06-05 18:40Z", local: "2026-06-05 20:40+02:00" },
        }),
      ]),
    );
    expect(data.predictedUtc).toBeNull();
    expect(data.revision).toBe("2026-06-05T18:40:00Z|scheduled|BCN");
  });
});
