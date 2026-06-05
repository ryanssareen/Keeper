import { describe, it, expect } from "vitest";
import { isAuthorizedCron } from "@/lib/security/cron";

const SECRET = "s3cr3t-cron-value-9af2";

describe("isAuthorizedCron (constant-time bearer check, R20)", () => {
  it("accepts a correct Bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorizedCron("Bearer not-the-secret", SECRET)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("rejects a non-Bearer scheme (raw secret, no prefix)", () => {
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
  });

  it("rejects a secret that is a prefix of the expected (no length shortcut)", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it("rejects a same-length value with different content (the real constant-time probe)", () => {
    const sameLength = "x".repeat(SECRET.length);
    expect(sameLength.length).toBe(SECRET.length);
    expect(isAuthorizedCron(`Bearer ${sameLength}`, SECRET)).toBe(false);
  });

  it("rejects a lowercase 'bearer' scheme (case-sensitive)", () => {
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects 'Bearer ' with an empty token", () => {
    expect(isAuthorizedCron("Bearer ", SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}`, "")).toBe(false);
  });
});
