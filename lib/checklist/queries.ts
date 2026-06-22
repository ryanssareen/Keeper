import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CHECKLIST, type ChecklistItem } from "@/lib/checklist/checklist";

/**
 * Server-only checklist reads. Directiveless (NOT "use server") so a Server Component calls it as a
 * plain async query and keeps cookie context — never invoked from a client component.
 */

type ChecklistRow = {
  id: string;
  label: string;
  done: boolean;
  sort_order: number;
  created_at: string;
};

function mapRow(r: ChecklistRow): ChecklistItem {
  return {
    id: r.id,
    label: r.label,
    done: r.done,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

const COLS = "id, label, done, sort_order, created_at";

/**
 * The current user's pre-trip checklist, ordered by sort_order then creation time. RLS scopes the
 * query to its owner. Returns [] when there's no user, Supabase isn't configured, or the table hasn't
 * been migrated yet (the try/catch keeps the view rendering instead of throwing).
 */
export async function loadChecklist(): Promise<ChecklistItem[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("checklist_items")
      .select(COLS)
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[checklist] load failed:", error.message);
      return [];
    }
    return ((data ?? []) as unknown as ChecklistRow[]).map((r) => mapRow(r));
  } catch (e) {
    // Not configured / table missing — degrade to an empty list rather than crashing the view.
    console.error(`[checklist] load threw: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Load the checklist, seeding the DEFAULT_CHECKLIST the first time it's empty. RENDER-SAFE: unlike the
 * seedChecklist server action this does NOT call revalidatePath (which throws when invoked during
 * render — calling the action from a Server Component body 500s the page). A Server Component calls
 * this directly. Best-effort: any failure degrades to whatever already loaded rather than throwing.
 */
export async function loadChecklistSeeded(): Promise<ChecklistItem[]> {
  const items = await loadChecklist();
  if (items.length > 0) return items;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return items;

    const rows = DEFAULT_CHECKLIST.map((label, idx) => ({
      user_id: user.id,
      label,
      sort_order: idx,
    }));
    const { error } = await supabase.from("checklist_items").insert(rows);
    if (error) {
      console.error("[checklist] seed-on-load failed:", error.message);
      return items;
    }
    return await loadChecklist();
  } catch (e) {
    console.error(`[checklist] seed-on-load threw: ${e instanceof Error ? e.message : String(e)}`);
    return items;
  }
}
