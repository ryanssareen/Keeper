import { describe, it, expect } from "vitest";
import { mapAlertRow } from "@/lib/calibration/dashboard";
import type { AlertFeedEntry } from "@/lib/calibration/dashboard";

/**
 * Pure DB-boundary tests for the cross-watch Alerts feed. mapAlertRow owns the coercion of one raw
 * join row (fired_transitions -> watches) into the render-ready AlertFeedEntry; these lock the
 * snake_case->camelCase mapping, the honest NULLs (sentAt/lead/usefulLead), and the fail-loud enum
 * narrowing — without a database (loadAlertsForUser is the thin, untested live path over this).
 */

// A raw driver row as the postgres.js client returns it: snake_case keys, Date instants, real nulls.
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  watch_id: "w-1",
  flight_number: "EK1",
  place_label: "Trafalgar Square, London",
  kind: "CATCH",
  transition: "AT_RISK->MISS_PREDICTED",
  lead_time_minutes: 45,
  useful_lead: true,
  delivery_status: "sent",
  sent_at: new Date("2026-12-20T17:10:00.000Z"),
  created_at: new Date("2026-12-20T17:09:00.000Z"),
  ...over,
});

describe("mapAlertRow — core mapping", () => {
  it("maps every column snake_case -> camelCase with the watch join fields", () => {
    const entry: AlertFeedEntry = mapAlertRow(row());
    expect(entry).toEqual({
      watchId: "w-1",
      flightNumber: "EK1",
      placeLabel: "Trafalgar Square, London",
      kind: "CATCH",
      transition: "AT_RISK->MISS_PREDICTED",
      leadTimeMinutes: 45,
      usefulLead: true,
      deliveryStatus: "sent",
      sentAt: "2026-12-20T17:10:00.000Z",
      createdAt: "2026-12-20T17:09:00.000Z",
    });
  });

  it("normalizes Date instants to UTC ISO and accepts an ISO-string created_at too", () => {
    const entry = mapAlertRow(row({ created_at: "2026-12-20T17:09:00.000Z", sent_at: null }));
    expect(entry.createdAt).toBe("2026-12-20T17:09:00.000Z");
    expect(entry.sentAt).toBeNull();
  });
});

describe("mapAlertRow — honest NULLs", () => {
  it("keeps sentAt null for a row not yet settled to 'sent'", () => {
    const entry = mapAlertRow(row({ delivery_status: "attempting", sent_at: null }));
    expect(entry.deliveryStatus).toBe("attempting");
    expect(entry.sentAt).toBeNull();
  });

  it("keeps lead/usefulLead null for a non-lead-bearing kind (ALL_CLEAR)", () => {
    const entry = mapAlertRow(
      row({ kind: "ALL_CLEAR", transition: "MISS_PREDICTED->RECOVERED", lead_time_minutes: null, useful_lead: null }),
    );
    expect(entry.kind).toBe("ALL_CLEAR");
    expect(entry.leadTimeMinutes).toBeNull();
    expect(entry.usefulLead).toBeNull();
  });

  it("coerces a falsy-but-present lead of 0 to the number 0 (not null)", () => {
    const entry = mapAlertRow(row({ lead_time_minutes: 0, useful_lead: false }));
    expect(entry.leadTimeMinutes).toBe(0);
    expect(entry.usefulLead).toBe(false);
  });

  it("carries a failed / no_device delivery status through unchanged (reliability backstop)", () => {
    expect(mapAlertRow(row({ delivery_status: "no_device", sent_at: null })).deliveryStatus).toBe("no_device");
    expect(mapAlertRow(row({ delivery_status: "failed", sent_at: null })).deliveryStatus).toBe("failed");
  });
});

describe("mapAlertRow — DB boundary (fail loud, no silent drift)", () => {
  it("THROWS on a kind the union no longer contains, naming the column", () => {
    expect(() => mapAlertRow(row({ kind: "BOGUS" }))).toThrow(/fired_transitions\.kind/);
  });

  it("THROWS on a delivery_status the union no longer contains, naming the column", () => {
    expect(() => mapAlertRow(row({ delivery_status: "delivered" }))).toThrow(
      /fired_transitions\.delivery_status/,
    );
  });
});
