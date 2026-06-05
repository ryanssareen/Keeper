import { describe, it, expect } from "vitest";
import { validateSubscription, type RawPushSubscription } from "@/lib/push/subscription";

/**
 * Pure tests for the subscribe-time guard. The endpoint is attacker-controllable, so the host
 * allowlist is the SSRF boundary: only known browser push services may be stored. Keys must be
 * present and look like base64url.
 */

// A 65-byte p256dh and 16-byte auth, both base64url-ish (length-plausible).
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhfGTJaP-uA";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

const clean = (over: Partial<RawPushSubscription> = {}): RawPushSubscription => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: P256DH, auth: AUTH },
  ...over,
});

describe("validateSubscription — host allowlist", () => {
  it("accepts a clean FCM endpoint with well-formed keys", () => {
    const res = validateSubscription(clean());
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
      expect(res.keys.p256dh).toBe(P256DH);
    }
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/x",
    "https://android.googleapis.com/fcm/send/x",
    "https://web.push.apple.com/abc",
    "https://abc.notify.windows.com/w/xyz",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
  ])("accepts allowlisted push service %s", (endpoint) => {
    expect(validateSubscription(clean({ endpoint })).valid).toBe(true);
  });

  it("rejects a hostile, non-allowlisted host (SSRF guard)", () => {
    const res = validateSubscription(clean({ endpoint: "https://evil.attacker.com/steal" }));
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("untrusted_host");
    }
  });

  it("rejects a look-alike suffix attack (apple host as a deeper subdomain of attacker)", () => {
    // ".push.apple.com" must match a real label boundary, not be a substring of the attacker domain.
    const res = validateSubscription(
      clean({ endpoint: "https://web.push.apple.com.attacker.com/abc" }),
    );
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("untrusted_host");
    }
  });

  it("rejects a non-https endpoint", () => {
    const res = validateSubscription(clean({ endpoint: "http://fcm.googleapis.com/fcm/send/x" }));
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("malformed_endpoint");
    }
  });

  it("rejects a garbage endpoint that isn't a URL", () => {
    const res = validateSubscription(clean({ endpoint: "not a url" }));
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("malformed_endpoint");
    }
  });
});

describe("validateSubscription — keys", () => {
  it("rejects when keys are missing entirely", () => {
    // Force a malformed payload past the type with a cast — the guard must still refuse it.
    const res = validateSubscription({ endpoint: clean().endpoint } as unknown as RawPushSubscription);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("missing_keys");
    }
  });

  it("rejects when one key is absent", () => {
    const res = validateSubscription({
      endpoint: clean().endpoint,
      keys: { p256dh: P256DH },
    } as unknown as RawPushSubscription);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("missing_keys");
    }
  });

  it("rejects keys that aren't base64url (illegal chars)", () => {
    const res = validateSubscription(clean({ keys: { p256dh: "!!!not-base64!!!***", auth: AUTH } }));
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("malformed_keys");
    }
  });

  it("rejects an implausibly short p256dh", () => {
    const res = validateSubscription(clean({ keys: { p256dh: "AAAA", auth: AUTH } }));
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("malformed_keys");
    }
  });
});
