"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BUCKET, isAttachmentKind } from "@/lib/trips/attachments";
import { signedUrl } from "@/lib/trips/queries";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = /\.(pdf|png|jpe?g|webp|heic|gif|txt)$/i;

/** Sanitize a user-supplied filename to a safe storage object name (no path traversal, no spaces). */
const safeName = (name: string): string =>
  name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-80) || "file";

/**
 * Upload one booking document, classified by the user-picked `kind`. The file lands in the private
 * `trip-docs` bucket under a per-user folder ("<uid>/<uuid>-<name>") that storage RLS enforces, and a
 * `trip_attachments` row records it. Every failure path returns a message — nothing fails silently.
 */
export async function uploadAttachment(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in to upload." };

  const file = formData.get("file");
  const kindRaw = formData.get("kind");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That file is over the 10 MB limit." };
  if (!ALLOWED.test(file.name)) return { ok: false, error: "Unsupported file type (PDF, image, or text only)." };
  const kind = isAttachmentKind(kindRaw) ? kindRaw : "other";

  const path = `${user.id}/${randomUUID()}-${safeName(file.name)}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) {
    console.error("[trips] storage upload failed:", upErr.message);
    return { ok: false, error: "Upload failed — please try again." };
  }

  const { error: rowErr } = await supabase.from("trip_attachments").insert({
    user_id: user.id,
    kind,
    file_path: path,
    file_name: file.name.slice(0, 200),
    content_type: file.type || null,
    size_bytes: file.size,
  });
  if (rowErr) {
    // Roll back the orphaned object so storage and the table don't drift.
    await supabase.storage.from(BUCKET).remove([path]);
    console.error("[trips] attachment row insert failed:", rowErr.message);
    return { ok: false, error: "Couldn’t save the attachment — please try again." };
  }

  revalidatePath("/trips");
  return { ok: true };
}

/** Delete an attachment (row + stored object). RLS ensures a user can only delete their own. */
export async function deleteAttachment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: row, error: findErr } = await supabase
    .from("trip_attachments")
    .select("file_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (findErr || !row) return { ok: false, error: "That attachment no longer exists." };

  const { error: delErr } = await supabase.from("trip_attachments").delete().eq("id", id).eq("user_id", user.id);
  if (delErr) {
    console.error("[trips] attachment delete failed:", delErr.message);
    return { ok: false, error: "Couldn’t remove the attachment — please try again." };
  }
  await supabase.storage.from(BUCKET).remove([row.file_path]);

  revalidatePath("/trips");
  return { ok: true };
}

/** Mint a fresh signed download URL on demand (called from the client when a user clicks a file). */
export async function getDownloadUrl(filePath: string): Promise<string | null> {
  return signedUrl(filePath, 120);
}
