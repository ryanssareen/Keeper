import { describe, it, expect } from "vitest";
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  isItemKind,
  isItemStatus,
  monitorableItemSchema,
} from "@/lib/itinerary/itinerary";

const valid = {
  title: "Belém Tower",
  placeName: "Torre de Belém, Lisbon",
  lat: 38.6916,
  lng: -9.216,
  ianaZone: "Europe/Lisbon",
  kind: "sight" as const,
  day: "2026-06-09",
  startTs: "2026-06-09T09:00:00Z",
  endTs: "2026-06-09T10:30:00Z",
};

describe("monitorableItemSchema — free-text-only items are unrepresentable", () => {
  it("accepts a fully-resolved monitorable item", () => {
    expect(monitorableItemSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an item missing coordinates or zone (the monitorability gate)", () => {
    for (const field of ["lat", "lng", "ianaZone"] as const) {
      const { [field]: _omit, ...rest } = valid;
      expect(monitorableItemSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("rejects an empty place or an over-long LLM-sourced title/place_name", () => {
    expect(monitorableItemSchema.safeParse({ ...valid, placeName: "" }).success).toBe(false);
    expect(monitorableItemSchema.safeParse({ ...valid, title: "x".repeat(201) }).success).toBe(false);
    expect(monitorableItemSchema.safeParse({ ...valid, placeName: "x".repeat(301) }).success).toBe(false);
  });

  it("rejects a malformed day and an unknown kind", () => {
    expect(monitorableItemSchema.safeParse({ ...valid, day: "next Tuesday" }).success).toBe(false);
    expect(monitorableItemSchema.safeParse({ ...valid, kind: "spaceship" }).success).toBe(false);
  });

  it("allows null start/end timestamps (an undated item still carries a place)", () => {
    expect(monitorableItemSchema.safeParse({ ...valid, startTs: null, endTs: null }).success).toBe(true);
  });
});

describe("status + kind guards", () => {
  it("validates the four statuses and rejects others", () => {
    expect(ITEM_STATUSES).toEqual(["planned", "completed", "missed", "rescheduled"]);
    expect(isItemStatus("missed")).toBe(true);
    expect(isItemStatus("done")).toBe(false);
    expect(isItemStatus(undefined)).toBe(false);
  });

  it("validates kinds and rejects others", () => {
    expect(ITEM_KINDS).toContain("food");
    expect(isItemKind("food")).toBe(true);
    expect(isItemKind("teleport")).toBe(false);
  });
});
