import { describe, it, expect, afterEach } from "vitest";
import {
  rateLimitDecision,
  withinWatchCap,
  budgetOk,
  checkIpRateLimit,
  IP_RATE_LIMIT,
  WATCH_CAP_PER_DEVICE,
} from "@/lib/security/ratelimit";

/**
 * Pure abuse-control decisions (R24). No live Upstash/DB: the decisions take their inputs directly,
 * and the env-absent posture of `checkIpRateLimit` is exercised by toggling NODE_ENV with Upstash
 * env deliberately unset.
 */

describe("rateLimitDecision", () => {
  it("allows every hit up to and including the limit", () => {
    for (let hits = 1; hits <= 5; hits++) {
      expect(rateLimitDecision(hits, 5)).toBe(true);
    }
  });

  it("rejects the first hit over the limit (over-limit request is shed before paid work)", () => {
    expect(rateLimitDecision(6, 5)).toBe(false);
    expect(rateLimitDecision(100, 5)).toBe(false);
  });

  it("fails closed when the limit is non-positive", () => {
    expect(rateLimitDecision(1, 0)).toBe(false);
    expect(rateLimitDecision(1, -3)).toBe(false);
  });

  it("trips exactly after N hits per window for the configured IP limit", () => {
    expect(rateLimitDecision(IP_RATE_LIMIT, IP_RATE_LIMIT)).toBe(true);
    expect(rateLimitDecision(IP_RATE_LIMIT + 1, IP_RATE_LIMIT)).toBe(false);
  });
});

describe("withinWatchCap", () => {
  it("permits arming while under the cap", () => {
    expect(withinWatchCap(0, 5)).toBe(true);
    expect(withinWatchCap(4, 5)).toBe(true);
  });

  it("rejects arming at or past the cap", () => {
    expect(withinWatchCap(5, 5)).toBe(false);
    expect(withinWatchCap(9, 5)).toBe(false);
  });

  it("uses the default per-device cap when none is supplied", () => {
    expect(withinWatchCap(WATCH_CAP_PER_DEVICE - 1)).toBe(true);
    expect(withinWatchCap(WATCH_CAP_PER_DEVICE)).toBe(false);
  });

  it("fails closed on a non-positive cap", () => {
    expect(withinWatchCap(0, 0)).toBe(false);
  });
});

describe("budgetOk (circuit breaker)", () => {
  it("accepts new arms while spend is under the monthly threshold", () => {
    expect(budgetOk(0, 1000)).toBe(true);
    expect(budgetOk(999, 1000)).toBe(true);
  });

  it("sheds new arms once spend reaches or exceeds the threshold (existing watches still reconcile)", () => {
    // The breaker is only consulted on arm; reconcile never calls it, so already-armed watches keep
    // running. Here we only assert the arm-side shed.
    expect(budgetOk(1000, 1000)).toBe(false);
    expect(budgetOk(1500, 1000)).toBe(false);
  });

  it("fails closed when no budget threshold is configured", () => {
    expect(budgetOk(0, 0)).toBe(false);
    expect(budgetOk(0, -1)).toBe(false);
  });
});

describe("checkIpRateLimit env-absent posture", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevTok = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    // Restore exactly (delete vs assign) so we never leak env into other suites.
    if (prevNodeEnv === undefined) delete (process.env as Record<string, string>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = prevNodeEnv;
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevTok === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevTok;
  });

  it("bypasses (allowed) in development when Upstash is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    (process.env as Record<string, string>).NODE_ENV = "development";
    const outcome = await checkIpRateLimit("1.2.3.4");
    expect(outcome.allowed).toBe(true);
  });

  it("fails closed (rejected) in production when Upstash is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const outcome = await checkIpRateLimit("1.2.3.4");
    expect(outcome.allowed).toBe(false);
    expect(outcome.remaining).toBe(0);
  });
});
