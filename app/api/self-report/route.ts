import { z } from "zod";
import { recordSelfReport } from "@/lib/calibration/writer";
import { loadAndVerifyWatch } from "@/lib/security/watchGate";

/**
 * POST /api/self-report — the one-tap outcome capture behind a notification action (U8).
 *
 * Body { watchId, token, outcome: 'made'|'missed'|'changed', wasUseful? } — this contract MUST match
 * the service-worker notification action payload (U8). Capability-checked (R23) through the shared
 * watch gate (loadAndVerifyWatch): a missing watch OR a bad token both return a UNIFORM 403 — a
 * distinct 404 would be an existence oracle (a guesser learns which watch ids are live), matching the
 * dashboard gate's indistinguishable copy. On success the outcome routes through the sole calibration
 * writer (recordSelfReport), which only updates a pending/expired row, so a replay or a double-tap is
 * harmless. Mirrors the native Request/Response route convention of app/api/watch/route.ts.
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

  // Uniform denial: the shared gate returns the same { ok: false } for a missing watch and a bad
  // token, so this 403 never doubles as an existence oracle.
  const access = await loadAndVerifyWatch(watchId, token);
  if (!access.ok) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  await recordSelfReport(watchId, outcome, wasUseful ?? false);
  return Response.json({ ok: true }, { status: 200 });
}
