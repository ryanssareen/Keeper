# Reconciliation state machine (authoritative)

`step(StateInput) -> StateOutput` is pure. Fire on a **transition**, never on a condition being
true. Rules are evaluated in priority order; the first match wins.

| # | Guard | Next state | Fires |
|---|---|---|---|
| 0 | `current` is terminal (CANCELLED / DEFINITE_MISS / LANDED_CAPTURE) | unchanged | — |
| 1 | flight cancelled | CANCELLED (terminal) | CANCELLED (once) |
| 2 | flight landed (status `landed` OR an actual arrival is present) | LANDED_CAPTURE (terminal) | — |
| 3 | feed stale past ceiling | DEGRADED | CANNOT_CONFIRM (once) |
| 4 | verdict indeterminate (no usable prediction) | DEGRADED | CANNOT_CONFIRM (once) |
| 5 | commitment time passed AND not landed (fresh data) | DEFINITE_MISS (terminal) | DEFINITE_MISS |
| 6 | verdict miss, deficit ≥ anti-flap | MISS_PREDICTED | CATCH (once; no re-fire while in miss) |
| 7 | verdict miss, deficit < anti-flap | AT_RISK | — (anti-flap holds) |
| 8 | verdict make, in MISS_PREDICTED/RECOVERED, slack ≥ recovery band, dwell met | RECOVERED | ALL_CLEAR (once) |
| 9 | verdict make, in MISS_PREDICTED/RECOVERED, recovering but dwell not yet met | unchanged | — (build dwell) |
| 10 | verdict make, in MISS_PREDICTED/RECOVERED, slack below band | unchanged | — (reset dwell) |
| 11 | verdict make, in OK/AT_RISK, slack ≥ OK band | OK | — |
| 12 | verdict make, in OK/AT_RISK, slack below OK band | AT_RISK | — |

**Safety invariants**
- Cancellation, landing, and stale-feed are **global** — reachable from any live state (rules 1–3 precede the verdict rules).
- Landing is **terminal and silent**: once the flight is on the ground its airborne phase is over and the outcome is sealed for capture. The engine stops polling (`terminal=true`, `next_poll_at=NULL`); U9 records the actual arrival + self-report into the calibration row on a separate path. No CATCH fires at touchdown — an actionable catch fires earlier, en route, while lead time still exists, and there is no "landed" notification kind.
- Cancellation and landing (rules 1–2) are terminal **flight-phase facts derived only from a fresh fetch** (the stale branch forces `flightLanded=false` and a stale status reads `unknown`), so neither seals a watch from a stale feed despite preceding the stale rule. Landing precedes the indeterminate rule so a landed flight with no usable prediction still seals rather than degrading forever.
- DEGRADED **never** asserts a definite miss from missing data: rule 3 (stale) precedes rule 5, so "stale AND commitment passed" stays DEGRADED.
- A miss never re-fires CATCH while already in MISS_PREDICTED; recovery requires a sustained cross-back (dwell).
- DEGRADED re-enters at the verdict the fresh data implies (a fresh miss out of DEGRADED fires CATCH via rule 6).
