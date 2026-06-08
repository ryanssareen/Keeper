import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveLlmProvider,
  validateCandidatePlan,
  generateCandidates,
  type GenerationAnchors,
} from "@/lib/itinerary/generate";

const anchors: GenerationAnchors = {
  city: "Lisbon",
  country: "Portugal",
  days: ["2026-06-09", "2026-06-10"],
  party: "Solo",
};

const validContent = JSON.stringify({
  days: [{ date: "2026-06-09", places: [{ name: "Belém Tower", localName: "Torre de Belém", kind: "sight" }] }],
});

const groqResponse = (status: number, content?: string) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => ({ choices: [{ message: { content } }] }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveLlmProvider", () => {
  it("is stub without a key, groq with one", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(resolveLlmProvider()).toBe("stub");
    vi.stubEnv("GROQ_API_KEY", "k");
    expect(resolveLlmProvider()).toBe("groq");
  });
});

describe("validateCandidatePlan", () => {
  it("accepts a well-formed plan and rejects malformed ones", () => {
    expect(validateCandidatePlan(JSON.parse(validContent))).not.toBeNull();
    expect(validateCandidatePlan({ days: [{ date: "x", places: [{ name: "n", localName: "l" }] }] })).toBeNull(); // missing kind
    expect(validateCandidatePlan({ days: [{ date: "x", places: [{ name: "n", localName: "l", kind: "ufo" }] }] })).toBeNull();
    expect(validateCandidatePlan("not an object")).toBeNull();
  });
});

describe("generateCandidates — stub + edge", () => {
  it("returns a stub plan when no key is set", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const r = await generateCandidates(anchors);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.days).toHaveLength(2);
  });

  it("returns an empty plan for zero days without calling the model", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await generateCandidates({ ...anchors, days: [] });
    expect(r.kind).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generateCandidates — groq branches", () => {
  it("returns ok on a schema-valid response", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(groqResponse(200, validContent)));
    const r = await generateCandidates(anchors);
    expect(r.kind).toBe("ok");
  });

  it("maps a 429 to rate_limited", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(groqResponse(429)));
    expect((await generateCandidates(anchors)).kind).toBe("rate_limited");
  });

  it("maps a non-ok status to error", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(groqResponse(500)));
    expect((await generateCandidates(anchors)).kind).toBe("error");
  });

  it("runs one repair turn on malformed JSON, then succeeds", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groqResponse(200, "{ not json"))
      .mockResolvedValueOnce(groqResponse(200, validContent));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generateCandidates(anchors);
    expect(r.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("errors when the repair turn also fails (no infinite retry)", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const fetchMock = vi.fn().mockResolvedValue(groqResponse(200, "{ still not json"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generateCandidates(anchors);
    expect(r.kind).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
