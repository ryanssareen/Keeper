# Reconciliation state machine (authoritative)

`step(StateInput) -> StateOutput` is pure. Fire on a **transition**, never on a condition being
true. Rules are evaluated in priority order; the first match wins.

| # | Guard | Next state | Fires |
|---|---|---|---|
| 0 | `current` is terminal (CANCELLED / DEFINITE_MISS / LANDED_CAPTURE) | unchanged | — |
| 1 | flight cancelled | CANCELLED (terminal) | CANCELLED (once) |
| 2 | feed stale past ceiling | DEGRADED | CANNOT_CONFIRM (once) |
| 3 | verdict indeterminate (no usable prediction) | DEGRADED | CANNOT_CONFIRM (once) |
| 4 | commitment time passed AND not landed (fresh data) | DEFINITE_MISS (terminal) | DEFINITE_MISS |
| 5 | verdict miss, deficit ≥ anti-flap | MISS_PREDICTED | CATCH (once; no re-fire while in miss) |
| 6 | verdict miss, deficit < anti-flap | AT_RISK | — (anti-flap holds) |
| 7 | verdict make, in MISS_PREDICTED/RECOVERED, slack ≥ recovery band, dwell met | RECOVERED | ALL_CLEAR (once) |
| 8 | verdict make, in MISS_PREDICTED/RECOVERED, recovering but dwell not yet met | unchanged | — (build dwell) |
| 9 | verdict make, in MISS_PREDICTED/RECOVERED, slack below band | unchanged | — (reset dwell) |
| 10 | verdict make, in OK/AT_RISK, slack ≥ OK band | OK | — |
| 11 | verdict make, in OK/AT_RISK, slack below OK band | AT_RISK | — |

**Safety invariants**
- Cancellation and stale-feed are **global** — reachable from any live state (rules 1–2 precede the verdict rules).
- DEGRADED **never** asserts a definite miss from missing data: rule 2 (stale) precedes rule 4, so "stale AND commitment passed" stays DEGRADED.
- A miss never re-fires CATCH while already in MISS_PREDICTED; recovery requires a sustained cross-back (dwell).
- DEGRADED re-enters at the verdict the fresh data implies (a fresh miss out of DEGRADED fires CATCH via rule 5).
