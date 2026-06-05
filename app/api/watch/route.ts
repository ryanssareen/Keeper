import { z } from "zod";
import { armWatch } from "@/lib/engine/arm";
import { db } from "@/lib/db";
import { loadAndVerifyWatch } from "@/lib/security/watchGate";

const ArmBody = z.object({
  deviceId: z.string().min(8).max(128),
  flightNumber: z.string().min(2).max(10),
  flightDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  placeQuery: z.string().min(2).max(200),
  commitmentLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  reschedulable: z.boolean(),
  marginMinutes: z.number().int().min(0).max(360).optional(),
  contact: z.string().max(200).nullable().optional(),
});

/** POST /api/watch — arm a watch. Validate input, then run the arm flow. */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ArmBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const res = await armWatch(parsed.data, new Date().toISOString());
  if (!res.ok) return Response.json({ error: res.reason }, { status: 400 });
  return Response.json(res.watch, { status: 201 });
}

/** GET /api/watch?id=&token= — capability-checked read of a watch's current state. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  if (!id || !token) return Response.json({ error: "Missing id or token." }, { status: 400 });

  // Shared gate: SELECT-then-verify in one place. Uniform 403 for a missing watch OR a bad token —
  // no 404 existence oracle (a guesser can't tell 'no such watch' from 'not your watch').
  const access = await loadAndVerifyWatch(id, token);
  if (!access.ok) return Response.json({ error: "Forbidden." }, { status: 403 });

  const w = access.watch;
  const sql = db();
  const snap = await sql`
    SELECT verdict, slack_minutes, predicted_arrival, resulting_state, fetched_at
    FROM prediction_snapshots WHERE watch_id = ${id} ORDER BY fetched_at DESC LIMIT 1`;

  return Response.json({
    id: w.id,
    state: w.state,
    placeLabel: w.placeLabel,
    flightNumber: w.flightNumber,
    commitmentInstantUtc: w.commitmentInstantUtc,
    zone: w.commitmentZone,
    reschedulable: w.reschedulable,
    latest: snap[0] ?? null,
  });
}
