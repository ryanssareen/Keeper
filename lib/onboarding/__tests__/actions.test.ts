import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase server client so the action's persistence wiring is testable without a DB.
// The bug this guards: a missing table GRANT made every upsert fail with "permission denied", and
// the client's fire-and-forget `.catch()` swallowed it — onboarding selections silently never saved.
// We assert saveOnboarding (a) writes the owner-scoped row, (b) reports failure instead of hiding it.
const getUser = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));

import { saveOnboarding } from "@/lib/onboarding/actions";

const answers = { trip: "Yes", party: "Solo", dest: "Lisbon", code: "LIS" };

describe("saveOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    upsert.mockResolvedValue({ error: null });
  });

  it("upserts the answers onto the signed-in user's own row and reports success", async () => {
    const result = await saveOnboarding(answers, 2, false);

    expect(from).toHaveBeenCalledWith("onboarding");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0]!;
    expect(row).toMatchObject({ user_id: "user-123", answers, step: 2 });
    expect(typeof row.updated_at).toBe("string");
    // An intermediate autosave must NOT write `completed` at all. These calls are fire-and-forget, so
    // one entering the last step can land after the final completed=true write; carrying completed=false
    // would flip a just-finished trip back to incomplete and make it vanish from the dashboard. Omitting
    // the column means the upsert UPDATE never touches it, keeping completion monotonic.
    expect(row).not.toHaveProperty("completed");
    // Conflict target must be user_id so each step advance overwrites the same row (one row per user).
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(result).toEqual({ ok: true });
  });

  it("marks completion through to the row when finishing the wizard", async () => {
    await saveOnboarding(answers, 5, true);
    expect(upsert.mock.calls[0]![0]).toMatchObject({ step: 5, completed: true });
  });

  it("does nothing and reports failure when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const result = await saveOnboarding(answers, 1, false);

    expect(upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });

  it("surfaces a persistence failure instead of swallowing it (the GRANT-denied regression)", async () => {
    upsert.mockResolvedValue({ error: { message: "permission denied for table onboarding" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await saveOnboarding(answers, 1, false);

    expect(result).toEqual({ ok: false });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[onboarding]"),
      expect.stringContaining("permission denied"),
    );
    errSpy.mockRestore();
  });
});
