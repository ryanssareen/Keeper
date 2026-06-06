import { createHash } from "node:crypto";

import { DateTime } from "luxon";
import webpush, { WebPushError } from "web-push";

import { db } from "@/lib/db";
import {
  claimFiredTransitions,
  reclaimStuckSending,
  recordDelivery,
  requeueFiredTransition,
} from "@/lib/calibration/writer";
import { renderCatch } from "@/lib/push/template";
import type { StructuredAdvice, CatchMessage } from "@/lib/push/types";
import type { ClaimedOutboxRow } from "@/lib/calibration/types";
import type { FiredKind } from "@/lib/engine/types";

/**
 * Catch dispatcher (U8) — drains the transactional outbox (`fired_transitions` rows still
 * `attempting`) and delivers each firing as a web push, at-least-once.
 *
 * Split, like the rest of the engine, into a PURE planner and a thin IO shell:
 *  - {@link buildAdvice} reconstructs the {@link StructuredAdvice} the catch template renders, from a
 *    fired transition + the latest prediction snapshot. No IO; unit-tested branch by branch.
 *  - {@link planSend} decides, for one outbox row + its (optional) subscription, whether to send and
 *    with what payload / TTL / terminal status. No IO; unit-tested across the reschedulable, fixed,
 *    and no-device scenarios.
 *  - {@link dispatchOutbox} is the shell: claim rows, run the planner, call web-push, then write the
 *    delivery status through the SOLE writer (`recordDelivery`) and prune a subscription that the
 *    push service has retired (404/410). It NEVER touches calibration/snapshot rows.
 *
 * The outbox's `UNIQUE (watch_id, transition, revision)` is the dedup gate upstream; here we provide
 * at-least-once delivery — a transient send failure leaves the row `attempting` for the next sweep.
 */

const PUSH_TTL_FLOOR_SECONDS = 60; // never let a catch expire instantly
const PUSH_TTL_CEILING_SECONDS = 6 * 60 * 60; // a stale 6h-old catch is worthless; let it expire
const RESCHEDULE_SLOT_MINUTES = 15; // round a recommended new time up to a tidy quarter-hour

/** A normalized outbox row the planner reasons over (projection of `fired_transitions` + its watch). */
export interface OutboxRow {
  watchId: string;
  transition: string;
  revision: string;
  kind: FiredKind;
  /** Minutes of usable lead the engine recorded (CATCH only); sizes the push TTL. */
  leadTimeMinutes: number | null;
}

/** The watch + latest-snapshot facts needed to render the advice (joined in the shell). */
export interface DispatchContext {
  flightNumber: string;
  placeLabel: string;
  reschedulable: boolean;
  contact: string | null;
  /** IANA zone for local-time rendering in the message. */
  zone: string;
  /** Resolved commitment instant (UTC ISO) — the deadline before margin. */
  commitmentInstantUtc: string;
  /** Absolute URL the catch notification opens (the dashboard for this watch). */
  dashboardUrl: string;
  /** Latest prediction snapshot fields (null when no snapshot exists yet). */
  predictedArrivalUtc: string | null;
  transitMinutesUsed: number;
  egressMinutesUsed: number;
  marginMinutesUsed: number;
}

/** A stored push subscription (one device credential). */
export interface StoredSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The JSON payload the service worker receives for a catch. */
export interface CatchPushPayload {
  type: "catch";
  title: string;
  body: string;
  data: { watchId: string; url: string };
}

/**
 * The planner's verdict for one outbox row:
 *  - `send`: deliver `payload` to `subscription` with this TTL; on success mark `sent`.
 *  - `no_device`: no usable subscription — record `no_device`, send nothing.
 */
export type SendPlan =
  | {
      action: "send";
      subscription: StoredSubscription;
      payload: CatchPushPayload;
      ttlSeconds: number;
      message: CatchMessage;
    }
  | { action: "no_device" };

/** Round a UTC instant up to the next RESCHEDULE_SLOT_MINUTES boundary (a tidy time to suggest). */
function ceilToSlot(utcIso: string): string {
  const dt = DateTime.fromISO(utcIso, { zone: "utc" });
  const ms = RESCHEDULE_SLOT_MINUTES * 60_000;
  const rounded = Math.ceil(dt.toMillis() / ms) * ms;
  return DateTime.fromMillis(rounded, { zone: "utc" }).toISO() as string;
}

/**
 * PURE: reconstruct the {@link StructuredAdvice} the catch template renders, from a fired transition
 * and the latest snapshot facts. The snapshot persists the predicted arrival + the durations used,
 * so we recompute the projected arrival-at-place (predicted + transit + egress) rather than re-store
 * it. For a reschedulable CATCH we recommend pushing the commitment to the next quarter-hour after
 * the projected arrival — a realistic slot the traveler could actually make.
 */
export function buildAdvice(row: OutboxRow, ctx: DispatchContext): StructuredAdvice {
  const newArrivalUtc = ctx.predictedArrivalUtc;

  // Projected arrival at the place = flight arrival + airport egress + transit. Null pre-data.
  const projectedAtPlaceUtc =
    newArrivalUtc === null
      ? null
      : (DateTime.fromISO(newArrivalUtc, { zone: "utc" })
          .plus({ minutes: ctx.egressMinutesUsed + ctx.transitMinutesUsed })
          .toISO() as string);

  // Only a reschedulable CATCH carries a recommended new time; everyone else leaves it null.
  const recommendedNewTimeUtc =
    row.kind === "CATCH" && ctx.reschedulable && projectedAtPlaceUtc !== null
      ? ceilToSlot(projectedAtPlaceUtc)
      : null;

  return {
    kind: row.kind,
    flightNumber: ctx.flightNumber,
    newArrivalUtc,
    projectedAtPlaceUtc,
    placeLabel: ctx.placeLabel,
    reschedulable: ctx.reschedulable,
    recommendedNewTimeUtc,
    contact: ctx.contact,
    zone: ctx.zone,
  };
}

/**
 * PURE: size the push TTL from the catch lead time. A short-lead catch must out-live a brief device
 * offline window but is useless once the moment passes; clamp into [floor, ceiling]. Non-CATCH kinds
 * (ALL_CLEAR, etc.) use the ceiling — they're informational and fine to deliver late.
 */
export function ttlForRow(row: OutboxRow): number {
  if (row.kind !== "CATCH" || row.leadTimeMinutes === null) {
    return PUSH_TTL_CEILING_SECONDS;
  }
  const leadSeconds = Math.round(row.leadTimeMinutes * 60);
  return Math.min(PUSH_TTL_CEILING_SECONDS, Math.max(PUSH_TTL_FLOOR_SECONDS, leadSeconds));
}

/**
 * PURE: decide the send for one outbox row given its rendered message and the device's subscription
 * (or null if the device has none registered). No IO — the shell performs the actual web-push call
 * and the status write based on this plan.
 */
export function planSend(
  row: OutboxRow,
  ctx: DispatchContext,
  message: CatchMessage,
  subscription: StoredSubscription | null,
): SendPlan {
  if (subscription === null) {
    return { action: "no_device" };
  }
  const payload: CatchPushPayload = {
    type: "catch",
    title: message.title,
    body: message.body,
    data: { watchId: row.watchId, url: ctx.dashboardUrl },
  };
  return {
    action: "send",
    subscription,
    payload,
    ttlSeconds: ttlForRow(row),
    message,
  };
}

/**
 * The disposition of a failed send (PURE classification of a web-push error):
 *  - `prune`:  the endpoint is permanently dead (404/410) — record `failed` AND delete the dead
 *              subscription credential. The push service has retired it; retrying can never succeed.
 *  - `retry`:  the failure is TRANSIENT — return the row to `attempting` so the next sweep retries
 *              (at-least-once). Covers a network/timeout error (no statusCode), 408 Request Timeout,
 *              429 Too Many Requests, and any 5xx (the push service itself faltered).
 *  - `failed`: a permanent, non-prune client error (other 4xx, e.g. 400/401/403/413) — record
 *              `failed` and stop. Retrying an unauthorized/oversized/malformed request is futile, but
 *              the credential isn't proven dead, so we don't prune it.
 */
export type SendDisposition = "prune" | "retry" | "failed";

/**
 * PURE: classify a web-push error into a {@link SendDisposition}. `statusCode` is the HTTP status the
 * push service returned, or `undefined` for a transport-level failure (DNS/TLS/timeout) that never
 * reached a response — those are treated as retryable.
 */
export function classifySendError(statusCode: number | undefined): SendDisposition {
  if (statusCode === 404 || statusCode === 410) {
    return "prune";
  }
  // No response at all (timeout/network), an explicit timeout, throttling, or a server-side 5xx are
  // all worth another sweep. Everything else (the remaining 4xx) is a permanent client error.
  if (statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return "retry";
  }
  return "failed";
}

// ------------------------------------------------------------------------------------------------
// IO shell — DB + web-push. Kept deliberately thin; the decisions above are all pure.
// ------------------------------------------------------------------------------------------------

// Cap a single push send so a hung push service can't block the serial dispatch loop (and the cron
// invocation) indefinitely. A timed-out send throws and is classified as transient (left attempting).
const SEND_TIMEOUT_MS = 10_000;

let vapidConfigured = false;

/**
 * Configure web-push with the server VAPID identity, once. Throws if the env split is incomplete so
 * a misconfigured deploy fails loudly here rather than silently never delivering. The private key is
 * SERVER-ONLY and never leaves this module.
 */
function ensureVapid(): void {
  if (vapidConfigured) {
    return;
  }
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "VAPID env incomplete: set VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (server-only).",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

const DASHBOARD_PATH = (watchId: string): string => `/dashboard?id=${encodeURIComponent(watchId)}`;

/**
 * Build the absolute dashboard URL a catch notification opens. `NEXT_PUBLIC_APP_URL` is the public
 * origin; like {@link ensureVapid}, a production deploy that forgot to set it FAILS LOUD here rather
 * than silently shipping a relative `url` a push client can't open. In dev we tolerate the unset var
 * and fall back to the relative path so local runs aren't blocked on configuring an origin.
 */
function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (base) {
    return `${base.replace(/\/+$/, "")}${path}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set: push notifications need an absolute base URL for their deep-links in production.",
    );
  }
  return path;
}

/**
 * A short, stable dedup key (web-push `Topic` header) for one firing. The push service collapses any
 * queued message carrying the same Topic for the same subscription to the newest — a belt-and-braces
 * guard if a duplicate ever slips past the outbox's unique constraint. sha256 of the firing identity,
 * base64url, truncated to web-push's 32-char Topic ceiling (URL/filename-safe base64 only).
 */
function dedupeTopic(watchId: string, transition: string, revision: string): string {
  return createHash("sha256")
    .update(`${watchId}:${transition}:${revision}`)
    .digest("base64url")
    .slice(0, 32);
}

// How long a row may sit in `sending` before a sweep assumes the dispatcher that claimed it died and
// reclaims it to `attempting`. INVARIANT: this must exceed the whole batch's worst-case wall-clock,
// not just one send — `claimed_at` is stamped once for the whole claimed batch, and the loop sends
// SERIALLY, so a late row in a `limit`-sized batch isn't even sent until ~`limit` × SEND_TIMEOUT_MS
// after the claim. If the TTL were shorter, an overlapping tick could reclaim+re-send a row a live
// tick still owns (duplicate notification). 15 min > 50 × 10s = 8.3 min, with margin.
const STUCK_SENDING_TTL_MINUTES = 15;

export interface DispatchSummary {
  /** Rows leased this sweep (moved `attempting` -> `sending`). */
  claimed: number;
  sent: number;
  /** Permanently failed (404/410 prune, or a non-retryable 4xx). */
  failed: number;
  /** Transient failures returned to `attempting` for the next sweep (at-least-once). */
  deferred: number;
  noDevice: number;
  pruned: number;
  /** Stranded `sending` rows from a crashed prior tick that this sweep returned to `attempting`. */
  reclaimed: number;
}

/** Map a claimed (joined) outbox row to the pure planner's inputs + the device subscription. */
function mapClaimedRow(r: ClaimedOutboxRow): {
  outbox: OutboxRow;
  ctx: DispatchContext;
  subscription: StoredSubscription | null;
} {
  const outbox: OutboxRow = {
    watchId: r.watch_id,
    transition: r.transition,
    revision: r.revision,
    kind: r.kind,
    leadTimeMinutes: r.lead_time_minutes,
  };
  const ctx: DispatchContext = {
    flightNumber: r.flight_number,
    placeLabel: r.place_label,
    reschedulable: r.reschedulable,
    contact: r.contact,
    zone: r.commitment_zone,
    commitmentInstantUtc: r.commitment_instant.toISOString(),
    dashboardUrl: absoluteUrl(DASHBOARD_PATH(r.watch_id)),
    predictedArrivalUtc: r.predicted_arrival ? r.predicted_arrival.toISOString() : null,
    transitMinutesUsed: r.transit_minutes_used ?? 0,
    egressMinutesUsed: r.egress_minutes_used ?? 0,
    marginMinutesUsed: r.margin_minutes_used ?? 0,
  };
  // The newest subscription rides along on the claim's lateral join (no per-row query). A device
  // with none registered has null sub columns -> no_device.
  const subscription: StoredSubscription | null =
    r.sub_id !== null && r.sub_endpoint !== null && r.sub_p256dh !== null && r.sub_auth !== null
      ? { id: r.sub_id, endpoint: r.sub_endpoint, p256dh: r.sub_p256dh, auth: r.sub_auth }
      : null;
  return { outbox, ctx, subscription };
}

/**
 * Drain the outbox at-least-once and exactly-once-per-tick:
 *  1. reclaim any `sending` rows a crashed prior tick stranded (crash recovery);
 *  2. ATOMICALLY claim up to `limit` of the oldest `attempting` rows to `sending` (the claim is the
 *     concurrency gate — two overlapping cron ticks partition the backlog via FOR UPDATE SKIP LOCKED,
 *     so a given firing is sent by exactly one tick, never double-sent);
 *  3. for each claimed row: render its catch, send it to the device's newest subscription (which
 *     rode along on the claim — no per-row query), and SETTLE the lease — `sent` on success, back to
 *     `attempting` on a transient failure (retry next sweep), `failed` on a permanent error, and a
 *     dead 404/410 endpoint additionally prunes the subscription.
 * `limit` bounds one sweep so a backlog can't run unbounded inside a single cron tick.
 */
export async function dispatchOutbox(limit = 50): Promise<DispatchSummary> {
  ensureVapid();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    noDevice: 0,
    pruned: 0,
    reclaimed: 0,
  };

  summary.reclaimed = await reclaimStuckSending(STUCK_SENDING_TTL_MINUTES);

  const rows = await claimFiredTransitions(limit);
  summary.claimed = rows.length;

  for (const r of rows) {
    const { outbox, ctx, subscription } = mapClaimedRow(r);
    const advice = buildAdvice(outbox, ctx);
    const message = renderCatch(advice);
    const plan = planSend(outbox, ctx, message, subscription);

    if (plan.action === "no_device") {
      await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, "no_device");
      summary.noDevice += 1;
      continue;
    }

    const result = await sendOne(plan, outbox);
    if (result.delivered) {
      await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, "sent");
      summary.sent += 1;
      continue;
    }
    if (result.disposition === "retry") {
      // Transient — return the lease to `attempting`; do NOT record a terminal status. Next sweep retries.
      await requeueFiredTransition(outbox.watchId, outbox.transition, outbox.revision);
      summary.deferred += 1;
      continue;
    }
    // Permanent: record failed, and prune a dead (404/410) endpoint.
    await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, "failed");
    summary.failed += 1;
    if (result.disposition === "prune") {
      await pruneSubscription(plan.subscription.id);
      summary.pruned += 1;
    }
  }

  return summary;
}

type SendResult = { delivered: true } | { delivered: false; disposition: SendDisposition };

/**
 * Thin web-push call for one planned send. Never throws — failures become a typed {@link SendResult}
 * carrying the {@link SendDisposition} (retry / failed / prune). A stable per-firing `Topic` lets the
 * push service collapse any duplicate that slipped past the outbox's unique constraint.
 */
async function sendOne(
  plan: Extract<SendPlan, { action: "send" }>,
  row: OutboxRow,
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      {
        endpoint: plan.subscription.endpoint,
        keys: { p256dh: plan.subscription.p256dh, auth: plan.subscription.auth },
      },
      JSON.stringify(plan.payload),
      {
        TTL: plan.ttlSeconds,
        urgency: "high",
        timeout: SEND_TIMEOUT_MS,
        topic: dedupeTopic(row.watchId, row.transition, row.revision),
      },
    );
    return { delivered: true };
  } catch (err) {
    const statusCode = err instanceof WebPushError ? err.statusCode : undefined;
    return { delivered: false, disposition: classifySendError(statusCode) };
  }
}

/** Delete a retired (404/410) subscription. NEVER touches calibration rows — credentials only. */
async function pruneSubscription(id: number): Promise<void> {
  const sql = db();
  await sql`DELETE FROM push_subscriptions WHERE id = ${id}`;
}
