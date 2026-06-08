# AI Trip Itinerary — Requirements

- **Date:** 2026-06-07
- **Status:** Draft (brainstorm output, pre-planning)
- **Scope tier:** Deep — product (deliberate strategy revisit)
- **Chosen shape:** B + C — booking-anchored generation + plan-time stress-test

## Summary

An AI itinerary for the trips feature that generates a day-by-day plan **anchored to the user's real bookings** (flight arrival airport/time, hotel location and check-in/out, party, destination), emits **every suggestion as a monitorable time-and-place item**, **collide-checks** the resulting plan to flag fragile seams before the trip, and **tracks plan-adherence during the trip** — the user checks off what they actually did, and missed items trigger a **structured, non-chatbot catch-up** that reconciles tomorrow against what slipped. The shape is chosen so that generation *feeds* the reconciliation moat instead of diluting it.

## Strategy conflict & product thesis

`STRATEGY.md` (2026-06-05) lists **"AI itinerary _generation_"** under **Not working on** — rejected as a calm-state, commoditized axis that doesn't exercise the reconciliation thesis. This brainstorm **intentionally reopens that decision** at the user's direction.

The reconciling thesis — the reason this version is not the rejected commodity:

1. **Booking-anchored.** Suggestions are built around the user's actual fixed points, so they're better than a generic LLM planner *because Keeper knows the bookings ChatGPT doesn't.*
2. **Monitorability gate.** Every generated item resolves to time **and** place, so it becomes a downstream item the engine can collide-check — directly feeding the #1 steer metric ("thesis-exercising trips created").
3. **Reconciliation at plan-time.** The stress-test layer applies the engine's collision logic *before* the trip, catching fragile seams early.
4. **Reconciliation of plan-adherence (the strongest fit).** During the trip, the user checks off what they actually did; missed items trigger a structured catch-up that reconciles tomorrow against what slipped. This is detect-and-advise applied to the user's *own execution* — decisively *not* calm-state — and it yields a planned-vs-actual calibration signal.

**Guardrail:** if the feature drifts toward free-text, untethered "things to do," it collapses back into the rejected commodity. Monitorability + booking-anchoring is the line that keeps it on-thesis.

## Problem & context

Today the trips page surfaces *ingested* items (live flight status, hotel, attachments), but the user assembles the actual day-of plan elsewhere (ChatGPT, blogs, notes). Keeper never sees those plans, so they're never monitorable and the engine has nothing downstream to collide-check. A user with loose plans produces a trip with **zero monitorable downstream items** — the exact failure the steer metric measures.

## Goals

- **G1** — Turn a destination + bookings into a proposed day-by-day plan with minimal user input.
- **G2** — Make every *accepted* itinerary item a monitorable time+place item the engine can collide-check.
- **G3** — Surface fragile seams (tight connections, infeasible timing) in the plan before the trip.
- **G4** — Differentiate from generic LLM planners by grounding in the user's real bookings.

## Non-goals

- **NG1** — Booking or reservation *execution* (no write access; consistent with detect-and-advise).
- **NG2** — Generic "things to do" untethered from the trip (the rejected commodity axis).
- **NG3** — Group / collaborative itinerary editing.
- **NG4** — Real-time *in-trip* replanning (that's the existing reconciliation engine track; this is plan-time).

## Users

**Primary:** the complex-trip organizer (per `STRATEGY.md`), **pre-trip**, assembling the plan. The itinerary is an *activation surface* — it converts their loose intentions into monitorable items, which is how it earns its keep against the strategy.

## Requirements

- **R1** — Generate a day-by-day itinerary across the trip's date range, anchored to known bookings (flight arrival airport + time, hotel location + check-in/out, party size/type, destination).
- **R2** — Respect hard constraints from bookings: nothing before the flight lands on arrival day, nothing after departure on the final day, arrival-day items kept near the hotel/arrival area.
- **R3** — Each generated item carries a **time and a place resolvable to coordinates**, so it is monitorable. Free-text-only items are not produced.
- **R4** — The user can accept, edit, remove, or regenerate items; accepted items persist as part of the trip's modeled downstream items.
- **R5** — After generation (and on a user's typed/pasted plan), collide-check the timeline and flag fragile seams — tight transfers, infeasible ordering — as **advisories** (advise, never auto-fix).
- **R6** — Ground suggestions in real, geocodable places, not invented venues; a place that can't be resolved is not emitted as a monitorable item.
- **R7** — Handle the sparse-trip case: with few bookings, still produce a plan but clearly mark assumed anchors and degrade gracefully.
- **R8** — Make monitorability legible to the user (e.g., "now watched by Keeper") so the connection to the product's core value is visible.
- **R9** — Itinerary items are **completable**: during the trip the user marks what they actually did (checkboxes / done-confirmation), capturing planned-vs-actual.
- **R10** — When items go **uncompleted** (end of day, or a day with unchecked items), Keeper proactively opens a **catch-up**: it confirms whether the user still has plans for the next day and reconciles the missed items against it — what to drop, move, or compress — as advice (never auto-reschedules).
- **R11** — The catch-up interaction is **structured, not a chatbot**: guided prompts with explicit options and confirm/adjust controls (e.g., "Move the museum to tomorrow AM?" → Yes / Pick another slot / Drop it), *not* a free-form text box. Keeper's identity is structured advise, not conversational AI.
- **R12** — Plan-adherence (which items were completed vs slipped, and the catch-up outcome) is recorded as a **planned-vs-actual signal** — usable later as calibration-corpus input.

## Key decisions

- **KD1** — Shape = **B + C**. Pure generator (A) rejected as commodity with no moat contribution; stress-test-only (C) rejected as not the "generation" the user asked for.
- **KD2** — Generation is **gated on monitorability** — items must resolve to time+place or they don't enter the trip model.
- **KD3** — **Detect-and-advise preserved** — the stress-test flags seams; it never rebooks.
- **KD4** — Grounding via the existing geocoder + a cheap LLM (per strategy's "cheap LLM grounded on geocoder + web search"), not a rich POI API.
- **KD5** — **Plan adherence is a first-class signal.** The catch-up flow is reconciliation applied to the user's *own execution* (planned vs actual) — which is what most strengthens the thesis fit: it is explicitly *not* calm-state, and it produces a fresh planned-vs-actual calibration signal for the moat.
- **KD6** — **Structured, non-chatbot interaction model.** The catch-up (and itinerary edits generally) use guided controls and discrete options, not a conversational text box — consistent with advise-not-autofix and Keeper's structured identity.

## Scope boundaries

**Deferred for later**
- In-trip live replanning (belongs to the reconciliation engine track).
- Web-search grounding (start geocoder-only; add web search later).
- Share / export of the itinerary.
- Full from-scratch planning with no bookings at all.

**Outside this product's identity**
- A generic recommendation engine untethered from the user's trip.
- Booking / reservation execution.
- A social or discovery feed.

## Success criteria

- **SC1** — % of generated itineraries where ≥1 item becomes a monitorable downstream item (ties directly to the steer metric).
- **SC2** — Itinerary acceptance/edit rate (kept vs discarded).
- **SC3** — Stress-test usefulness — % of flagged seams rated useful or acted on.
- **SC4** — Lift in "thesis-exercising trips created" attributable to the itinerary surface.
- **SC5** — Catch-up engagement: % of trips where items are checked off (adherence tracked) and % of catch-up prompts rated useful / acted on.

## Dependencies & assumptions

- **LLM access** — `GROQ_API_KEY` is present in env, but no LLM call path was found in `lib/` or `app/` (unverified — assume the generation path is net-new to build).
- **Geocoder** — `lib/adapters/osm.ts` exists and is assumed usable for place resolution.
- **Trip model** — the trip is currently the user's onboarding-answers row (one trip/user). Itinerary items need a home as *modeled downstream items*; the unified trip model from the reconciliation track is assumed and may not fully exist yet — a likely prerequisite.
- **Unprobed rigor gaps** (the user opted to skip the pressure-test and proceed; recorded here as open risk):
  - *Evidence* — no concrete signal was captured that users want this; `STRATEGY.md` actively rejected it two days prior. The pivot rests on conviction, not observed demand.
  - *Durability* — AI trip planning is fast-commoditizing (ChatGPT, Gemini, Wanderlog). The durable differentiation is **entirely** the booking-anchoring + monitorability, not generation quality. If those two are weak, there is no moat here.
  - *Counterfactual* — assumed users currently use ChatGPT/blogs and never bring those plans into Keeper.

## Outstanding questions

- **OQ1** — Entry point: auto-generate on trip creation, or an explicit "Plan my days" action?
- **OQ2** — Input minimum: does v1 require a flight + hotel, or generate from destination + dates alone?
- **OQ3** — How do itinerary items reconcile with the engine's existing item model — same entity as flights/hotels, or a new "plan item" type?
- **OQ4** — Does the stress-test run on generated plans only, or also on a user-pasted external itinerary (the "paste from ChatGPT" path)?
- **OQ5** — *Resolved:* reopened as an **experimental track** in `STRATEGY.md` (2026-06-07) — validate demand before promoting. Untethered generic generation stays out.
- **OQ6** — Catch-up trigger timing: end-of-day prompt, next-morning, or real-time as items pass uncompleted? And what marks an item "missed" (explicit skip vs. just unchecked past its time)?
- **OQ7** — Does the catch-up only reschedule within the existing plan, or can it also propose *new* items to fill a freed slot (and does that re-enter the monitorability gate)?
- **OQ8** — How far does "structured, non-chatbot" go — fixed option sets only, or constrained free-text with structured confirmation? Where's the line that keeps it from becoming a chat window?
