import { unstable_cache } from "next/cache";
import { fetchFlight, resolveProvider } from "@/lib/adapters/flight";
import { formatUtc } from "@/lib/format/time";
import type { AdapterResult } from "@/lib/adapters/result";
import type { FlightArrival, FlightStatus } from "@/lib/engine/types";
import type { OnboardingAnswers } from "@/lib/onboarding/actions";

/** A presentation-ready flight readout, or a reason we couldn't get one — never a silent blank. */
export type TripFlight =
  | { state: "none" }
  | { state: "unavailable"; reason: string; flightNo: string }
  | {
      state: "ok";
      flightNo: string;
      seat: string;
      status: FlightStatus;
      statusLabel: string;
      tone: "ok" | "warn" | "bad" | "muted";
      scheduledArrival: string | null;
      predictedArrival: string | null;
      actualArrival: string | null;
      arrivalAirport: string;
      delayMinutes: number | null;
      provider: string;
    };

const STATUS_META: Record<FlightStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  scheduled: { label: "Scheduled", tone: "muted" },
  active: { label: "In the air", tone: "ok" },
  landed: { label: "Landed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
  diverted: { label: "Diverted", tone: "bad" },
  unknown: { label: "Status unknown", tone: "muted" },
};

const diffMinutes = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const ms = new Date(a).getTime() - new Date(b).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 60000);
};

/**
 * Pure mapping from a provider result to the view model. Split out from the I/O so it is unit-testable
 * without mocking the network: status -> label/tone, the muted->warn promotion on a meaningful delay,
 * and the arrival-time formatting all live here.
 */
export function buildTripFlight(
  result: AdapterResult<FlightArrival>,
  flightNo: string,
  seat: string,
  provider: string,
): TripFlight {
  if (result.kind === "not_found") {
    return { state: "unavailable", reason: "We couldn’t find this flight with our provider yet.", flightNo };
  }
  if (result.kind === "rate_limited") {
    return { state: "unavailable", reason: "Live status is rate-limited right now — check back shortly.", flightNo };
  }
  if (result.kind === "error") {
    return { state: "unavailable", reason: "Live status is temporarily unavailable.", flightNo };
  }

  const a = result.data;
  const meta = STATUS_META[a.status];
  const delay = diffMinutes(a.predictedUtc, a.scheduledUtc) ?? diffMinutes(a.actualUtc, a.scheduledUtc);
  // A meaningful positive delay on an otherwise on-time status should still read as a warning.
  const tone = meta.tone === "muted" && delay !== null && delay >= 15 ? "warn" : meta.tone;

  return {
    state: "ok",
    flightNo,
    seat,
    status: a.status,
    statusLabel: meta.label,
    tone,
    scheduledArrival: a.scheduledUtc ? formatUtc(a.scheduledUtc, "datetime-24h") : null,
    predictedArrival: a.predictedUtc ? formatUtc(a.predictedUtc, "datetime-24h") : null,
    actualArrival: a.actualUtc ? formatUtc(a.actualUtc, "datetime-24h") : null,
    arrivalAirport: a.arrivalAirport,
    delayMinutes: delay,
    provider,
  };
}

// Cache the external provider call by (flightNo, date) so re-renders — and the router.refresh() that
// follows every attachment upload/delete — don't re-hit a rate-limited provider (AviationStack's free
// tier is 100 req/month). A 5-minute TTL keeps "live" status fresh enough while capping quota burn.
const cachedFetchFlight = unstable_cache(
  (flightNo: string, dateIso: string): Promise<AdapterResult<FlightArrival>> => fetchFlight(flightNo, dateIso),
  ["trip-flight"],
  { revalidate: 300 },
);

/**
 * Enrich a trip's booked flight with live status from the configured provider (the keyless simulator
 * in dev). Returns a discriminated view model so the UI surfaces every case — no booking, a provider
 * miss, or real data — rather than rendering an empty card. Server-only (the adapter holds keys).
 */
export async function loadTripFlight(answers: Partial<OnboardingAnswers>): Promise<TripFlight> {
  const flightNo = (answers.flightNo ?? "").trim();
  if (answers.flight !== "Booked" || !flightNo) return { state: "none" };

  const dateIso = (answers.flightDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const result = await cachedFetchFlight(flightNo.replace(/\s+/g, ""), dateIso);

  return buildTripFlight(result, flightNo, (answers.seat ?? "").trim(), resolveProvider());
}
