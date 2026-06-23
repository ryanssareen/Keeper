import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Isolate the proxy's header pipeline from its IO collaborators: the session refresh (network) and
// the rate limiter (Redis). We only want to assert the cross-cutting CSP/nonce behaviour here.
vi.mock("@/lib/supabase/middleware", () => ({
  refreshSession: vi.fn(async (_req: unknown, requestHeaders: Headers) => ({
    response: NextResponse.next({ request: { headers: requestHeaders } }),
    user: null,
  })),
}));
vi.mock("@/lib/security/ratelimit", () => ({
  checkIpRateLimit: vi.fn(async () => ({ allowed: true, limit: 100, remaining: 99 })),
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const get = (path = "/") => new NextRequest(`http://localhost${path}`, { method: "GET" });
const cspOf = (res: NextResponse) => res.headers.get("Content-Security-Policy") ?? "";
const scriptSrc = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";

describe("proxy CSP nonce (hydration guard)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps a per-request nonce + strict-dynamic into the response script-src", async () => {
    // The whole reason onboarding's buttons went dead: without a nonce, Next's inline bootstrap/RSC
    // scripts are CSP-blocked, React never hydrates, and every onClick silently dies. The nonce is
    // what makes those inline scripts execute again.
    const res = await proxy(get("/onboarding"));
    const script = scriptSrc(cspOf(res));

    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("mints a fresh, unpredictable nonce per request", async () => {
    const nonceOf = (res: NextResponse) => scriptSrc(cspOf(res)).match(/'nonce-([^']+)'/)?.[1];
    const a = nonceOf(await proxy(get("/")));
    const b = nonceOf(await proxy(get("/")));

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("forwards the same nonce on the request headers so Next can stamp it onto its scripts", async () => {
    // Next extracts the nonce from the REQUEST's Content-Security-Policy header during SSR. If the
    // request CSP nonce and the response CSP nonce diverge, the browser blocks every script Next
    // emitted — so they must be identical.
    const { refreshSession } = await import("@/lib/supabase/middleware");
    const res = await proxy(get("/"));

    const forwardedHeaders = vi.mocked(refreshSession).mock.calls[0]![1];
    const reqNonce = (forwardedHeaders.get("Content-Security-Policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
    const resNonce = scriptSrc(cspOf(res)).match(/'nonce-([^']+)'/)?.[1];

    expect(forwardedHeaders.get("x-nonce")).toBe(reqNonce);
    expect(reqNonce).toBe(resNonce);
  });
});

describe("proxy logged-in redirect off the marketing/auth pages", () => {
  // refreshSession is the seam that resolves the session. Reset it to the logged-OUT default before
  // each test (mockImplementation persists past clearAllMocks), then opt into signed-in per test.
  const setUser = async (user: { id: string } | null) => {
    const { refreshSession } = await import("@/lib/supabase/middleware");
    vi.mocked(refreshSession).mockImplementation(async (_req: unknown, requestHeaders: Headers) => ({
      response: NextResponse.next({ request: { headers: requestHeaders } }),
      user: user as never, // minimal shape — the proxy only checks truthiness
    }));
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    await setUser(null);
  });

  it("redirects a signed-in GET of the landing page to /today", async () => {
    await setUser({ id: "u-1" });
    const res = await proxy(get("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/today$/);
  });

  it("redirects signed-in /login and /signup to /today too", async () => {
    await setUser({ id: "u-1" });
    for (const path of ["/login", "/signup"]) {
      const res = await proxy(get(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toMatch(/\/today$/);
    }
  });

  it("leaves OTHER marketing pages alone for a signed-in user (no redirect loop on /features)", async () => {
    await setUser({ id: "u-1" });
    const res = await proxy(get("/features"));
    // Passed through (NextResponse.next), not a 3xx to /today — so there is no Location header.
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect a logged-OUT visitor off the landing page (marketing stays public)", async () => {
    const res = await proxy(get("/"));
    expect(res.headers.get("location")).toBeNull();
  });
});
