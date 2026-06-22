"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Share-link mint/revoke for the authenticated owner. Writes only — reads (the public status and the
 * owner's active token) live in queries.ts so they keep cookie context and aren't forced through the
 * "use server" boundary. Every write stamps user_id server-side from the verified session and scopes
 * mutations by user_id; revoke also chains .select() so a 0-row (RLS/grant) failure surfaces instead of
 * lying "ok". Flipping user_preferences.share_status is NOT this shard's job — it's left to the
 * preferences shard.
 */

export type CreateShareResult = { ok: true; token: string } | { ok: false };
export type RevokeShareResult = { ok: boolean };

/** Revoke targets an existing opaque token; bound to match the minted length so junk is rejected early. */
const revokeSchema = z.object({ token: z.string().min(1).max(128) });

/**
 * Mint a new, unguessable share token and persist it for the current user. Returns the raw token once
 * (the caller builds the /shared/<token> link). Generated with node:crypto randomBytes (server-only,
 * 256 bits of entropy, base64url so it's URL-safe) — never a guessable/sequential id. The row's user_id
 * is stamped from the verified session, and RLS (owner_all) is the second line of defense on insert.
 */
export async function createShareLink(): Promise<CreateShareResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const token = newShareToken();

  // Stamp user_id explicitly (don't lean on the column DEFAULT) so the row is unambiguously owned even
  // if the default ever changes. .select("token") confirms the insert actually wrote a row — a 0-row
  // "success" (an RLS/grant mismatch Postgres reports without an error) becomes a real failure here.
  const { data, error } = await supabase
    .from("trip_shares")
    .insert({ token, user_id: user.id })
    .select("token");
  if (error) {
    console.error("[share] create failed:", error.message);
    return { ok: false };
  }
  if (!data || data.length === 0) {
    console.warn("[share] create wrote 0 rows (RLS/grant?)");
    return { ok: false };
  }

  revalidatePath("/settings");
  revalidatePath("/shared");
  return { ok: true, token };
}

/**
 * Revoke a share token by soft-deleting it (revoked_at = now()). Scoped by BOTH token AND user_id so an
 * owner can only ever revoke their own links, and .select("token") detects a 0-row update (wrong owner /
 * already revoked / RLS miss) so it can't report a false success. Idempotent enough: revoking an
 * already-revoked or unknown token returns ok:false without throwing.
 */
export async function revokeShareLink(token: string): Promise<RevokeShareResult> {
  const parsed = revokeSchema.safeParse({ token });
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data, error } = await supabase
    .from("trip_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token", parsed.data.token)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("token");
  if (error) {
    console.error("[share] revoke failed:", error.message);
    return { ok: false };
  }
  if (!data || data.length === 0) {
    console.warn("[share] revoke changed 0 rows (wrong owner / already revoked?)");
    return { ok: false };
  }

  revalidatePath("/settings");
  revalidatePath("/shared");
  return { ok: true };
}

/**
 * Mint an unguessable, URL-safe share token. Server-only crypto (node:crypto) — kept here, NOT in the
 * client-safe leaf (lib/share/share.ts), so randomBytes never enters the browser bundle. 32 bytes =
 * 256 bits of entropy; base64url avoids "+/=" so the token drops straight into a /shared/<token> path.
 */
function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}
