"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { DEFAULT_CHECKLIST, MAX_LABEL } from "@/lib/checklist/checklist";

/**
 * Pre-trip checklist writes. "use server" — every action stamps user_id server-side from
 * getCurrentUser(), scopes mutations by BOTH id AND user_id (defense-in-depth beyond RLS), and chains
 * `.select('id')` to surface a silent 0-row RLS/grant failure as a real error. Reads live in queries.ts.
 */

export type ActionResult = { ok: boolean; error?: string };

const labelSchema = z.string().trim().min(1).max(MAX_LABEL);
const idSchema = z.string().uuid();

/** Re-validate both checklist surfaces after a write (the list view and the dashboard "today" rollup). */
function revalidateChecklist(): void {
  revalidatePath("/checklist");
  revalidatePath("/today");
}

/** Append a new item. Sorts after everything the user already has (max sort_order + 1). */
export async function addChecklistItem(label: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) return { ok: false, error: "Enter a label (120 characters max)." };

  const supabase = await createClient();

  // Place the new item at the end of the list. Best-effort: if this read fails we fall back to 0 (the
  // table default), which still inserts — just at the top — rather than blocking the add.
  const { data: last } = await supabase
    .from("checklist_items")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("checklist_items")
    .insert({ user_id: user.id, label: parsed.data, sort_order: sortOrder })
    .select("id");
  if (error) {
    console.error("[checklist] add failed:", error.message);
    return { ok: false, error: "Couldn’t add that item — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn("[checklist] add inserted 0 rows");
    return { ok: false, error: "Couldn’t add that item — please reload and try again." };
  }
  revalidateChecklist();
  return { ok: true };
}

/** Flip an item's done flag. Scoped by id AND user_id. */
export async function toggleChecklistItem(id: string, done: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Unknown item." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checklist_items")
    .update({ done, updated_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    console.error("[checklist] toggle failed:", error.message);
    return { ok: false, error: "Couldn’t update that item — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn(`[checklist] toggle changed 0 rows ${JSON.stringify({ id, done })}`);
    return { ok: false, error: "Couldn’t update that item — please reload and try again." };
  }
  revalidateChecklist();
  return { ok: true };
}

/** Remove one item. Scoped by id AND user_id. */
export async function deleteChecklistItem(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Unknown item." };

  const supabase = await createClient();
  // `.select()` returns the rows actually deleted — so a 0-row delete (an RLS/grant mismatch Postgres
  // reports without an error) surfaces as a real failure instead of a silent "success".
  const { data, error } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", parsedId.data)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    console.error("[checklist] delete failed:", error.message);
    return { ok: false, error: "Couldn’t remove that item — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn(`[checklist] delete removed 0 rows ${JSON.stringify({ id })}`);
    return { ok: false, error: "Couldn’t remove that item — please reload and try again." };
  }
  revalidateChecklist();
  return { ok: true };
}

/**
 * Seed the DEFAULT_CHECKLIST rows for a user who has none — called the first time the checklist view
 * loads empty. Guards against double-seeding by checking for any existing row first, so a stray second
 * call (e.g. a double render) can't duplicate the starter list.
 */
export async function seedChecklist(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const supabase = await createClient();

  // Only seed when the user truly has nothing — never append a second copy of the starter list.
  const { data: existing, error: existErr } = await supabase
    .from("checklist_items")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);
  if (existErr) {
    console.error("[checklist] seed precheck failed:", existErr.message);
    return { ok: false, error: "Couldn’t set up your checklist — please try again." };
  }
  if (existing && existing.length > 0) return { ok: true };

  const rows = DEFAULT_CHECKLIST.map((label, idx) => ({
    user_id: user.id,
    label,
    sort_order: idx,
  }));
  const { data, error } = await supabase.from("checklist_items").insert(rows).select("id");
  if (error) {
    console.error("[checklist] seed failed:", error.message);
    return { ok: false, error: "Couldn’t set up your checklist — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn("[checklist] seed inserted 0 rows");
    return { ok: false, error: "Couldn’t set up your checklist — please reload and try again." };
  }
  revalidateChecklist();
  return { ok: true };
}
