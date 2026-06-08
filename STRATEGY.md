---
name: Keeper
last_updated: 2026-06-05
---

# Keeper Strategy

<!-- Working title — founder to finalize. Principle: name the benefit (the catch / the save), not the threat. "Cascade" rejected for naming the threat. -->

## Target problem

For someone managing a multi-part trip, the pain isn't storing the booking — it's what happens when a real-time change breaks everything downstream of it. A flight slips 90 minutes and the airport transfer, the hotel check-in window, and tonight's dinner reservation are all silently wrong — and no tool detects the collision or tells the traveler what to do about it.

## Our approach

Win by being the **trip-state reconciliation engine**: model the trip as monitorable time-and-place items, detect when a real-time change invalidates something downstream, and **advise** the fix — detect-and-advise, not auto-fix. The reconciliation logic is the *product*, but the durable *moat* is the calibration corpus (real buffers, real cascade rates accrued only from our users' trips) — a moat we grow into rather than launch with, and one that cross-platform reach (where Flighty won't go) compounds faster: reach → trips → calibration → reliability → pricing power.

## Who it's for

**Primary:** The **complex-trip organizer** — the one person who assembles and shepherds a multi-leg trip for themselves and their family/group. They're hiring Keeper to keep a multi-part trip from quietly unraveling mid-trip — to be told *what broke and what to do* — instead of manually reconciling flights, check-in windows, and reservations under pressure while everyone leans on them. Low-frequency, high-complexity: only a few trips a year, but each one dense with downstream items and acute when it breaks (family is the audience, not the co-editor).

## Key metrics

**Steer this quarter** (can pay out in a quarter):

- **Thesis-exercising trips created** — trips with ≥1 *monitorable* downstream item, resolvable to time **and** place so the engine can collide-check it (free-text "dinner 7pm" doesn't count). Same key the telemetry uses. _[DB]_
- **Cascade-alert usefulness rate** — % of break-alerts acted on or rated useful, **always reported with its denominator** (cascade events observed); at low event volume the rate is noise, and the volume gate tells you when it's readable. _[Analytics + in-app feedback]_
- **First-useful-catch rate** — % of active users who experienced ≥1 useful catch. The in-quarter leading proxy for repeat-trip rate (catches → trust → return), which a 1–3-trip/year persona won't reveal directly. _[DB / Analytics]_

**Instrument, don't target yet** (won't read true on a quarter's clock):

- **Prediction-vs-outcome accuracy** — the moat metric, but small-n early. Watch the *count* of cascade events before treating the rate as a trend; a flat early line is low n, not failure. _[v1 outcome telemetry]_
- **Free-to-paid conversion** — cohorted to *catches experienced*, not calendar (the value moment is the catch, not signup). Repeat-trip rate sits behind this as the lagged 6–18mo retention confirmation. _[Billing]_

**Diagnostic — never optimize:**

- **In-trip daily opens** — directionally ambiguous for a proactive-alert product: high opens may mean users *don't* trust the alerts and are compulsively checking. The ideal may be low opens + high alert-action. Watch it; never target it.

## Tracks

Owned **horizontally** (the three layers below); **delivered as thin vertical slices** through all three. Release 1 is a walking skeleton — ingest 1 flight + 1 monitorable downstream item → reconcile (detect the collision, log prediction-vs-outcome) → advise (alert + dashboard) — which demos value *and* forces the moat layer to exist in v1. The horizontal cut's failure mode is **late integration**; the mitigation is that every increment ships end-to-end through all three layers.

### Reconciliation engine + calibration pipeline _(spine + moat)_

The unified trip model, the collision/cascade detection that runs at trip-time, and the prediction-vs-outcome telemetry that accumulates the calibration corpus.

_Why it serves the approach:_ This *is* the product and the only durable moat. The at-risk sub-component is specifically the **telemetry + calibration loop** — no visible early output, so it's the thing that gets punted; protect it by name. For a solo-founder + Claude Code build, give it a dedicated reconciliation/telemetry skill + subagent with its own context, rather than smearing the logic across the connector subagents.

### Trip-state ingestion _(substrate)_

Getting flights, hotels, and reservations into the model as monitorable time-and-place items. Flight tracking lives here — as the **acquisition hook** and first connector — alongside hotel-confirmation parsing and manually-added reservations.

_Why it serves the approach:_ You can't reconcile a trip you haven't modeled. This is the substrate the engine collide-checks, and the volume input that compounds the calibration moat.

### Day-of concierge surface _(output)_

How detected breaks and advice reach the traveler: the alert engine (push/FCM), the unified dashboard of ingested/modeled items, and the advise-not-autofix interaction.

_Why it serves the approach:_ Reconciliation only creates value if the break and the recommended action reach the organizer in time. This is where the promise is felt — and where first-useful-catch is won or lost.

### Plan-time itinerary _(experimental — reopened 2026-06-07)_

An AI itinerary that is the *opposite* of the rejected commodity: it generates **anchored to the user's real bookings** (every item born with a time and place, so it's monitorable), then applies the engine's collision logic at **plan-time** to flag fragile seams before the trip — and tracks **plan adherence** during the trip (the user checks off what they actually did; missed items trigger a structured, non-chatbot catch-up that reconciles tomorrow against what slipped).

_Why it serves the approach:_ It feeds the wedge rather than diluting it — generation becomes an **activation on-ramp** that converts loose plans into the monitorable items the engine needs (directly lifting "thesis-exercising trips created"), and plan-adherence is a fresh **planned-vs-actual calibration signal** for the moat. _Guardrail:_ if it drifts to untethered free-text recommendations, it collapses back into the rejected commodity — monitorability + booking-anchoring is the line. Experimental: validate demand before promoting out of this track.

## Milestones

- **2026-11 → 2026-12 (target window)** — Live with the walking skeleton before the year-end holiday travel peak. Peak delays mean peak cascades: the fastest calibration and the strongest value demonstration. Summer 2026 is likely too tight. _(Founder to confirm against build velocity; no fundraise or hard date invented.)_

## Not working on

- **Auto-fix / write-access** (rebooking transfers, moving reservations) — detect-and-advise only at MVP; acting needs write-access partnerships, deferred.
- **Generic AI itinerary _generation_** (untethered "things to do" from a city + dates) — still out: calm-state, commoditized axis, doesn't exercise the thesis. _But_ a **reconciliation-native variant** — booking-anchored, every item monitorable, with plan-adherence catch-up — moved to an active experiment (see Tracks → _Plan-time itinerary (experimental)_). The line that stays out is untethered generation; the line that came back in is itinerary-as-engine-input. _(Reopened 2026-06-07; see docs/brainstorms/2026-06-07-ai-itinerary-requirements.md.)_
- **Group collaboration / shared editing / group accounts** — family is the alert *audience* (a shareable status view), not co-editors at MVP.
- **Live flight map** (OpenSky / AirLabs) — deferred.
- **Hotel inventory / booking APIs** — parse the user's own confirmation instead.
- **Rich POI API** — cheap LLM grounded on geocoder + web search instead.
- **Multi-channel notifications** (push/FCM only) and **past-trip analytics** — deferred.

## Marketing

**One-liner:** It catches your trip falling apart before you do — and tells you what to do about it.
