import { z } from "zod";
import { db } from "@/lib/db";
import { recordSelfReport } from "@/lib/calibration/writer";
import { verifyToken } from "@/lib/security/capability";

/**
 * POST /api/self-report — the one-tap outcome capture behind a notification action (U8).
 *
 * Body { watchId, token, outcome: 'made'|'missed'|'changed', wasUseful? } — this contract MUST match
 * the service-worker notification action payload (U8). Capability-checked (R23): the presented token
 * is verified against the watch's stored owner_token_hash; a missing watch is 404 and a bad token is
 * 403. On success the outcome routes through the sole calibration writer (recordSelfReport), which
 * only updates a pending/expired row, so a replay or a double-tap is harmless. Mirrors the native
 * Request/Response route convention of app/api/watch/route.ts — no Pages Router, no NextResponse.
 */

const SelfReportBody = z.object({
  watchId: z.string().min(1).max(64),
  token: z.string().min(1).max(512),
  outcome: z.enum(["made", "missed", "changed"]),
  wasUseful: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = SelfReportBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { watchId, token, outcome, wasUseful } = parsed.data;

  const sql = db();
  const rows = await sql`SELECT owner_token_hash FROM watches WHERE id = ${watchId}`;
  // Uniform denial for a missing watch OR a bad token — a distinct 404 would be an existence oracle
  // (a guesser learns which watch ids are live), matching the dashboard gate's indistinguishable copy.
  if (rows.length === 0 || !verifyToken(token, String(rows[0].owner_token_hash))) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  await recordSelfReport(watchId, outcome, wasUseful ?? false);
  return Response.json({ ok: true }, { status: 200 });
}
