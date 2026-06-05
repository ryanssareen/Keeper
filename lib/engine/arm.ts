import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { fetchFlight } from "@/lib/adapters/aerodatabox";
import { geocodeAirport, resolvePlace } from "@/lib/adapters/osm";
import { mintToken, hashToken } from "@/lib/security/capability";
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
 * Arm a watch: fetch the flight, resolve the place + transit, validate, compute the baseline
 * verdict, and persist {watch + calibration} atomically with an owner capability token (U5).
 * Adapter calls happen BEFORE the transaction so a flaky upstream can't leave a half-armed watch.
 */
export async function armWatch(req: ArmRequest, nowUtc: string): Promise<ArmResult> {
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
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO watches
          (id, device_id, owner_token_hash, flight_number, flight_date, arrival_airport,
           commitment_local, commitment_zone, commitment_instant, place_label, place_lat, place_lng,
           place_resolved, margin_minutes, margin_source, egress_minutes, transit_minutes,
           transit_source, reschedulable, contact, state, revision, next_poll_at, last_fetched_at)
        VALUES
          (${id}, ${req.deviceId}, ${tokenHash}, ${req.flightNumber}, ${req.flightDate},
           ${flight.arrivalAirport}, ${req.commitmentLocal}, ${commitment.ianaZone},
           ${valid.commitmentInstantUtc}, ${place.label}, ${place.lat}, ${place.lng},
           ${place.placeResolved}, ${commitment.marginMinutes}, ${marginSource},
           ${ENGINE.egressMinutes}, ${place.transitMinutes}, ${place.transitSource},
           ${req.reschedulable}, ${req.contact ?? null}, ${state}, ${flight.revision}, now(), ${nowUtc})`;
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
