import { db } from "@/lib/db";
import { ENGINE } from "@/lib/engine/constants";

/**
 * Push an erroring watch's next poll into the near future so a persistent failure can't hot-loop —
 * re-selected and re-fetched (paid) every tick, and sorting to the head of the most-due-first queue
 * where it starves healthy watches (U7 review). Only advances a still-overdue, non-terminal row, so
 * it never clobbers a `next_poll_at` a concurrent successful reconcile already committed. Called
 * best-effort from the batch's error path — failures here are swallowed by the caller.
 */
export async function backoffWatch(watchId: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE watches
    SET next_poll_at = now() + (${ENGINE.errorBackoffMinutes} * interval '1 minute')
    WHERE id = ${watchId}
      AND terminal = FALSE
      AND next_poll_at IS NOT NULL
      AND next_poll_at <= now()`;
}
