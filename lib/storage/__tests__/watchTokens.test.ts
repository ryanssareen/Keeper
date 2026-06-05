import { describe, it, expect } from "vitest";
import { parseWatchTokenMap, tokenForWatch, upsertWatchToken } from "@/lib/storage/watchTokens";

/**
 * The device-local capability-token store, asserted PURE (a raw string in, a value out — no DOM). This
 * is what lets a tokenless push deep-link (/dashboard?id=…) self-heal on the arming device: the arm
 * form writes the map here, the dashboard fallback reads the token back by id. Locking the tolerant
 * parse (current map shape + the legacy list it migrates from) locks the deep-link's resolution.
 */

describe("parseWatchTokenMap", () => {
  it("parses the current map shape { [watchId]: token }", () => {
    const raw = JSON.stringify({ "w-1": "tok-1", "w-2": "tok-2" });
    expect(parseWatchTokenMap(raw)).toEqual({ "w-1": "tok-1", "w-2": "tok-2" });
  });

  it("migrates the legacy list shape [{ watchId, token }] into a map", () => {
    const raw = JSON.stringify([
      { watchId: "w-1", token: "tok-1" },
      { watchId: "w-2", token: "tok-2" },
    ]);
    expect(parseWatchTokenMap(raw)).toEqual({ "w-1": "tok-1", "w-2": "tok-2" });
  });

  it("drops non-string values and malformed list entries", () => {
    expect(parseWatchTokenMap(JSON.stringify({ "w-1": "tok-1", "w-2": 42, "w-3": null }))).toEqual({ "w-1": "tok-1" });
    expect(parseWatchTokenMap(JSON.stringify([{ watchId: "w-1", token: "tok-1" }, { watchId: "w-2" }, null, 7]))).toEqual({
      "w-1": "tok-1",
    });
  });

  it("returns an empty map for null, empty, malformed JSON, or a non-object payload", () => {
    expect(parseWatchTokenMap(null)).toEqual({});
    expect(parseWatchTokenMap("")).toEqual({});
    expect(parseWatchTokenMap("{ not json")).toEqual({});
    expect(parseWatchTokenMap(JSON.stringify("a string"))).toEqual({});
    expect(parseWatchTokenMap(JSON.stringify(42))).toEqual({});
  });
});

describe("tokenForWatch", () => {
  it("returns the token for a stored id (map shape)", () => {
    const raw = JSON.stringify({ "w-1": "tok-1" });
    expect(tokenForWatch(raw, "w-1")).toBe("tok-1");
  });

  it("returns the token for a stored id (legacy list shape)", () => {
    const raw = JSON.stringify([{ watchId: "w-1", token: "tok-1" }]);
    expect(tokenForWatch(raw, "w-1")).toBe("tok-1");
  });

  it("returns null for an id that is not stored", () => {
    expect(tokenForWatch(JSON.stringify({ "w-1": "tok-1" }), "w-2")).toBeNull();
  });

  it("returns null for null/empty/garbage storage", () => {
    expect(tokenForWatch(null, "w-1")).toBeNull();
    expect(tokenForWatch("", "w-1")).toBeNull();
    expect(tokenForWatch("{ not json", "w-1")).toBeNull();
  });
});

describe("upsertWatchToken", () => {
  it("adds a token to an empty store and round-trips through the reader", () => {
    const next = upsertWatchToken(null, "w-1", "tok-1");
    expect(tokenForWatch(next, "w-1")).toBe("tok-1");
  });

  it("preserves existing entries when adding a new one", () => {
    const next = upsertWatchToken(JSON.stringify({ "w-1": "tok-1" }), "w-2", "tok-2");
    expect(parseWatchTokenMap(next)).toEqual({ "w-1": "tok-1", "w-2": "tok-2" });
  });

  it("overwrites the token for an existing id", () => {
    const next = upsertWatchToken(JSON.stringify({ "w-1": "old" }), "w-1", "new");
    expect(tokenForWatch(next, "w-1")).toBe("new");
  });

  it("migrates a legacy list to the map shape in passing", () => {
    const next = upsertWatchToken(JSON.stringify([{ watchId: "w-1", token: "tok-1" }]), "w-2", "tok-2");
    expect(parseWatchTokenMap(next)).toEqual({ "w-1": "tok-1", "w-2": "tok-2" });
  });
});
