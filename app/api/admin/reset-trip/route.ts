import { db } from "@/lib/db";
import { safeStringEqual } from "@/lib/security/compare";
import { resetTripsForUsers } from "@/lib/admin/resetTrip";

/**
 * /api/admin/reset-trip — operator-only trip teardown (cleanup utility).
 *
 * Removes every trip-scoped row (itinerary, checklist, attachments, shares, watches + their
 * calibration corpus, and the onboarding trip definition) for one user, a set matched by destination,
 * or every account. Built to purge the leftover "Tokyo" trips that early test signups left on accounts,
 * so a reset account returns to its brand-new, pre-onboarding state.
 *
 * Guarded by a constant-time `Authorization: Bearer <secret>` check against ADMIN_SECRET (falling back
 * to the already-provisioned CRON_SECRET so it works in production without a new env var). It runs on
 * the raw pooler connection (bypasses RLS) — appropriate for a service-level sweep, which is exactly
 * why the bearer gate must hold. DELETE is irreversible, so callers should preview with `dryRun: true`
 * first; the response shape is identical (counts) so the preview matches what the real run will clear.
 *
 * Body (JSON), exactly one target required:
 *   { userId: "<auth uid>" }          — one account
 *   { email: "person@example.com" }   — one account, resolved via auth.users
 *   { all: true }                     — every account that has an onboarding row
 * Optional:
 *   { dest: "Tokyo" }                 — restrict the target set to trips whose destination matches
 *   { dryRun: true }                  — count only, delete nothing
 */
export const dynamic = "force-dynamic";

type Body = {
  userId?: unknown;
  email?: unknown;
  all?: unknown;
  dest?: unknown;
  dryRun?: unknown;
};

function authorized(authHeader: string | null): boolean {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  if (!authHeader) return false;
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) return false;
  return safeStringEqual(match[1], secret);
}

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const userId = asString(body.userId);
  const email = asString(body.email);
  const dest = asString(body.dest);
  const all = body.all === true;
  const dryRun = body.dryRun === true;

  if (!all && !userId && !email) {
    return Response.json(
      { error: "Specify exactly one target: userId, email, or all:true." },
      { status: 400 },
    );
  }

  const sql = db();

  // Resolve the target user-id set.
  let userIds: string[];
  if (all) {
    const rows = await sql<{ user_id: string }[]>`SELECT DISTINCT user_id FROM onboarding`;
    userIds = rows.map((r) => r.user_id);
  } else if (userId) {
    userIds = [userId];
  } else {
    const rows = await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE email = ${email!}`;
    userIds = rows.map((r) => r.id);
  }

  // Optional destination filter — keep only users whose saved trip destination matches (case-insensitive).
  if (dest && userIds.length > 0) {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM onboarding
      WHERE user_id = ANY(${userIds}::text[]) AND lower(answers->>'dest') = lower(${dest})`;
    const keep = new Set(rows.map((r) => r.user_id));
    userIds = userIds.filter((id) => keep.has(id));
  }

  if (userIds.length === 0) {
    return Response.json({ ok: true, dryRun, matchedUsers: 0, users: [], counts: {} });
  }

  const counts = await resetTripsForUsers(sql, userIds, dryRun);

  return Response.json({
    ok: true,
    dryRun,
    matchedUsers: userIds.length,
    users: userIds,
    counts,
  });
}
