import { createClient } from "@/lib/supabase/server";
import { BUCKET, isAttachmentKind, type TripAttachment } from "@/lib/trips/attachments";

/**
 * Server-only attachment reads. Kept out of the client-safe constants module (attachments.ts) and out
 * of the "use server" actions module so a Server Component can call these directly without every
 * export becoming an RPC endpoint.
 */

type AttachmentRow = {
  id: string;
  kind: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** Every attachment owned by the current user, newest first. RLS scopes the query to its owner. */
export async function listAttachments(): Promise<TripAttachment[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("trip_attachments")
    .select("id, kind, file_name, file_path, content_type, size_bytes, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[trips] failed to list attachments:", error.message);
    return [];
  }

  return (data ?? []).map((r: AttachmentRow) => ({
    id: r.id,
    kind: isAttachmentKind(r.kind) ? r.kind : "other",
    fileName: r.file_name,
    filePath: r.file_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }));
}

/** A short-lived signed URL to download one stored file (the bucket is private). */
export async function signedUrl(filePath: string, expiresInSeconds = 60): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, expiresInSeconds);
  if (error) {
    console.error("[trips] failed to sign attachment url:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
