import { z } from "zod";
import { ok, rateLimited, adapterError, type AdapterResult } from "@/lib/adapters/result";
import { ITEM_KINDS, type ItemKind, type ItineraryPrefs, type Pace } from "@/lib/itinerary/itinerary";

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
export type GenerationAnchors = {
  city: string;
  country: string;
  days: string[];
  party: string;
  prefs?: ItineraryPrefs; // optional refinements (ages, interests, pace, must-sees, fixed bookings)
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b"; // verify against /openai/v1/models before launch (KTD3)
const TIMEOUT_MS = 60_000;

// Per-day stop target by pace. Deliberately LOW: a good trip is a few well-chosen stops with room to
// breathe, not a packed checklist (the reference itinerary runs ~3-4 stops on a full day). The booking
// envelope caps the rest; geocoding drops anything that isn't a real mappable place.
const PER_DAY_TARGET = 4;
const PACE_TARGET: Record<Pace, number> = { relaxed: 3, balanced: 4, packed: 6 };
const targetFor = (prefs?: ItineraryPrefs): number => (prefs?.pace ? PACE_TARGET[prefs.pace] : PER_DAY_TARGET);

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

/** Build the generation prompt. Weaves in any optional refinements so a user with a rough idea gets a
 * tailored plan, while an empty prefs object falls back to a generic plan from city + dates. Exported for
 * unit testing the prompt shaping. */
export function promptFor(a: GenerationAnchors): string {
  const target = targetFor(a.prefs);
  const lines = [
    `Plan a RELAXED, realistic day-by-day itinerary for ${a.party} in ${a.city}, ${a.country} — quality over quantity, a trip a real person would enjoy.`,
    `Days (YYYY-MM-DD): ${a.days.join(", ")}.`,
    `Give each day only ~${target} well-chosen stops (e.g. a major sight or two plus a meal or a neighborhood to wander) — NOT a packed checklist. Leave room for travel time, meals and rest, and keep the FIRST day light for arrival.`,
    `Every stop must be a real, fixed, mappable PLACE — a specific landmark, museum, temple, park, garden, viewpoint, market, or a named restaurant/cafe/bar. Do NOT include flights, trains, transfers, transit lines or services, tours, or generic dishes; only somewhere the traveler physically stands that shows up on a map.`,
  ];

  const p = a.prefs;
  if (p?.ages?.trim()) lines.push(`Travelers: ${p.ages.trim()}. Tailor picks to be age-appropriate (e.g. kid-friendly when children are present).`);
  if (p?.interests?.length) lines.push(`Lean toward these interests: ${p.interests.join(", ")}.`);
  if (p?.pace) lines.push(`Pace: ${p.pace} — ${p.pace === "relaxed" ? "fewer stops, more breathing room" : p.pace === "packed" ? "fit in as much as reasonable" : "a balanced day"}.`);
  if (p?.mustSee?.trim()) lines.push(`Must include these places/areas if real and sensible: ${p.mustSee.trim()}.`);
  if (p?.fixed?.trim()) lines.push(`The traveler has FIXED commitments at set times: ${p.fixed.trim()}. Schedule the day's other places around these and do not propose anything that clashes with them.`);
  if (p?.notes?.trim()) lines.push(`Also keep in mind (dietary needs, mobility, budget, vibe, errands, anything else): ${p.notes.trim()}.`);

  lines.push(
    `For each place give: "name" (English/display name), "localName" (the place's name in the local language exactly as it would appear on a map, for geocoding), and "kind" (one of: sight, food, activity, transport, other).`,
    `Return ${a.days.length} day objects keyed to the dates above.`,
    `Respond with ONLY a JSON object of the form {"days":[{"date":"YYYY-MM-DD","places":[{"name":"...","localName":"...","kind":"sight"}]}]} and nothing else.`,
  );
  return lines.join(" ");
}

// Groq's free `on_demand` tier caps tokens-per-minute (TPM) at 8000, and it counts prompt + max_tokens
// against that ceiling per request. The prompt is small (~600 tokens even for a 14-day trip), so cap the
// completion well under the limit: 6000 leaves comfortable headroom AND fits the largest plan we build
// (14 days × ~9 places ≈ 4.5k tokens). Setting this too high (or leaving Groq's default) makes a
// multi-day request exceed 8000 and return 413 "Request too large".
const MAX_TOKENS = 6000;

type GroqResult =
  | { kind: "ok"; content: string }
  | { kind: "rate_limited" }
  | { kind: "error"; message: string; status?: number };

/**
 * One Groq chat call. `mode` selects the response_format: "schema" uses strict structured outputs
 * (best adherence, but only some Groq models support it), "object" uses plain JSON mode (broadly
 * supported) and leans on the prompt + zod validation for shape. On an HTTP error we capture the
 * status AND the body text so the caller can both diagnose and decide whether to retry in object mode.
 */
async function callGroq(messages: { role: string; content: string }[], mode: "schema" | "object"): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { kind: "error", message: "GROQ_API_KEY not set" };
  const responseFormat =
    mode === "schema"
      ? { type: "json_schema", json_schema: { name: "itinerary", strict: true, schema: JSON_SCHEMA } }
      : { type: "json_object" };
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
        max_tokens: MAX_TOKENS,
        response_format: responseFormat,
      }),
    });
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[itinerary] groq ${res.status} (${mode}) ${body.slice(0, 300)}`);
      return { kind: "error", message: `groq ${res.status}: ${body.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { kind: "error", message: "groq: no content" };
    return { kind: "ok", content };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : "groq fetch failed" };
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

  // Prefer strict structured outputs; if the model/endpoint rejects that FORMAT (400/422 — e.g.
  // "response_format not supported" on a model that lacks it), fall back to plain JSON mode, which is
  // broadly supported. Only format errors warrant the retry: a 413 (too large) or 5xx won't be helped by
  // re-sending the same-size request and would just burn the per-minute token budget.
  let mode: "schema" | "object" = "schema";
  let res = await callGroq(messages, mode);
  if (res.kind === "error" && (res.status === 400 || res.status === 422)) {
    console.warn(`[itinerary] groq schema mode rejected (${res.message}); retrying in json_object mode`);
    mode = "object";
    res = await callGroq(messages, mode);
  }
  if (res.kind === "rate_limited") return rateLimited();
  if (res.kind === "error") return adapterError(res.message);

  let plan = safeParseJson(res.content);
  let valid = plan ? validateCandidatePlan(plan) : null;
  if (!valid) {
    // One repair turn — feed the failure back and ask for corrected JSON (same mode as the call above).
    const repair = [
      ...messages,
      { role: "assistant", content: res.content },
      { role: "user", content: "That JSON did not match the required shape. Return ONLY corrected JSON matching the shape exactly." },
    ];
    res = await callGroq(repair, mode);
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
