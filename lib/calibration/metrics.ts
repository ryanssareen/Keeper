/**
 * The four STRATEGY metrics (U10), pinned exactly and computed off a DB-free input view.
 *
 * Discipline: every rate is a numerator AND a denominator (never a bare percentage), so a low-n
 * sample reads as low-n rather than a misleading 0%/100%. Outcome accuracy is graded against the
 * traveler's self-report — never synthesized from the model's own egress/transit assumptions —
 * and indeterminate verdicts are excluded and counted, not silently scored.
 */
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import type { Metrics } from "@/lib/calibration/types";

/** Catch kinds that count as a cascade alert (the traveler is being warned). */
const CATCH_KIND = "CATCH";
/** A flight prediction is "correct" if it lands within this tolerance of the actual instant. */
const FLIGHT_ACCURACY_TOLERANCE_MINUTES = 15;

/**
 * A DB-free projection of the corpus rows the metrics need. The pure aggregator below operates on
 * this shape so the definitions are exhaustively unit-tested without a database.
 */
export interface MetricsInput {
  watches: { watchId: string; placeResolved: boolean; hasCommitmentTime: boolean }[];
  catches: {
    watchId: string;
    kind: string;
    firedAtUtc: string;
    deliveryStatus: string;
    usefulLead: boolean;
    wasUseful: boolean;
  }[];
  outcomes: {
    watchId: string;
    verdict: string;
    selfReportAnswered: boolean;
    selfReportOutcome: string | null;
    predictedArrivalUtc: string | null;
    actualArrivalUtc: string | null;
  }[];
}

/**
 * Pure aggregator: the single source of truth for what each metric *means*. Both the live
 * computeMetrics() path and the unit tests feed this, so the definitions can never drift apart.
 */
export function computeMetricsFromInput(input: MetricsInput): Metrics {
  const thesisExercisingTrips = input.watches.filter(
    (w) => w.placeResolved && w.hasCommitmentTime,
  ).length;

  // Cascade-alert usefulness: only CATCH events count; recovery/can't-confirm notices are excluded
  // so a useful warning is not diluted by all-clear chatter. Denominator is every CATCH fired.
  const catchEvents = input.catches.filter((c) => c.kind === CATCH_KIND);
  const cascadeAlertUsefulness = {
    numerator: catchEvents.filter((c) => c.usefulLead || c.wasUseful).length,
    denominator: catchEvents.length,
  };

  // First-useful-catch: per watch, did at least one CATCH actually go out (delivery sent) with
  // enough lead to act? Denominator is watches that had any CATCH fire — an undelivered or
  // below-lead catch counts toward the denominator but not the numerator.
  const watchesWithAnyCatch = new Set(catchEvents.map((c) => c.watchId));
  const watchesWithUsefulSentCatch = new Set(
    catchEvents.filter((c) => c.deliveryStatus === "sent" && c.usefulLead).map((c) => c.watchId),
  );
  const firstUsefulCatchRate = {
    numerator: watchesWithUsefulSentCatch.size,
    denominator: watchesWithAnyCatch.size,
  };

  // Flight-prediction accuracy: predicted vs actual arrival instant, independent of the model's own
  // assumptions. Only rows where both instants are known are gradable.
  const gradableFlightRows = input.outcomes.filter(
    (o) => o.predictedArrivalUtc !== null && o.actualArrivalUtc !== null,
  );
  const flightPredictionCorrect = gradableFlightRows.filter((o) => {
    const predicted = DateTime.fromISO(o.predictedArrivalUtc as string, { zone: "utc" });
    const actual = DateTime.fromISO(o.actualArrivalUtc as string, { zone: "utc" });
    const diffMinutes = Math.abs(actual.diff(predicted, "minutes").minutes);
    return diffMinutes <= FLIGHT_ACCURACY_TOLERANCE_MINUTES;
  }).length;

  // Outcome accuracy: predicted verdict vs the traveler's self-report, only over answered rows, and
  // only where the verdict was decisive (indeterminate is neither right nor wrong — it is excluded).
  const gradableOutcomeRows = input.outcomes.filter(
    (o) => o.selfReportAnswered && o.verdict !== "indeterminate",
  );
  const outcomeCorrect = gradableOutcomeRows.filter(
    (o) => (o.verdict === "miss") === (o.selfReportOutcome === "missed"),
  ).length;

  const indeterminateExcluded = input.outcomes.filter((o) => o.verdict === "indeterminate").length;

  return {
    thesisExercisingTrips,
    cascadeAlertUsefulness,
    firstUsefulCatchRate,
    predictionAccuracy: {
      flightPrediction: {
        numerator: flightPredictionCorrect,
        denominator: gradableFlightRows.length,
      },
      outcome: {
        numerator: outcomeCorrect,
        denominator: gradableOutcomeRows.length,
      },
      indeterminateExcluded,
    },
  };
}

/**
 * Live entry point: pull the corpus projection from the DB and hand it to the pure aggregator.
 * Thin and untested by design (no DB in CI); all metric semantics live in computeMetricsFromInput.
 * Metrics read sealed outcome rows only, so in-flight watches never skew the rates.
 */
export async function computeMetrics(): Promise<Metrics> {
  const sql = db();

  const [watchRows, catchRows, outcomeRows] = await Promise.all([
    sql`
      SELECT id AS "watchId",
             place_resolved AS "placeResolved",
             (commitment_instant IS NOT NULL) AS "hasCommitmentTime"
      FROM watches
    `,
    sql`
      SELECT ft.watch_id AS "watchId",
             ft.kind AS "kind",
             ft.sent_at AS "firedAtUtc",
             ft.delivery_status AS "deliveryStatus",
             COALESCE(ft.useful_lead, FALSE) AS "usefulLead",
             COALESCE(c.was_useful, FALSE) AS "wasUseful"
      FROM fired_transitions ft
      LEFT JOIN calibration c ON c.watch_id = ft.watch_id
    `,
    sql`
      SELECT c.watch_id AS "watchId",
             ps.verdict AS "verdict",
             (c.self_report_status = 'answered') AS "selfReportAnswered",
             c.outcome AS "selfReportOutcome",
             ps.predicted_arrival AS "predictedArrivalUtc",
             c.actual_arrival AS "actualArrivalUtc"
      FROM calibration c
      LEFT JOIN LATERAL (
        SELECT verdict, predicted_arrival
        FROM prediction_snapshots
        WHERE watch_id = c.watch_id
        ORDER BY fetched_at DESC
        LIMIT 1
      ) ps ON TRUE
      WHERE c.enrichment_state = 'sealed'
    `,
  ]);

  // Coerce the untyped driver rows into the input view at the DB boundary (the only place coercion
  // is allowed). The pure aggregator owns all semantics, so this stays thin and DB-shaped only.
  const input: MetricsInput = {
    watches: watchRows.map((r) => ({
      watchId: String(r.watchId),
      placeResolved: Boolean(r.placeResolved),
      hasCommitmentTime: Boolean(r.hasCommitmentTime),
    })),
    catches: catchRows.map((r) => ({
      watchId: String(r.watchId),
      kind: String(r.kind),
      firedAtUtc: r.firedAtUtc === null ? "" : String(r.firedAtUtc),
      deliveryStatus: String(r.deliveryStatus),
      usefulLead: Boolean(r.usefulLead),
      wasUseful: Boolean(r.wasUseful),
    })),
    outcomes: outcomeRows.map((r) => ({
      watchId: String(r.watchId),
      verdict: String(r.verdict),
      selfReportAnswered: Boolean(r.selfReportAnswered),
      selfReportOutcome: r.selfReportOutcome === null ? null : String(r.selfReportOutcome),
      predictedArrivalUtc: r.predictedArrivalUtc === null ? null : String(r.predictedArrivalUtc),
      actualArrivalUtc: r.actualArrivalUtc === null ? null : String(r.actualArrivalUtc),
    })),
  };

  return computeMetricsFromInput(input);
}
