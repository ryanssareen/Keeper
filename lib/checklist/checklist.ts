// Client-safe checklist constants, types, and helpers. NO server imports — this leaf module is pulled
// into the browser bundle by the checklist UI, so the Supabase server client lives in queries.ts /
// actions.ts instead (the documented module-boundary rule).

/** A persisted pre-trip checklist item (row identity + label + done flag + ordering). */
export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  sortOrder: number;
  createdAt: string;
};

/** Max length for a user-typed checklist label — mirrored by the zod bound in actions.ts. */
export const MAX_LABEL = 120;

/**
 * Sensible pre-trip seed inserted the first time the checklist view loads empty (see seedChecklist).
 * Ordered roughly by when you'd tackle each — paperwork first, day-of-flight last.
 */
export const DEFAULT_CHECKLIST: string[] = [
  "Passport valid 6+ months",
  "Notify bank of travel",
  "Pack power adapter",
  "Download offline maps",
  "Confirm airport transfer",
  "Travel insurance docs",
  "Check in for flight (24h)",
];

/** Done/total/percent for a set of items — `pct` is a whole number 0–100 (0 when the list is empty). */
export function checklistProgress(items: ChecklistItem[]): { done: number; total: number; pct: number } {
  const total = items.length;
  const done = items.reduce((n, it) => n + (it.done ? 1 : 0), 0);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}
