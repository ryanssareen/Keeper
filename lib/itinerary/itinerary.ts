// Client-safe itinerary constants, types, and the zod schema. NO server imports — this module is
// pulled into the browser bundle by the itinerary UI, so the Supabase server client and the Groq
// adapter live in queries.ts / generate.ts / actions.ts instead (the documented module-boundary rule).
import { z } from "zod";

/** Coarse kind of an itinerary item — a soft hint for grouping/labelling, not a hard constraint. */
export const ITEM_KINDS = ["sight", "food", "activity", "transport", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const isItemKind = (v: unknown): v is ItemKind =>
  typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);

/** Adherence status. `planned` → `completed`/`missed`; a reschedule lands as `rescheduled`. */
export const ITEM_STATUSES = ["planned", "completed", "missed", "rescheduled"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const isItemStatus = (v: unknown): v is ItemStatus =>
  typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);

/**
 * Optional refinement the user can add before generating (the "I have a rough idea" path). All fields are
 * optional — an empty prefs object means "just plan from my destination + dates". Fed into the LLM prompt;
 * persisted alongside the onboarding answers so a reload / regenerate keeps them.
 */
export const INTEREST_OPTIONS = [
  "Food & drink",
  "Art & museums",
  "History",
  "Nature & parks",
  "Nightlife",
  "Shopping",
  "Architecture",
  "Local & offbeat",
] as const;
export type Interest = (typeof INTEREST_OPTIONS)[number];

export const PACE_OPTIONS = ["relaxed", "balanced", "packed"] as const;
export type Pace = (typeof PACE_OPTIONS)[number];
export const isPace = (v: unknown): v is Pace =>
  typeof v === "string" && (PACE_OPTIONS as readonly string[]).includes(v);

export type ItineraryPrefs = {
  ages?: string; // free text, e.g. "2 adults, 1 child age 7"
  interests?: string[]; // subset of INTEREST_OPTIONS (kept as string[] — LLM-/storage-tolerant)
  pace?: Pace;
  mustSee?: string; // specific places / neighborhoods to include
  fixed?: string; // reservations or tickets at set times, e.g. "dinner 8pm Jul 2"
  notes?: string; // anything else — dietary needs, mobility, budget, vibe, errands, etc.
};

/** True when at least one refinement field is filled (drives "should we show this as set" UI). */
export function hasPrefs(p?: ItineraryPrefs | null): boolean {
  if (!p) return false;
  return Boolean(
    p.ages?.trim() || (p.interests && p.interests.length) || p.pace || p.mustSee?.trim() || p.fixed?.trim() || p.notes?.trim(),
  );
}

/**
 * A MONITORABLE itinerary item: required `lat`/`lng`/`ianaZone` make a free-text-only item
 * unrepresentable (the strategy guardrail — every item resolves to a real time and place). `title`
 * and `placeName` are LLM-sourced, so they are length-bounded and treated as untrusted strings.
 */
export const monitorableItemSchema = z.object({
  title: z.string().min(1).max(200),
  placeName: z.string().min(1).max(300),
  description: z.string().max(300).optional(), // one-line "why / what it is" (optional, LLM-sourced)
  lat: z.number(),
  lng: z.number(),
  ianaZone: z.string().min(1),
  kind: z.enum(ITEM_KINDS),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  startTs: z.string().nullable(),
  endTs: z.string().nullable(),
});
export type MonitorableItem = z.infer<typeof monitorableItemSchema>;

/** A persisted itinerary item (a monitorable item plus its row identity + adherence status). */
export type ItineraryItem = MonitorableItem & {
  id: string;
  status: ItemStatus;
  createdAt: string;
};

/** Group items by `day`, preserving insertion order within each day. */
export function groupByDay<T extends { day: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const list = map.get(it.day) ?? [];
    list.push(it);
    map.set(it.day, list);
  }
  return map;
}

/** Total-order string compare (returns 0 for equal) — safe for Array.sort, unlike a `< ? -1 : 1` form. */
export const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
