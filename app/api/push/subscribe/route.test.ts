import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the DB so the write path is exercised without a live connection. The zod body shape and
// the pure validateSubscription guard (host allowlist + key sanity) stay REAL — the point is to
// prove malformed input and untrusted hosts are refused with a 400 BEFORE any credential is stored.
const sqlTag = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => sqlTag }));

import { POST } from "@/app/api/push/subscribe/route";

// A well-formed, allowlisted (FCM) subscription — the happy path. base64url keys long enough to pass
// the pure validator's minimum-length sanity checks.
const goodSub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abcDEF123-_xyz",
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

const req = (body: unknown, raw = false): Request =>
  new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("/api/push/subscribe route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlTag.mockResolvedValue([]); // the UPSERT resolves to no rows
  });

  it("rejects an invalid JSON body with 400 and never touches the DB", async () => {
    const res = await POST(req("{not json", true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body." });
    expect(sqlTag).not.toHaveBeenCalled();
  });

  it("rejects a body that fails the zod schema with 400 (no write)", async () => {
    // Missing keys + too-short deviceId — fails SubscribeBody before the host guard.
    const res = await POST(req({ deviceId: "x", subscription: { endpoint: "https://fcm.googleapis.com/x" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid input." });
    expect(sqlTag).not.toHaveBeenCalled();
  });

  it("rejects an untrusted (non-push-service) host with 400 — SSRF guard, no write", async () => {
    const res = await POST(
      req({ deviceId: "device-12345678", subscription: { ...goodSub, endpoint: "https://evil.attacker.com/hook" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Subscription rejected.", reason: "untrusted_host" });
    expect(sqlTag).not.toHaveBeenCalled();
  });

  it("stores a valid, allowlisted subscription and returns 201", async () => {
    const res = await POST(req({ deviceId: "device-12345678", subscription: goodSub }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(sqlTag).toHaveBeenCalledTimes(1); // the UPSERT ran exactly once
  });
});
