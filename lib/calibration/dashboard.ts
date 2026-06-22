/**
 * U10 dashboard view-model (R16, R22). The in-app mirror and reliability backstop for best-effort
 * push: it renders ONE watch's full lifecycle from the same corpus the engine writes to, so a
 * traveler who never received (or dismissed) a push can still see exactly where they stand.
 *
 * Architecture: a PURE builder (buildWatchView) that owns every mapping/derivation so the shaping
 * is exhaustively unit-tested without a database, plus a thin loadWatchForView IO that pulls the
 * four corpus tables via db(). No metric semantics live here — those are owned by metrics.ts.
 */
import { db } from "@/lib/db";
import {
  DELIVERY_STATUSES,
  ENRICHMENT_STATES,
  OUTCOMES,
  SELF_REPORT_STATUSES,
} from "@/lib/calibration/types";
import type {
  CalibrationRow,
  DeliveryStatus,
  EnrichmentState,
  Outcome,
  PredictionSnapshot,
  SelfReportStatus,
} from "@/lib/calibration/types";
import { FIRED_KINDS, VERDICTS, WATCH_STATES } from "@/lib/engine/types";
import type { FiredKind, Verdict, WatchState } from "@/lib/engine/types";

/** The watch fields the dashboard renders. A DB-shaped projection (one watches row, coerced). */
export interface WatchViewRow {
  id: string;
  state: WatchState;
  placeLabel: string;
  commitmentZone: string;
  commitmentInstantUtc: string;
  transitMinutes: number;
  transitSource: "osrm" | "manual_buffer";
  reschedulable: boolean;
  flightNumber: string;
  arrivalAirport: string | null;
  placeResolved: boolean;
  lastFetchedAt: string | null;
}

/** One entry in the prediction-snapshot timeline (newest first), shaped for display. */
export interface TimelineEntry {
  fetchedAt: string;
  verdict: Verdict;
  slackMinutes: number | null;
  predictedArrivalUtc: string | null;
  resultingState: WatchState;
  firedTransition: FiredKind | null;
  revision: string;
}

/** One entry in the catch history (a fired transition + its delivery outcome). */
export interface CatchHistoryEntry {
  kind: FiredKind;
  transition: string;
  deliveryStatus: DeliveryStatus;
  leadTimeMinutes: number | null;
  usefulLead: boolean | null;
  firedAt: string | null;
  revision: string;
}

/** The sealed/in-flight outcome strip (the self-report + actual-arrival enrichment). */
export interface OutcomeView {
  enrichmentState: EnrichmentState;
  sealed: boolean;
  selfReportStatus: SelfReportStatus;
  outcome: Outcome | null;
  wasUseful: boolean | null;
  actualArrivalUtc: string | null;
  divertedToAirport: string | null;
}

/** The complete, render-ready view model for one watch's lifecycle. */
export interface WatchView {
  id: string;
  state: WatchState;
  placeLabel: string;
  zone: string;
  commitmentInstantUtc: string;
  flightNumber: string;
  arrivalAirport: string | null;
  transitMinutes: number;
  transitSource: "osrm" | "manual_buffer";
  reschedulable: boolean;
  placeResolved: boolean;
  lastFetchedAt: string | null;
  /** Newest-first prediction snapshots. */
  timeline: TimelineEntry[];
  /** Newest-first fired transitions with delivery status — the reliability backstop, shown first. */
  catchHistory: CatchHistoryEntry[];
  outcome: OutcomeView | null;
}

/**
 * Pure view-model builder. Maps the corpus rows for one watch into a render-ready shape:
 * the current state + resolved place/zone/transit, the snapshot timeline, the catch history with
 * delivery status + lead, and the outcome strip. Sealed vs. pending is read straight off the
 * calibration row (sealed === enrichment_state "sealed"); an absent calibration row yields a null
 * outcome (a watch armed before enrichment). The snapshot/fired inputs may arrive in any order —
 * both are sorted newest-first here so callers never depend on the query's ORDER BY.
 */
export function buildWatchView(
  watch: WatchViewRow,
  snapshots: PredictionSnapshot[],
  firedRows: CatchHistoryEntry[],
  calibration: CalibrationRow | null,
): WatchView {
  const timeline: TimelineEntry[] = snapshots
    .map((s) => ({
      fetchedAt: s.fetchedAt,
      verdict: s.verdict,
      slackMinutes: s.slackMinutes,
      predictedArrivalUtc: s.predictedArrivalUtc,
      resultingState: s.resultingState,
      firedTransition: s.firedTransition,
      revision: s.revision,
    }))
    .sort((a, b) => descByIso(a.fetchedAt, b.fetchedAt));

  const catchHistory: CatchHistoryEntry[] = [...firedRows].sort((a, b) =>
    descByIso(a.firedAt, b.firedAt),
  );

  const outcome: OutcomeView | null = calibration
    ? {
        enrichmentState: calibration.enrichmentState,
        sealed: calibration.enrichmentState === "sealed",
        selfReportStatus: calibration.selfReportStatus,
        outcome: calibration.outcome,
        wasUseful: calibration.wasUseful,
        actualArrivalUtc: calibration.actualArrivalUtc,
        divertedToAirport: calibration.divertedToAirport,
      }
    : null;

  return {
    id: watch.id,
    state: watch.state,
    placeLabel: watch.placeLabel,
    zone: watch.commitmentZone,
    commitmentInstantUtc: watch.commitmentInstantUtc,
    flightNumber: watch.flightNumber,
    arrivalAirport: watch.arrivalAirport,
    transitMinutes: watch.transitMinutes,
    transitSource: watch.transitSource,
    reschedulable: watch.reschedulable,
    placeResolved: watch.placeResolved,
    lastFetchedAt: watch.lastFetchedAt,
    timeline,
    catchHistory,
    outcome,
  };
}

/** Descending sort by ISO instant. A null/empty instant sorts last (unknown firing time). */
function descByIso(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

/** The result of a capability-gated load: the rows for the page, or a typed miss. */
export type LoadWatchResult =
  | { status: "ok"; watch: WatchViewRow; snapshots: PredictionSnapshot[]; firedRows: CatchHistoryEntry[]; calibration: CalibrationRow | null }
  | { status: "not_found" };

/**
 * Thin IO: load one watch plus its prediction_snapshots, fired_transitions, and calibration row via
 * db(), for an ALREADY-AUTHORIZED id. The capability gate no longer lives here — the page verifies the
 * presented token through the shared watch gate (lib/security/watchGate) BEFORE calling this, so this
 * function never reads the token or the owner hash. That keeps the security boundary in one place and
 * the calibration module purely a view loader. Kept deliberately small; all shaping/derivation is in
 * buildWatchView. Not unit-tested (no DB in CI); exercised through the live page.
 */
export async function loadWatchForView(id: string): Promise<LoadWatchResult> {
  const sql = db();

  const watchRows = await sql`
    SELECT id, state, place_label, commitment_zone, commitment_instant,
           transit_minutes, transit_source, reschedulable, flight_number, arrival_airport,
           place_resolved, last_fetched_at
    FROM watches WHERE id = ${id}`;
  if (watchRows.length === 0) return { status: "not_found" };

  const w = watchRows[0];

  const [snapRows, firedRowsRaw, calibRows] = await Promise.all([
    sql`
      SELECT fetched_at, predicted_arrival, transit_minutes_used, egress_minutes_used,
             margin_minutes_used, slack_minutes, verdict, resulting_state, revision, fired_transition
      FROM prediction_snapshots WHERE watch_id = ${id} ORDER BY fetched_at DESC`,
    sql`
      SELECT transition, revision, kind, lead_time_minutes, useful_lead, delivery_status, sent_at
      FROM fired_transitions WHERE watch_id = ${id} ORDER BY created_at DESC`,
    sql`
      SELECT watch_id, actual_arrival, diverted_to_airport, self_report_status, outcome,
             was_useful, enrichment_state
      FROM calibration WHERE watch_id = ${id}`,
  ]);

  // DB boundary: coerce the untyped driver rows into the typed projections the pure builder expects.
  // This is the only place coercion is allowed; the builder owns all semantics. Enum columns go
  // through `narrow` (not a bare `as` cast) so a drifted/renamed value fails loud here rather than
  // slipping through as a bogus union member and surfacing as an unhandled case deep in the UI.
  const watch: WatchViewRow = {
    id: String(w.id),
    state: narrow(w.state, WATCH_STATES, "watches.state"),
    placeLabel: String(w.place_label),
    commitmentZone: String(w.commitment_zone),
    commitmentInstantUtc: toIso(w.commitment_instant),
    transitMinutes: Number(w.transit_minutes),
    transitSource: narrow(w.transit_source, TRANSIT_SOURCES, "watches.transit_source"),
    reschedulable: Boolean(w.reschedulable),
    flightNumber: String(w.flight_number),
    arrivalAirport: w.arrival_airport === null ? null : String(w.arrival_airport),
    placeResolved: Boolean(w.place_resolved),
    lastFetchedAt: w.last_fetched_at === null ? null : toIso(w.last_fetched_at),
  };

  const snapshots: PredictionSnapshot[] = snapRows.map((r) => ({
    watchId: id,
    fetchedAt: toIso(r.fetched_at),
    predictedArrivalUtc: r.predicted_arrival === null ? null : toIso(r.predicted_arrival),
    transitMinutesUsed: Number(r.transit_minutes_used),
    egressMinutesUsed: Number(r.egress_minutes_used),
    marginMinutesUsed: Number(r.margin_minutes_used),
    slackMinutes: r.slack_minutes === null ? null : Number(r.slack_minutes),
    verdict: narrow(r.verdict, VERDICTS, "prediction_snapshots.verdict"),
    resultingState: narrow(r.resulting_state, WATCH_STATES, "prediction_snapshots.resulting_state"),
    revision: String(r.revision),
    firedTransition:
      r.fired_transition === null
        ? null
        : narrow(r.fired_transition, FIRED_KINDS, "prediction_snapshots.fired_transition"),
  }));

  const firedRows: CatchHistoryEntry[] = firedRowsRaw.map((r) => ({
    kind: narrow(r.kind, FIRED_KINDS, "fired_transitions.kind"),
    transition: String(r.transition),
    deliveryStatus: narrow(r.delivery_status, DELIVERY_STATUSES, "fired_transitions.delivery_status"),
    leadTimeMinutes: r.lead_time_minutes === null ? null : Number(r.lead_time_minutes),
    usefulLead: r.useful_lead === null ? null : Boolean(r.useful_lead),
    firedAt: r.sent_at === null ? null : toIso(r.sent_at),
    revision: String(r.revision),
  }));

  const calibration: CalibrationRow | null =
    calibRows.length === 0
      ? null
      : {
          watchId: id,
          actualArrivalUtc: calibRows[0].actual_arrival === null ? null : toIso(calibRows[0].actual_arrival),
          divertedToAirport:
            calibRows[0].diverted_to_airport === null ? null : String(calibRows[0].diverted_to_airport),
          selfReportStatus: narrow(
            calibRows[0].self_report_status,
            SELF_REPORT_STATUSES,
            "calibration.self_report_status",
          ),
          outcome:
            calibRows[0].outcome === null ? null : narrow(calibRows[0].outcome, OUTCOMES, "calibration.outcome"),
          wasUseful: calibRows[0].was_useful === null ? null : Boolean(calibRows[0].was_useful),
          enrichmentState: narrow(calibRows[0].enrichment_state, ENRICHMENT_STATES, "calibration.enrichment_state"),
        };

  return {
    status: "ok",
    watch,
    snapshots,
    firedRows,
    calibration,
  };
}

/** One row in the authenticated dashboard's watch sidebar (newest commitment first, active first). */
export interface WatchSummary {
  id: string;
  flightNumber: string;
  placeLabel: string;
  state: WatchState;
  commitmentInstantUtc: string;
  commitmentZone: string;
  terminal: boolean;
}

/**
 * Account-scoped list of a user's watches for the multi-watch dashboard sidebar. Ownership IS the
 * gate here: the WHERE user_id clause means a caller only ever sees their own rows, so the page can
 * trust any id returned by this loader as authorized (no second per-watch token check needed for the
 * owner path). Active watches sort before terminal ones, then by soonest commitment.
 */
export async function loadWatchesForUser(userId: string): Promise<WatchSummary[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, flight_number, place_label, state, commitment_instant, commitment_zone, terminal
    FROM watches WHERE user_id = ${userId}
    ORDER BY terminal ASC, commitment_instant ASC`;
  return rows.map((r) => ({
    id: String(r.id),
    flightNumber: String(r.flight_number),
    placeLabel: String(r.place_label),
    state: narrow(r.state, WATCH_STATES, "watches.state"),
    commitmentInstantUtc: toIso(r.commitment_instant),
    commitmentZone: String(r.commitment_zone),
    terminal: Boolean(r.terminal),
  }));
}

/** Normalize a driver timestamp (Date | string) to a UTC ISO string for the contract boundary. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * One row in the account-scoped Alerts feed: a fired transition joined to its watch, across ALL of a
 * user's watches (the cross-watch counterpart to the single-watch catchHistory). Render-ready
 * camelCase; sentAt is null until the dispatcher settles the row to 'sent'. usefulLead is the
 * engine's own lead-bearing flag (null for non-CATCH kinds), distinct from the owner's later
 * "was this useful" self-report which lives on the calibration row.
 */
export interface AlertFeedEntry {
  watchId: string;
  flightNumber: string;
  placeLabel: string;
  kind: FiredKind;
  transition: string;
  leadTimeMinutes: number | null;
  usefulLead: boolean | null;
  deliveryStatus: DeliveryStatus;
  sentAt: string | null;
  createdAt: string;
}

/**
 * Pure DB-boundary mapper for one Alerts-feed row. Coerces the untyped driver row from the
 * ft -> watches join into the typed AlertFeedEntry, narrowing the two enum columns (kind,
 * delivery_status) so a drifted value fails loud here rather than surfacing deep in the feed UI.
 * Extracted (mirrors metrics' computeMetricsFromInput) so the mapping is unit-tested without a DB;
 * loadAlertsForUser is the thin live path over it.
 */
export function mapAlertRow(r: Record<string, unknown>): AlertFeedEntry {
  return {
    watchId: String(r.watch_id),
    flightNumber: String(r.flight_number),
    placeLabel: String(r.place_label),
    kind: narrow(r.kind, FIRED_KINDS, "fired_transitions.kind"),
    transition: String(r.transition),
    leadTimeMinutes: r.lead_time_minutes === null ? null : Number(r.lead_time_minutes),
    usefulLead: r.useful_lead === null ? null : Boolean(r.useful_lead),
    deliveryStatus: narrow(r.delivery_status, DELIVERY_STATUSES, "fired_transitions.delivery_status"),
    sentAt: r.sent_at === null ? null : toIso(r.sent_at),
    createdAt: toIso(r.created_at),
  };
}

/**
 * Account-scoped Alerts feed: every fired transition across a user's watches, newest first (cap 100).
 * The cross-watch counterpart to loadWatchForView's per-watch catchHistory — ownership IS the gate
 * (the WHERE w.user_id clause means a caller only ever sees their own firings). Thin IO over the pure
 * mapAlertRow; not unit-tested (no DB in CI), exercised through the live feed.
 */
export async function loadAlertsForUser(userId: string): Promise<AlertFeedEntry[]> {
  const sql = db();
  const rows = await sql`
    SELECT ft.kind, ft.transition, ft.lead_time_minutes, ft.useful_lead, ft.delivery_status,
           ft.sent_at, ft.created_at,
           w.id AS watch_id, w.flight_number, w.place_label
    FROM fired_transitions ft
    JOIN watches w ON w.id = ft.watch_id
    WHERE w.user_id = ${userId}
    ORDER BY ft.created_at DESC
    LIMIT 100`;
  return rows.map(mapAlertRow);
}

/** Transit-source values for the inline `"osrm" | "manual_buffer"` literal (no named type to reuse). */
const TRANSIT_SOURCES = ["osrm", "manual_buffer"] as const;

/**
 * DB-boundary narrowing. Coerce one untyped driver value to a known string-literal union, FAILING
 * LOUD when it isn't a member. A bare `String(x) as WatchState` lies to the compiler: a renamed or
 * typo'd enum value (code/schema drift) sails through as a bogus union member and only blows up later
 * as an unhandled `default` deep in a render path. Checking membership at the one place coercion is
 * allowed turns that silent drift into a clear, sourced error. `allowed` is the very `as const` array
 * each union is derived from, so the runtime check can never diverge from the type it guards.
 */
export function narrow<T extends string>(value: unknown, allowed: readonly T[], column: string): T {
  const s = String(value);
  if ((allowed as readonly string[]).includes(s)) return s as T;
  throw new Error(
    `DB boundary: unexpected value ${JSON.stringify(s)} in "${column}"; expected one of [${allowed.join(", ")}].`,
  );
}
