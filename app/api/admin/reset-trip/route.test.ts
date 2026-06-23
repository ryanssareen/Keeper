import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route's two seams are the pooler connection and the sweep helper. We mock both so the wiring —
// the bearer gate and target-resolution branches — is testable without a database. The security
// contract under test: NO target is touched until a valid secret AND a well-formed target are present.
vi.mock("@/lib/db", () => ({ db: vi.fn(() => ({})) }));
vi.mock("@/lib/admin/resetTrip", () => ({ resetTripsForUsers: vi.fn() }));

import { POST } from "@/app/api/admin/reset-trip/route";
import { db } from "@/lib/db";
import { resetTripsForUsers } from "@/lib/admin/resetTrip";

const SECRET = "test-admin-secret";

const post = (body: unknown, auth?: string): Request =>
  new Request("http://localhost/api/admin/reset-trip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/admin/reset-trip route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET = SECRET;
    vi.mocked(resetTripsForUsers).mockResolvedValue({
      itinerary_items: 5,
      checklist_items: 7,
      trip_attachments: 0,
      trip_shares: 0,
      watches: 1,
      onboarding: 1,
    });
  });
  afterEach(() => {
    delete process.env.ADMIN_SECRET;
  });

  it("rejects a request with no Authorization header (401, no DB touched)", async () => {
    const res = await POST(post({ userId: "u-1" }));
    expect(res.status).toBe(401);
    expect(db).not.toHaveBeenCalled();
    expect(resetTripsForUsers).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer secret (401)", async () => {
    const res = await POST(post({ userId: "u-1" }, "Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(resetTripsForUsers).not.toHaveBeenCalled();
  });

  it("fails closed when no admin/cron secret is configured (401)", async () => {
    delete process.env.ADMIN_SECRET;
    delete process.env.CRON_SECRET;
    const res = await POST(post({ userId: "u-1" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it("rejects a body that is not JSON (400)", async () => {
    const res = await POST(post("not json", `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(resetTripsForUsers).not.toHaveBeenCalled();
  });

  it("requires a target — userId, email, or all (400)", async () => {
    const res = await POST(post({ dryRun: true }, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(resetTripsForUsers).not.toHaveBeenCalled();
  });

  it("on a valid authorized userId reset, runs the sweep and reports counts", async () => {
    const res = await POST(post({ userId: "u-42", dryRun: true }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.matchedUsers).toBe(1);
    expect(json.users).toEqual(["u-42"]);
    expect(resetTripsForUsers).toHaveBeenCalledWith(expect.anything(), ["u-42"], true);
  });

  it("also accepts the already-provisioned CRON_SECRET as the bearer", async () => {
    delete process.env.ADMIN_SECRET;
    process.env.CRON_SECRET = "cron-xyz";
    const res = await POST(post({ userId: "u-9" }, "Bearer cron-xyz"));
    expect(res.status).toBe(200);
    delete process.env.CRON_SECRET;
  });
});
