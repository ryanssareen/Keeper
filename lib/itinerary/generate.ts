import { z } from "zod";
import { ok, rateLimited, adapterError, type AdapterResult } from "@/lib/adapters/result";
import { ITEM_KINDS, type ItemKind } from "@/lib/itinerary/itinerary";

/**
 * LLM candidate generation for the itinerary (U2). The model is a GROUNDED CANDIDATE GENERATOR, not
 * the planner of record (KTD2): it proposes candidate places per day; U3 verifies each against the
 * geocoder and drops what doesn't resolve. Each candidate carries a local-language name so the U3
 * verifier can do a correct-named-POI match (per U0 — Nominatim resolves "Museo Nacional de
 * Antropología" but not "National Museum of Anthropology").
 *
 * Mirrors the lib/adapters/flight.ts shape: a provider switch (Groq / keyless stub), lazy key read,
 * an AdapterResult return so callers branch instead of throwing, and a keyless fallback for tests.
 */

export type CandidatePlace = { name: string; localName: string; kind: ItemKind };
export type CandidateDay = { date: string; places: CandidatePlace[] };
export type CandidatePlan = { days: CandidateDay[] };
export type GenerationAnchors = { city: string; country: string; days: string[]; party: string };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b"; // verify against /openai/v1/models before launch (KTD3)
const TIMEOUT_MS = 60_000;
const PER_DAY_TARGET = 8; // over-generate; U3 drops unresolved candidates (KTD4)

type Provider = "groq" | "stub";
export function resolveLlmProvider(): Provider {
  return process.env.GROQ_API_KEY ? "groq" : "stub";
}

const candidatePlanSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      places: z.array(
        z.object({
          name: z.string().min(1).max(200),
          localName: z.string().min(1).max(200),
          kind: z.enum(ITEM_KINDS),
        }),
      ),
    }),
  ),
});

/** Validate raw LLM JSON against the candidate-plan shape. Pure — unit-testable without a network. */
export function validateCandidatePlan(raw: unknown): CandidatePlan | null {
  const parsed = candidatePlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "places"],
        properties: {
          date: { type: "string" },
          places: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "localName", "kind"],
              properties: {
                name: { type: "string" },
                localName: { type: "string" },
                kind: { type: "string", enum: [...ITEM_KINDS] },
              },
            },
          },
        },
      },
    },
  },
} as const;

function promptFor(a: GenerationAnchors): string {
  return [
    `Plan a booking-anchored day-by-day itinerary for ${a.party} in ${a.city}, ${a.country}.`,
    `Days (YYYY-MM-DD): ${a.days.join(", ")}.`,
    `For each day, propose ~${PER_DAY_TARGET} specific, real places (a MIX of headline sights AND the long tail — restaurants, cafes, viewpoints, markets, neighborhoods — that makes a trip good). Use real, specific names.`,
    `For each place give: "name" (English/display name), "localName" (the place's name in the local language exactly as it would appear on a map, for geocoding), and "kind".`,
    `Return ${a.days.length} day objects keyed to the dates above.`,
  ].join(" ");
}

async function callGroq(messages: { role: string; content: string }[]): Promise<
  { kind: "ok"; content: string } | { kind: "rate_limited" } | { kind: "error"; message: string }
> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { kind: "error", message: "GROQ_API_KEY not set" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4,
        response_format: { type: "json_schema", json_schema: { name: "itinerary", strict: true, schema: JSON_SCHEMA } },
      }),
    });
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "error", message: `groq ${res.status}` };
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { kind: "error", message: "groq: no content" };
    return { kind: "ok", content };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "groq fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic keyless stand-in so tests (and key-less envs) exercise the pipeline without a network. */
function stubPlan(a: GenerationAnchors): CandidatePlan {
  return {
    days: a.days.map((date) => ({
      date,
      places: [
        { name: `${a.city} Old Town`, localName: `${a.city} Old Town`, kind: "sight" },
        { name: `${a.city} Central Market`, localName: `${a.city} Central Market`, kind: "food" },
      ],
    })),
  };
}

/**
 * Generate candidate places for the trip. Validates the model's JSON and, on failure, runs ONE repair
 * turn (feeding the error back) before giving up — never re-prompts beyond that, never throws.
 */
export async function generateCandidates(anchors: GenerationAnchors): Promise<AdapterResult<CandidatePlan>> {
  if (anchors.days.length === 0) return ok({ days: [] });
  if (resolveLlmProvider() === "stub") return ok(stubPlan(anchors));

  const messages = [{ role: "user", content: promptFor(anchors) }];
  let res = await callGroq(messages);
  if (res.kind === "rate_limited") return rateLimited();
  if (res.kind === "error") return adapterError(res.message);

  let plan = safeParseJson(res.content);
  let valid = plan ? validateCandidatePlan(plan) : null;
  if (!valid) {
    // One repair turn — feed the failure back and ask for corrected JSON.
    const repair = [
      ...messages,
      { role: "assistant", content: res.content },
      { role: "user", content: "That JSON did not match the required schema. Return ONLY corrected JSON matching the schema exactly." },
    ];
    res = await callGroq(repair);
    if (res.kind === "rate_limited") return rateLimited();
    if (res.kind === "error") return adapterError(res.message);
    plan = safeParseJson(res.content);
    valid = plan ? validateCandidatePlan(plan) : null;
  }
  return valid ? ok(valid) : adapterError("itinerary: model output failed schema validation after repair");
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
