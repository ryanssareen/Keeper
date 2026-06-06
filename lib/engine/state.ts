import type { FiredKind, FlightStatus, Verdict, WatchState } from "./types";
import { ENGINE } from "./constants";

/** Inputs to one state-machine step (all derived facts; pure). */
export interface StateInput {
  current: WatchState;
  verdict: Verdict;
  slackMinutes: number | null; // positive = slack, negative = deficit
  flightStatus: FlightStatus;
  flightLanded: boolean;
  feedStale: boolean; // last fetch older than the staleness ceiling
  commitmentPassed: boolean; // now >= commitment instant
  recoveryProgress: number; // consecutive recovered updates so far (dwell counter)
}

export interface StateOutput {
  next: WatchState;
  fired: FiredKind | null;
  recoveryProgress: number;
}

/** States from which the watch never reactivates — polling stops and the row seals. */
export const TERMINAL_STATES: readonly WatchState[] = ["CANCELLED", "DEFINITE_MISS", "LANDED_CAPTURE"];

export const isTerminalState = (state: WatchState): boolean => TERMINAL_STATES.includes(state);

/**
 * Advance the per-watch state machine. Fire on a transition, never on a condition.
 * Rules are evaluated in priority order (see transitions.md — authoritative).
 */
export function step(input: StateInput): StateOutput {
  const {
    current,
    verdict,
    slackMinutes,
    flightStatus,
    flightLanded,
    feedStale,
    commitmentPassed,
    recoveryProgress,
  } = input;

  // 0. Terminal states are sticky.
  if (isTerminalState(current)) {
    return { next: current, fired: null, recoveryProgress };
  }

  // 1. Cancellation — global, terminal.
  if (flightStatus === "cancelled") {
    return { next: "CANCELLED", fired: current === "CANCELLED" ? null : "CANCELLED", recoveryProgress: 0 };
  }

  // 2. Flight on the ground — its airborne phase is over and the actual arrival is known, so the
  //    watch seals for outcome capture (terminal). U9 backfills the actual arrival + self-report into
  //    the calibration row on its own path; the engine's job here is only to stop polling. Like
  //    cancellation, `flightLanded` is derived ONLY from a fresh fetch (the stale branch forces it
  //    false), so this never seals from a stale feed despite preceding the stale rule. Fires nothing:
  //    an actionable catch fires earlier, en route, while lead time still exists — there is none left
  //    at touchdown, and there is no "landed" notification kind.
  if (flightLanded) {
    return { next: "LANDED_CAPTURE", fired: null, recoveryProgress: 0 };
  }

  // 3. Stale feed — global; never asserts a miss from missing data.
  if (feedStale) {
    return { next: "DEGRADED", fired: current === "DEGRADED" ? null : "CANNOT_CONFIRM", recoveryProgress: 0 };
  }

  // 4. No usable prediction — can't confirm.
  if (verdict === "indeterminate") {
    return { next: "DEGRADED", fired: current === "DEGRADED" ? null : "CANNOT_CONFIRM", recoveryProgress: 0 };
  }

  // 5. Commitment time passed while still en route (fresh data) — definite miss, terminal. The
  //    `!flightLanded` guard is now implied by rule 2 (a landed flight already returned), but kept
  //    explicit so the rule stays self-contained.
  if (commitmentPassed && !flightLanded) {
    return { next: "DEFINITE_MISS", fired: "DEFINITE_MISS", recoveryProgress: 0 };
  }

  // 6/7. Miss.
  const deficit = slackMinutes !== null && slackMinutes < 0 ? -slackMinutes : 0;
  if (verdict === "miss") {
    if (deficit >= ENGINE.antiFlapDeficitMinutes) {
      return { next: "MISS_PREDICTED", fired: current === "MISS_PREDICTED" ? null : "CATCH", recoveryProgress: 0 };
    }
    return { next: "AT_RISK", fired: null, recoveryProgress: 0 }; // borderline; anti-flap holds
  }

  // 8/9/10. Make while in a miss/recovered state — recovery requires sustained slack (dwell).
  if (current === "MISS_PREDICTED" || current === "RECOVERED") {
    const recovered = slackMinutes !== null && slackMinutes >= ENGINE.recoveryBandMinutes;
    if (recovered) {
      const progress = recoveryProgress + 1;
      if (progress >= ENGINE.recoveryDwellUpdates) {
        return { next: "RECOVERED", fired: current === "RECOVERED" ? null : "ALL_CLEAR", recoveryProgress: progress };
      }
      return { next: current, fired: null, recoveryProgress: progress }; // building dwell
    }
    return { next: current, fired: null, recoveryProgress: 0 }; // below band — reset dwell
  }

  // 11/12. Make while in OK/AT_RISK.
  if (slackMinutes !== null && slackMinutes >= ENGINE.okAtRiskBandMinutes) {
    return { next: "OK", fired: null, recoveryProgress: 0 };
  }
  return { next: "AT_RISK", fired: null, recoveryProgress: 0 };
}
