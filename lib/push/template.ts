import { formatInZone } from "@/lib/format/time";
import type { StructuredAdvice, CatchMessage, RenderCatch } from "@/lib/push/types";

/**
 * Catch template (U8). PURE: StructuredAdvice -> CatchMessage.
 *
 * The engine computes the advice; push and the dashboard both render it through this one function,
 * so the catch text and its in-app mirror never drift. Every instant is rendered into the advice's
 * IANA zone (local wall-time at the place), never the server's clock, so the times read correctly
 * for the traveler.
 */

/** Render a UTC ISO instant into advice.zone local time, e.g. "8:30 PM". Empty string if null. */
function localTime(utcIso: string | null, zone: string): string {
  // Shared 12-hour formatter (lib/format/time): en-US h12 so AM/PM is stable, "" for a null instant.
  return formatInZone(utcIso, zone, "clock-12h");
}

export const renderCatch: RenderCatch = (advice: StructuredAdvice): CatchMessage => {
  const { kind, flightNumber, placeLabel } = advice;

  switch (kind) {
    case "ALL_CLEAR":
      return {
        title: `You're back on track for ${placeLabel}`,
        body: `Good news — flight ${flightNumber} is on schedule and you should reach ${placeLabel} in time. No action needed.`,
      };

    case "CANNOT_CONFIRM":
      return {
        title: `Can't confirm flight ${flightNumber} status`,
        body: `We've lost a reliable read on flight ${flightNumber}, so we can't confirm whether you'll make ${placeLabel}. Check your flight and ${placeLabel} directly.`,
      };

    case "CANCELLED":
      return {
        title: `Flight ${flightNumber} cancelled — you'll miss ${placeLabel}`,
        body: `Flight ${flightNumber} has been cancelled, so you won't make ${placeLabel} as planned. Check rebooking options and your ${placeLabel} cancellation window.`,
      };

    case "DEFINITE_MISS":
      return {
        title: `You'll miss ${placeLabel}`,
        body: `Flight ${flightNumber} is now too late for you to reach ${placeLabel} in time. Check your ${placeLabel} cancellation or exchange window.`,
      };

    case "CATCH":
    default:
      return renderCatchFiring(advice);
  }
};

/** The "CATCH" firing — splits on reschedulable; the only branch that recommends a new time. */
function renderCatchFiring(advice: StructuredAdvice): CatchMessage {
  const { flightNumber, placeLabel, zone, reschedulable } = advice;
  const newArrival = localTime(advice.newArrivalUtc, zone);
  const projected = localTime(advice.projectedAtPlaceUtc, zone);

  const title = `Heads up — you'll miss ${placeLabel}`;

  // "What broke": the flight is now later than planned.
  const arrivalClause =
    newArrival !== ""
      ? `Flight ${flightNumber} now arrives ~${newArrival}`
      : `Flight ${flightNumber} is running late`;

  // "What it means": when you'd actually reach the place.
  const projectedClause =
    projected !== "" ? `, so you'd reach ${placeLabel} ~${projected}` : `, so you'd reach ${placeLabel} late`;

  if (reschedulable) {
    const newTime = localTime(advice.recommendedNewTimeUtc, zone);
    const pushClause = newTime !== "" ? ` to push it to ~${newTime}` : " to push it later";
    // Contact is optional — omit the "contact X" clause gracefully when it's null.
    const recommendation =
      advice.contact !== null
        ? `We recommend contacting ${advice.contact}${pushClause}.`
        : `We recommend rescheduling${pushClause}.`;
    return {
      title,
      body: `${arrivalClause}${projectedClause}. ${recommendation}`,
    };
  }

  // Fixed booking: no realistic reschedule — say it's likely lost and point at the window.
  // Deliberately NO "push to" time here.
  return {
    title,
    body: `${arrivalClause}${projectedClause}. This booking is likely lost — check the cancellation or exchange window now.`,
  };
}
