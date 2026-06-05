import { z } from "zod";
import { db } from "@/lib/db";
import { validateSubscription } from "@/lib/push/subscription";

/**
 * POST /api/push/subscribe — register (or refresh) a device's web-push subscription.
 *
 * The endpoint is an attacker-controllable URL we'll later POST to, so we zod-shape the body and
 * then run the pure {@link validateSubscription} guard (host allowlist + key sanity) BEFORE any
 * write — a non-allowlisted host or malformed keys is a 400, never a stored credential. The UPSERT
 * is keyed on the UNIQUE endpoint: the same browser re-subscribing updates its keys + device in
 * place instead of piling up duplicate rows.
 */
const SubscribeBody = z.object({
  deviceId: z.string().min(8).max(128),
  subscription: z.object({
    endpoint: z.string().min(1).max(2000),
    keys: z.object({
      p256dh: z.string().min(1).max(255),
      auth: z.string().min(1).max(255),
    }),
  }),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = SubscribeBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { deviceId, subscription } = parsed.data;
  const verdict = validateSubscription(subscription);
  if (!verdict.valid) {
    return Response.json({ error: "Subscription rejected.", reason: verdict.reason }, { status: 400 });
  }

  const sql = db();
  await sql`
    INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth)
    VALUES (${deviceId}, ${verdict.endpoint}, ${verdict.keys.p256dh}, ${verdict.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE
      SET device_id = EXCLUDED.device_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth`;

  return Response.json({ ok: true }, { status: 201 });
}
