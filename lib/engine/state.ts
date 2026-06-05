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

  // 2. Stale feed — global; never asserts a miss from missing data.
  if (feedStale) {
    return { next: "DEGRADED", fired: current === "DEGRADED" ? null : "CANNOT_CONFIRM", recoveryProgress: 0 };
  }

  // 3. No usable prediction — can't confirm.
  if (verdict === "indeterminate") {
    return { next: "DEGRADED", fired: current === "DEGRADED" ? null : "CANNOT_CONFIRM", recoveryProgress: 0 };
  }

  // 4. Commitment time passed while still en route (fresh data) — definite miss, terminal.
  if (commitmentPassed && !flightLanded) {
    return { next: "DEFINITE_MISS", fired: "DEFINITE_MISS", recoveryProgress: 0 };
  }

  // 5/6. Miss.
  const deficit = slackMinutes !== null && slackMinutes < 0 ? -slackMinutes : 0;
  if (verdict === "miss") {
    if (deficit >= ENGINE.antiFlapDeficitMinutes) {
      return { next: "MISS_PREDICTED", fired: current === "MISS_PREDICTED" ? null : "CATCH", recoveryProgress: 0 };
    }
    return { next: "AT_RISK", fired: null, recoveryProgress: 0 }; // borderline; anti-flap holds
  }

  // 7/8/9. Make while in a miss/recovered state — recovery requires sustained slack (dwell).
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

  // 10/11. Make while in OK/AT_RISK.
  if (slackMinutes !== null && slackMinutes >= ENGINE.okAtRiskBandMinutes) {
    return { next: "OK", fired: null, recoveryProgress: 0 };
  }
  return { next: "AT_RISK", fired: null, recoveryProgress: 0 };
}
