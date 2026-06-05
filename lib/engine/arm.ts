import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { fetchFlight } from "@/lib/adapters/flight";
import { geocodeAirport, resolvePlace } from "@/lib/adapters/osm";
import { mintToken, hashToken } from "@/lib/security/capability";
import { withinWatchCap, budgetOk } from "@/lib/security/ratelimit";
import { appendSnapshot } from "@/lib/calibration/writer";
import { detectCollision } from "./collision";
import { validateArm } from "./validation";
import { step } from "./state";
import { ENGINE } from "./constants";
import type { Commitment, FiredKind, WatchState } from "./types";

export interface ArmRequest {
  deviceId: string;
  flightNumber: string;
  flightDate: string; // YYYY-MM-DD (local departure date)
  placeQuery: string;
  commitmentLocal: string; // local wall-time, no offset
  reschedulable: boolean;
  marginMinutes?: number;
  contact?: string | null;
}

export interface ArmedWatch {
  watchId: string;
  token: string; // returned to the client ONCE
  state: WatchState;
  fired: FiredKind | null;
  placeLabel: string;
  zone: string;
  transitMinutes: number;
  slackMinutes: number | null;
  projectedAtPlaceUtc: string | null;
}

export type ArmResult = { ok: true; watch: ArmedWatch } | { ok: false; reason: string };

/**
 * Read the configured monthly budget threshold from env, or null when the breaker is DISABLED.
 *
 * `MONTHLY_BUDGET_UNITS` is the per-calendar-month ceiling on the spend proxy below. When it is
 * unset, non-numeric, or non-positive, the budget circuit-breaker is simply OFF (returns null) — we
 * do NOT fail closed and reject every arm; an unconfigured budget means "no budget enforced", not
 * "spend is zero". Only a positive value arms the gate.
 */
function monthlyBudgetThreshold(): number | null {
  const raw = process.env.MONTHLY_BUDGET_UNITS;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Month-to-date spend PROXY (thin DB IO): the number of watches created this calendar month.
 *
 * Each armed watch is the unit that drives recurring upstream polling spend, so "watches created
 * since the start of this month (server clock)" is a cheap, monotonic stand-in for upstream cost
 * until a real per-call meter exists. Counted off `created_at` (UTC `date_trunc('month', now())`),
 * so the window resets automatically at each month boundary. Reads only — never mutates.
 */
async function monthToDateSpend(): Promise<number> {
  const sql = db();
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM watches WHERE created_at >= date_trunc('month', now())`;
  return rows[0].n;
}

/**
 * Arm a watch: fetch the flight, resolve the place + transit, validate, compute the baseline
 * verdict, and persist {watch + calibration} atomically with an owner capability token (U5).
 * Adapter calls happen BEFORE the transaction so a flaky upstream can't leave a half-armed watch.
 */
export async function armWatch(req: ArmRequest, nowUtc: string): Promise<ArmResult> {
  // 0. Per-device active-watch cap (R24) — refuse BEFORE paying for any upstream lookup.
  const sql = db();
  const capRows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM watches WHERE device_id = ${req.deviceId} AND terminal = FALSE`;
  if (!withinWatchCap(capRows[0].n)) {
    return { ok: false, reason: "You've reached the maximum number of active watches on this device." };
  }

  // 0b. Monthly-spend circuit-breaker (R24) — also BEFORE any upstream lookup. ARM-ONLY: existing
  // watches keep reconciling regardless. Skipped entirely when no positive budget is configured (the
  // breaker is OFF), so an unset MONTHLY_BUDGET_UNITS never rejects arms.
  const budget = monthlyBudgetThreshold();
  if (budget !== null && !budgetOk(await monthToDateSpend(), budget)) {
    return { ok: false, reason: "We've hit this month's capacity. Please try again next month." };
  }

  // 1. Flight.
  const flightRes = await fetchFlight(req.flightNumber, req.flightDate);
  if (flightRes.kind === "not_found") return { ok: false, reason: "No flight found for that number and date." };
  if (flightRes.kind === "rate_limited") return { ok: false, reason: "Flight provider is busy — try again shortly." };
  if (flightRes.kind === "error") return { ok: false, reason: "Couldn't reach the flight provider." };
  const flight = flightRes.data;

  // 2. Arrival airport coordinates + place resolution (free, keyless OSM).
  const airport = await geocodeAirport(flight.arrivalAirport);
  if (!airport) return { ok: false, reason: `Couldn't locate arrival airport ${flight.arrivalAirport}.` };

  const placeRes = await resolvePlace(req.placeQuery, airport.lat, airport.lng);
  if (placeRes.kind !== "ok") return { ok: false, reason: "Couldn't resolve the destination right now." };
  const place = placeRes.data;
  if (!place.placeResolved || place.ianaZone === null) {
    return { ok: false, reason: `Couldn't pin down "${req.placeQuery}". Try a more specific address.` };
  }

  // 3. Commitment + validation (R17/R19).
  const commitment: Commitment = {
    localWallTime: req.commitmentLocal,
    ianaZone: place.ianaZone,
    marginMinutes: req.marginMinutes ?? ENGINE.defaultMarginMinutes,
    reschedulable: req.reschedulable,
  };
  const valid = validateArm(commitment, nowUtc, flight.scheduledUtc);
  if (!valid.ok) return { ok: false, reason: valid.reason };

  // 4. Baseline verdict.
  const predicted = flight.predictedUtc ?? flight.scheduledUtc;
  const collision = detectCollision({
    predictedArrivalUtc: predicted,
    egressMinutes: ENGINE.egressMinutes,
    transitMinutes: place.transitMinutes,
    commitment,
    nowUtc,
  });

  const landed = flight.status === "landed" || flight.actualUtc !== null;
  let state: WatchState;
  let fired: FiredKind | null = null;
  if (landed) {
    state = "LANDED_CAPTURE"; // already on the ground — outcome capture only
  } else {
    const s = step({
      current: "OK",
      verdict: collision.verdict,
      slackMinutes: collision.slackMinutes,
      flightStatus: flight.status,
      flightLanded: false,
      feedStale: false,
      commitmentPassed: false,
      recoveryProgress: 0,
    });
    state = s.next;
    fired = s.fired;
  }

  // 5. Persist {watch + calibration} atomically. Adapter work is already done.
  const id = randomUUID();
  const token = mintToken();
  const tokenHash = hashToken(token);
  const marginSource = req.marginMinutes === undefined ? "default" : "user";
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO watches
          (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
           commitment_local, commitment_zone, commitment_instant, place_label, place_lat, place_lng,
           place_resolved, margin_minutes, margin_source, egress_minutes, transit_minutes,
           transit_source, reschedulable, contact, state, revision, next_poll_at, last_fetched_at,
           terminal)
        VALUES
          (${id}, ${req.deviceId}, ${tokenHash}, ${req.flightNumber}, ${req.flightDate},
           ${flight.arrivalAirport}, ${req.commitmentLocal}, ${commitment.ianaZone},
           ${valid.commitmentInstantUtc}, ${place.label}, ${place.lat}, ${place.lng},
           ${place.placeResolved}, ${commitment.marginMinutes}, ${marginSource},
           ${ENGINE.egressMinutes}, ${place.transitMinutes}, ${place.transitSource},
           ${req.reschedulable}, ${req.contact ?? null}, ${state}, ${flight.revision},
           ${landed ? null : nowUtc}, ${nowUtc}, ${landed})`;
      await tx`INSERT INTO calibration (watch_id) VALUES (${id})`;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("watches_dedupe_active")) {
      return { ok: false, reason: "You're already watching this flight and commitment." };
    }
    return { ok: false, reason: "Couldn't save the watch." };
  }

  // 6. Baseline prediction snapshot (idempotent on watch+revision).
  await appendSnapshot({
    watchId: id,
    fetchedAt: nowUtc,
    predictedArrivalUtc: predicted,
    transitMinutesUsed: place.transitMinutes,
    egressMinutesUsed: ENGINE.egressMinutes,
    marginMinutesUsed: commitment.marginMinutes,
    slackMinutes: collision.slackMinutes,
    verdict: collision.verdict,
    resultingState: state,
    revision: flight.revision,
    firedTransition: fired,
  });

  return {
    ok: true,
    watch: {
      watchId: id,
      token,
      state,
      fired,
      placeLabel: place.label,
      zone: commitment.ianaZone,
      transitMinutes: place.transitMinutes,
      slackMinutes: collision.slackMinutes,
      projectedAtPlaceUtc: collision.projectedAtPlaceUtc,
    },
  };
}
