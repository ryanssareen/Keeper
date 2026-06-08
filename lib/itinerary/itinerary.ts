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
 * A MONITORABLE itinerary item: required `lat`/`lng`/`ianaZone` make a free-text-only item
 * unrepresentable (the strategy guardrail — every item resolves to a real time and place). `title`
 * and `placeName` are LLM-sourced, so they are length-bounded and treated as untrusted strings.
 */
export const monitorableItemSchema = z.object({
  title: z.string().min(1).max(200),
  placeName: z.string().min(1).max(300),
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
