import type { Outcome } from "@/lib/calibration/types";

/**
 * Client-side contract for the self-report POST (U8/R14) — the calibration moat's outcome input.
 *
 * The dashboard form (components/SelfReportForm.tsx) and the service-worker notification action both
 * speak the SAME { watchId, token, outcome, wasUseful } body to POST /api/self-report, validated by
 * that route's Zod schema. This module owns the body shape and the request for the in-app form, kept
 * here (not inlined in the "use client" component) so the exact payload is unit-testable in node with
 * a fake fetch — no jsdom. The SW path is plain unbundled JS and constructs the same body independently.
 */

export interface SelfReportInput {
  watchId: string;
  token: string;
  outcome: Outcome;
  wasUseful: boolean;
}

/** Posting succeeded (the row was recorded) or failed with a message safe to show the traveler. */
export type SelfReportResult = { ok: true } | { ok: false; error: string };

export const SELF_REPORT_PATH = "/api/self-report";

const GENERIC_ERROR = "Couldn’t save that — try again.";

/** PURE: the exact JSON body the route expects. Extracted so the contract can be asserted directly. */
export function buildSelfReportBody(input: SelfReportInput): string {
  return JSON.stringify({
    watchId: input.watchId,
    token: input.token,
    outcome: input.outcome,
    wasUseful: input.wasUseful,
  });
}

/**
 * POST one self-report. `fetchImpl` defaults to the global fetch; tests inject a fake to assert the
 * request without a network. A non-ok response is mapped to the route's `{ error }` (uniform 403 on a
 * bad token), falling back to a generic message. A rejected fetch (offline) propagates to the caller,
 * which surfaces its own network-error copy.
 */
export async function postSelfReport(
  input: SelfReportInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SelfReportResult> {
  const res = await fetchImpl(SELF_REPORT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: buildSelfReportBody(input),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? GENERIC_ERROR };
  }
  return { ok: true };
}
