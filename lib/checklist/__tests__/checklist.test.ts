import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checklistProgress,
  DEFAULT_CHECKLIST,
  MAX_LABEL,
  type ChecklistItem,
} from "@/lib/checklist/checklist";

// ── Pure helpers (no server imports) ────────────────────────────────────────────────────────────
const item = (over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: "id-1",
  label: "x",
  done: false,
  sortOrder: 0,
  createdAt: "2026-06-22T00:00:00Z",
  ...over,
});

describe("checklistProgress", () => {
  it("reports 0/0/0 for an empty list (no divide-by-zero)", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it("counts done items and rounds the percentage", () => {
    const items = [item({ done: true }), item({ done: false }), item({ done: true })];
    expect(checklistProgress(items)).toEqual({ done: 2, total: 3, pct: 67 });
  });

  it("is 100% when everything is done", () => {
    expect(checklistProgress([item({ done: true }), item({ done: true })])).toEqual({
      done: 2,
      total: 2,
      pct: 100,
    });
  });
});

describe("DEFAULT_CHECKLIST", () => {
  it("seeds the documented 7 pre-trip items", () => {
    expect(DEFAULT_CHECKLIST).toHaveLength(7);
  });

  it("every seed label is within MAX_LABEL", () => {
    for (const label of DEFAULT_CHECKLIST) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(MAX_LABEL);
    }
  });
});

// ── Action (owner-scoped insert) ────────────────────────────────────────────────────────────────
// Mock the Supabase server module so the action's persistence wiring is testable without a DB. The bug
// this guards mirrors the onboarding GRANT regression: a missing base-table GRANT would make every
// insert fail silently. We assert addChecklistItem (a) stamps the signed-in user's id onto the row,
// (b) inserts into the right table, (c) chains .select('id') so a 0-row write surfaces as a failure.
const getCurrentUser = vi.fn();
const select = vi.fn();
const insert = vi.fn(() => ({ select }));
// addChecklistItem first reads max(sort_order) via a select(...).eq(...).order(...).limit(...).maybeSingle()
// chain; make every link return the same thenable-chaining object and resolve sort_order at the leaf.
const sortChain = {
  eq: vi.fn(() => sortChain),
  order: vi.fn(() => sortChain),
  limit: vi.fn(() => sortChain),
  maybeSingle: vi.fn(async () => ({ data: { sort_order: 4 }, error: null })),
};
const tableSelect = vi.fn(() => sortChain);
const from = vi.fn(() => ({ select: tableSelect, insert }));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
  createClient: vi.fn(async () => ({ from })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addChecklistItem } from "@/lib/checklist/actions";

describe("addChecklistItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-123" });
    sortChain.maybeSingle.mockResolvedValue({ data: { sort_order: 4 }, error: null });
    select.mockResolvedValue({ data: [{ id: "new-id" }], error: null });
  });

  it("inserts an owner-scoped row and reports success", async () => {
    const result = await addChecklistItem("Buy SIM card");

    expect(from).toHaveBeenCalledWith("checklist_items");
    expect(insert).toHaveBeenCalledTimes(1);
    const row = (insert.mock.calls[0] as unknown[])[0];
    expect(row).toMatchObject({ user_id: "user-123", label: "Buy SIM card", sort_order: 5 });
    // Must chain .select('id') so a silent 0-row RLS/grant failure can be detected.
    expect(select).toHaveBeenCalledWith("id");
    expect(result).toEqual({ ok: true });
  });

  it("rejects an empty label without touching the DB", async () => {
    const result = await addChecklistItem("   ");
    expect(insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("does nothing and reports failure when there is no authenticated user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const result = await addChecklistItem("Buy SIM card");
    expect(insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("surfaces a 0-row insert as a failure (the silent-RLS regression)", async () => {
    select.mockResolvedValue({ data: [], error: null });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await addChecklistItem("Buy SIM card");
    expect(result.ok).toBe(false);
    warnSpy.mockRestore();
  });
});
