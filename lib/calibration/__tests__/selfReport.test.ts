import { describe, it, expect } from "vitest";
import {
  buildSelfReportBody,
  postSelfReport,
  SELF_REPORT_PATH,
  type SelfReportInput,
} from "@/lib/calibration/selfReport";

/**
 * The self-report POST contract the dashboard form sends. The route (app/api/self-report) validates
 * the body with Zod and the SW action posts the SAME shape, so the form must send EXACTLY
 * { watchId, token, outcome, wasUseful }. Asserted in node with a fake fetch — no jsdom — by pinning
 * the request the form issues and the result it maps back.
 */

const input: SelfReportInput = { watchId: "w-1", token: "tok-abc", outcome: "made", wasUseful: true };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A typed stand-in for global fetch that records what the form sent, so we can assert the request. */
function recordingFetch(response: Response): {
  impl: typeof fetch;
  calls: { url: string | URL | Request; init: RequestInit | undefined }[];
} {
  const calls: { url: string | URL | Request; init: RequestInit | undefined }[] = [];
  const impl: typeof fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  };
  return { impl, calls };
}

describe("buildSelfReportBody", () => {
  it("serializes exactly the route's { watchId, token, outcome, wasUseful } contract", () => {
    expect(JSON.parse(buildSelfReportBody(input))).toEqual({
      watchId: "w-1",
      token: "tok-abc",
      outcome: "made",
      wasUseful: true,
    });
  });

  it("carries wasUseful: false through unchanged (the form's default)", () => {
    expect(JSON.parse(buildSelfReportBody({ ...input, outcome: "missed", wasUseful: false }))).toEqual({
      watchId: "w-1",
      token: "tok-abc",
      outcome: "missed",
      wasUseful: false,
    });
  });
});

describe("postSelfReport", () => {
  it("POSTs the right method, url, headers, and body, and resolves ok on a 200", async () => {
    const { impl, calls } = recordingFetch(jsonResponse(200, { ok: true }));

    const res = await postSelfReport(input, impl);

    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SELF_REPORT_PATH);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      watchId: "w-1",
      token: "tok-abc",
      outcome: "made",
      wasUseful: true,
    });
  });

  it("surfaces the route's error message on a non-ok response (e.g. the uniform 403)", async () => {
    const { impl } = recordingFetch(jsonResponse(403, { error: "Forbidden." }));

    const res = await postSelfReport({ ...input, token: "wrong" }, impl);

    expect(res).toEqual({ ok: false, error: "Forbidden." });
  });

  it("falls back to a generic error when a failure carries no parseable body", async () => {
    const { impl } = recordingFetch(new Response("upstream exploded", { status: 500 }));

    const res = await postSelfReport(input, impl);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });
});
