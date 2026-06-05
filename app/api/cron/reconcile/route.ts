import { fetchFlight } from "@/lib/adapters/aerodatabox";
import { expireStaleSelfReports } from "@/lib/calibration/backfill";
import { ENGINE } from "@/lib/engine/constants";
import { reconcileWatch } from "@/lib/engine/reconcile";
import { dispatchOutbox } from "@/lib/push/dispatch";
import { backoffWatch } from "@/lib/scheduler/backoff";
import { reconcileDueBatch } from "@/lib/scheduler/batch";
import { selectDueWatches } from "@/lib/scheduler/select";
import { isAuthorizedCron } from "@/lib/security/cron";

/**
 * /api/cron/reconcile — the external scheduler's reconcile tick (R4, R20, R24).
 *
 * Guarded by a constant-time `Authorization: Bearer <CRON_SECRET>` check. Selects due watches
 * (most-due first, capped at ENGINE.maxWatchesPerTick), then reconciles each: the flight is fetched
 * OUTSIDE the lock and handed to the U6 reconcile transaction. Idempotent — a replayed call finds
 * nothing due (U6 already advanced `next_poll_at`) and spends no upstream quota. One watch erroring
 * never aborts the batch.
 *
 * Accepts POST (preferred — the tick mutates state) and GET, since some schedulers (e.g.
 * cron-job.org) default to GET; both require the bearer secret, so a method default can't silently
 * leave the loop un-triggered. The guard is the single seam to swap for QStash/HMAC later.
 */
async function handleTick(req: Request): Promise<Response> {
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const due = await selectDueWatches(ENGINE.maxWatchesPerTick);
    const summary = await reconcileDueBatch(
      due,
      { fetchFlight, reconcileWatch, backoffWatch },
      new Date().toISOString(),
      ENGINE.maxWatchesPerTick,
    );
    // After reconcile commits, drain the transactional outbox (send the catches at-least-once) and
    // retire any unanswered self-report prompts. Both are best-effort: a failure here must not fail
    // the reconcile tick (the fired_transitions rows stay 'attempting' and dispatch retries next tick).
    let dispatched: number | null = null;
    let expired: number | null = null;
    try {
      const d = await dispatchOutbox();
      dispatched = d.sent;
    } catch (e) {
      console.error(`[cron/reconcile] dispatch failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    try {
      expired = await expireStaleSelfReports();
    } catch (e) {
      console.error(`[cron/reconcile] self-report sweep failed: ${e instanceof Error ? e.message : "unknown"}`);
    }

    const tick = { ...summary, dispatched, expired };
    // Server-side signal so an all-errors tick isn't invisible (the scheduler may not log bodies).
    console.log(`[cron/reconcile] ${JSON.stringify(tick)}`);
    return Response.json(tick, { status: 200 });
  } catch (err) {
    // The selector or pool failed (per-watch failures are isolated inside the batch). Keep the JSON
    // error shape consistent and let the scheduler retry on the non-2xx. Never log the secret.
    console.error(`[cron/reconcile] tick failed: ${err instanceof Error ? err.message : "unknown"}`);
    return Response.json({ error: "Reconcile tick failed." }, { status: 500 });
  }
}

export const POST = handleTick;
export const GET = handleTick;
