import { DateTime } from "luxon";
import webpush, { WebPushError } from "web-push";

import { db } from "@/lib/db";
import { recordDelivery } from "@/lib/calibration/writer";
import { renderCatch } from "@/lib/push/template";
import type { StructuredAdvice, CatchMessage } from "@/lib/push/types";
import type { DeliveryStatus } from "@/lib/calibration/types";
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
 * PURE: classify a web-push error into a delivery status + whether to prune the subscription.
 * 404 (Not Found) and 410 (Gone) mean the push service has permanently retired the endpoint, so the
 * credential is dead and must be deleted; any other failure is transient (mark `failed`, keep the
 * row + subscription for the next sweep).
 */
export function classifySendError(statusCode: number | undefined): {
  status: Extract<DeliveryStatus, "failed">;
  prune: boolean;
} {
  const prune = statusCode === 404 || statusCode === 410;
  return { status: "failed", prune };
}

// ------------------------------------------------------------------------------------------------
// IO shell — DB + web-push. Kept deliberately thin; the decisions above are all pure.
// ------------------------------------------------------------------------------------------------

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

function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return base ? `${base.replace(/\/+$/, "")}${path}` : path;
}

interface OutboxJoinRow {
  watch_id: string;
  transition: string;
  revision: string;
  kind: FiredKind;
  lead_time_minutes: number | null;
  device_id: string;
  flight_number: string;
  place_label: string;
  reschedulable: boolean;
  contact: string | null;
  commitment_zone: string;
  commitment_instant: Date;
  predicted_arrival: Date | null;
  transit_minutes_used: number | null;
  egress_minutes_used: number | null;
  margin_minutes_used: number | null;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  noDevice: number;
  pruned: number;
}

/**
 * Drain the outbox: for every `attempting` fired transition, render its catch, send it to the
 * owning device's subscription, and record the outcome. At-least-once — a transient failure is left
 * `attempting` for a later sweep; a permanent 404/410 prunes the dead subscription. `limit` bounds
 * one sweep so a backlog can't run unbounded inside a single cron tick.
 */
export async function dispatchOutbox(limit = 50): Promise<DispatchSummary> {
  ensureVapid();
  const sql = db();
  const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0, noDevice: 0, pruned: 0 };

  // Join the outbox to its watch and that watch's latest snapshot (predicted arrival + the durations
  // used at reconcile time). LEFT JOIN LATERAL keeps rows with no snapshot yet (advice degrades to
  // "running late" copy rather than vanishing). Oldest-first, matching the partial index.
  const rows = await sql<OutboxJoinRow[]>`
    SELECT ft.watch_id, ft.transition, ft.revision, ft.kind, ft.lead_time_minutes,
           w.device_id, w.flight_number, w.place_label, w.reschedulable, w.contact,
           w.commitment_zone, w.commitment_instant,
           s.predicted_arrival, s.transit_minutes_used, s.egress_minutes_used, s.margin_minutes_used
    FROM fired_transitions ft
    JOIN watches w ON w.id = ft.watch_id
    LEFT JOIN LATERAL (
      SELECT predicted_arrival, transit_minutes_used, egress_minutes_used, margin_minutes_used
      FROM prediction_snapshots
      WHERE watch_id = ft.watch_id
      ORDER BY fetched_at DESC
      LIMIT 1
    ) s ON TRUE
    WHERE ft.delivery_status = 'attempting'
    ORDER BY ft.created_at ASC
    LIMIT ${limit}`;

  summary.claimed = rows.length;

  for (const r of rows) {
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

    const advice = buildAdvice(outbox, ctx);
    const message = renderCatch(advice);

    // Find the device's freshest subscription (a device may have re-subscribed; newest wins).
    const subs = await sql<StoredSubscription[]>`
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE device_id = ${r.device_id}
      ORDER BY created_at DESC
      LIMIT 1`;
    const subscription: StoredSubscription | null = subs.length > 0 ? subs[0] : null;

    const plan = planSend(outbox, ctx, message, subscription);

    if (plan.action === "no_device") {
      await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, "no_device");
      summary.noDevice += 1;
      continue;
    }

    const status = await sendOne(plan);
    if (status.delivered) {
      await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, "sent");
      summary.sent += 1;
    } else {
      await recordDelivery(outbox.watchId, outbox.transition, outbox.revision, status.status);
      summary.failed += 1;
      if (status.prune) {
        await pruneSubscription(plan.subscription.id);
        summary.pruned += 1;
      }
    }
  }

  return summary;
}

type SendResult =
  | { delivered: true }
  | { delivered: false; status: Extract<DeliveryStatus, "failed">; prune: boolean };

/** Thin web-push call for one planned send. Never throws — failures become a typed SendResult. */
async function sendOne(plan: Extract<SendPlan, { action: "send" }>): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      {
        endpoint: plan.subscription.endpoint,
        keys: { p256dh: plan.subscription.p256dh, auth: plan.subscription.auth },
      },
      JSON.stringify(plan.payload),
      { TTL: plan.ttlSeconds, urgency: "high" },
    );
    return { delivered: true };
  } catch (err) {
    const statusCode = err instanceof WebPushError ? err.statusCode : undefined;
    const { status, prune } = classifySendError(statusCode);
    return { delivered: false, status, prune };
  }
}

/** Delete a retired (404/410) subscription. NEVER touches calibration rows — credentials only. */
async function pruneSubscription(id: number): Promise<void> {
  const sql = db();
  await sql`DELETE FROM push_subscriptions WHERE id = ${id}`;
}
