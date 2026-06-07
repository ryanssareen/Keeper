import { describe, it, expect } from "vitest";
import { securityHeaders, buildContentSecurityPolicy } from "@/lib/security/headers";
import { isOriginAllowed } from "@/proxy";

/**
 * Baseline security headers + Origin allowlist (R25). Pure: asserts the required headers are present
 * with sane values, and that the allowlist accepts same-origin / allow-listed origins and rejects a
 * foreign one.
 */

describe("securityHeaders", () => {
  const map = new Map(securityHeaders().map(([k, v]) => [k, v]));

  it("includes all the required baseline headers", () => {
    for (const required of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(map.has(required)).toBe(true);
    }
  });

  it("sets the exact expected values for the simple headers", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets a real HSTS policy with max-age and includeSubDomains", () => {
    const hsts = map.get("Strict-Transport-Security")!;
    expect(hsts).toMatch(/max-age=\d+/);
    expect(hsts).toContain("includeSubDomains");
    const maxAge = Number(hsts.match(/max-age=(\d+)/)![1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000); // at least one year
  });

  it("ships a CSP that locks down the dangerous surface but allows the app's real needs", () => {
    const csp = map.get("Content-Security-Policy")!;
    expect(csp).toBe(buildContentSecurityPolicy());
    // Same-origin default + no plugins + no framing.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    // App needs: scripts self-only, the service worker, same-origin API calls, inline styles.
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // Hardening directive present.
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("does not allow 'unsafe-inline' or 'unsafe-eval' for scripts", () => {
    const csp = map.get("Content-Security-Policy")!;
    const scriptDirective = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptDirective).not.toContain("unsafe-inline");
    expect(scriptDirective).not.toContain("unsafe-eval");
  });

  it("stamps the per-request nonce + strict-dynamic into script-src (production)", () => {
    const csp = buildContentSecurityPolicy("NONCE123", false);
    const scriptDirective = csp.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptDirective).toContain("'nonce-NONCE123'");
    expect(scriptDirective).toContain("'strict-dynamic'");
    expect(scriptDirective).toContain("'self'"); // pre-CSP3 fallback retained
    // The whole point: scripts never go permissive even with a nonce present.
    expect(scriptDirective).not.toContain("unsafe-inline");
    expect(scriptDirective).not.toContain("unsafe-eval");
  });

  it("adds 'unsafe-eval' to script-src only in development (React dev uses eval)", () => {
    const dev = buildContentSecurityPolicy("NONCE123", true);
    const devScript = dev.split(";").find((d) => d.trim().startsWith("script-src"))!;
    expect(devScript).toContain("'unsafe-eval'");
    // Inline scripts stay nonce-gated even in dev — only eval is relaxed.
    expect(devScript).not.toContain("unsafe-inline");
  });
});

describe("isOriginAllowed", () => {
  const self = "https://keeper.app";

  it("accepts a same-origin mutation", () => {
    expect(isOriginAllowed(self, self)).toBe(true);
  });

  it("accepts a request with no Origin header (non-browser / server-to-server client)", () => {
    expect(isOriginAllowed(null, self)).toBe(true);
  });

  it("accepts an explicitly allow-listed origin", () => {
    expect(isOriginAllowed("https://app.keeper.app", self, ["https://app.keeper.app"])).toBe(true);
  });

  it("rejects a foreign origin (cross-site forgery attempt)", () => {
    expect(isOriginAllowed("https://evil.example", self)).toBe(false);
    expect(isOriginAllowed("https://evil.example", self, ["https://app.keeper.app"])).toBe(false);
  });
});
