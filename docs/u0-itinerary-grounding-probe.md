# U0 — AI Itinerary grounding drop-rate probe (go/no-go)

Date: 2026-06-08 · Plan: `docs/plans/2026-06-08-001-feat-ai-itinerary-plan.md` (U0)

## Gate
> *"If drop >40% OR survivors collapse to landmarks, generate-then-verify is falsified and retrieval-first must lead."* — and a separate check-off feasibility read gates Phase 4.

## Method
Live probe: Groq `gpt-oss-120b` (strict JSON) generated 30 candidate places each for **Lisbon, Tokyo, Mexico City**; each was geocoded through the **exact monitorability gate the plan specifies** — Nominatim free-text search, keep only `importance ≥ 0.3` (`CONFIDENCE_MIN` in `lib/adapters/osm.ts`).

## Result — gate FAILS as-wired, but the cause is the verifier, not the architecture

| Destination | Drop rate |
|---|---|
| Lisbon | 50% |
| Tokyo | 70% |
| Mexico City | 77% |

Pooled drop **66%**, 95% CI **[56–75%]** — the whole interval sits above the 40% line; decisive (Tokyo p=0.0009, Mexico City p<0.0001 vs a true-40% process).

**But the dropped places are real and famous, not LLM hallucinations.** A 4-lens analysis workflow (confidence 82–93, unanimous) established:

1. **Hallucination-vs-gate (93):** dropped = the canonical must-see roster — National Museum of Anthropology, Frida Kahlo's Casa Azul, Xochimilco (UNESCO), Pujol & Contramar, teamLab Borderless, MAAT, Time Out Market. `teamLab Borderless` geocodes to exact coords (type "museum") at importance **0.00009** — three orders of magnitude below the cut. The gate is a **false-negative machine for POIs.**
2. **Probe-artifact skeptic (88):** two confounds inflate the FAIL — (a) Nominatim `importance` is a **Wikipedia/Wikidata backlink-popularity prior**, sparse-to-zero for ordinary POIs even when they resolve perfectly; (b) **query format** — English name + `limit=1` manufactures false zeros: *"National Museum of Anthropology, Mexico City"* → 0 results, but *"Museo Nacional de Antropología, Mexico City"* → importance **0.476 (passes)**. A corrected probe would drop **well under 40%**.
3. **Drop-rate severity (82):** decisive that the pipeline **as wired** fails the gate — but it is gate-instrumentation failure, not candidate-quality failure, so it does **not** crown retrieval-first.
4. **Architectural implication (82):** keep generate-then-verify (the generator is sound); **replace the verifier**.

## Decision

- **Generate-then-verify: VIABLE** — do **not** rewrite to retrieval-first (it was deferred for TTM; the candidate generator is healthy).
- **The monitorability gate (KTD4 / U3) as specified is FALSIFIED** — `importance ≥ 0.3` (an airport-anchor threshold reused for POIs) drops 50–77% of real places and collapses plans to landmarks — i.e. straight into the commodity the strategy rejected.

## Required plan deltas (before building U2/U3)
1. **KTD4 / U3 — change the verification signal.** Verify on *"resolves to a confident, correctly-named POI"* (Nominatim `place_rank`/`type`/`category`, exact-name match), **not** on `importance`. Drop the `importance ≥ 0.3` floor for itinerary POIs (it stays correct for the airport-anchor use in the engine).
2. **Query in the local language / use structured lookup.** Have the generator emit the local-language name (or a structured `{name, type, area}`), not just an English label; consider Nominatim structured search over free-text + `limit=1`.
3. **Stable POI IDs (follow-up, per best-practices research):** for durability, anchor to Overture GERS / Google Places (New) IDs rather than name+coords; deferred but noted.
4. Re-run a corrected drop-rate probe after the verifier change; expect drop <40%.

## Phase 4 gate (check-off feasibility)
The second U0 check — will users tick items off in-trip — is a human/Wizard-of-Oz read, **not yet done**. Phase 4 (adherence/catch-up) stays gated on it; the plan already defers the LLM catch-up behind SC5.

## Artifacts
Throwaway probe (not shipped) was run from `scripts/_itin_probe/` and removed; raw per-city kept/dropped lists with importance scores are summarized above.
