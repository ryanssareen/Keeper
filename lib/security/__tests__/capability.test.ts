import { describe, it, expect } from "vitest";
import { mintToken, hashToken, verifyToken } from "@/lib/security/capability";

describe("capability tokens", () => {
  it("mints unguessable, unique tokens", () => {
    expect(mintToken()).not.toBe(mintToken());
    expect(mintToken().length).toBeGreaterThan(20);
  });

  it("hashes stably and never stores the raw token", () => {
    const t = mintToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });

  it("verifies the correct token and rejects a wrong one", () => {
    const t = mintToken();
    const h = hashToken(t);
    expect(verifyToken(t, h)).toBe(true);
    expect(verifyToken(mintToken(), h)).toBe(false);
    expect(verifyToken("garbage", h)).toBe(false);
  });
});
