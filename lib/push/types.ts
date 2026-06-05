/**
 * Catch advice + template signature. Frozen in Step 2.
 * The engine computes StructuredAdvice; push (U8) and the dashboard (U10) render it identically,
 * so the catch text and the in-app mirror never drift.
 */
import type { FiredKind } from "@/lib/engine/types";

export interface StructuredAdvice {
  kind: FiredKind;
  flightNumber: string;
  /** New predicted arrival at the airport (UTC ISO) — the "what broke". */
  newArrivalUtc: string | null;
  /** Projected arrival at the place (UTC ISO). */
  projectedAtPlaceUtc: string | null;
  placeLabel: string;
  reschedulable: boolean;
  /** For reschedulable commitments: a realistic new time to push to (UTC ISO). */
  recommendedNewTimeUtc: string | null;
  contact: string | null;
  /** IANA zone for rendering local times in the message. */
  zone: string;
}

export interface CatchMessage {
  title: string;
  body: string;
}

/** Frozen catch-template signature (U8). Pure: advice -> message. */
export type RenderCatch = (advice: StructuredAdvice) => CatchMessage;
