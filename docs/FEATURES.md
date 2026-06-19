---
name: Keeper Features
last_updated: 2026-06-19
---

# Keeper — Feature Catalog

The current, implemented features of Keeper, grouped by the three product layers from
[`STRATEGY.md`](../STRATEGY.md) (ingestion → reconciliation → concierge) plus the supporting
account, security, and operational surfaces. Each feature cites the code that backs it. See
[`CONCEPTS.md`](../CONCEPTS.md) for the domain vocabulary (Trip, Attachment, Itinerary, etc.).

> Scope note: this lists what exists in code today. The **plan-time itinerary** track is marked
> _experimental_ in strategy but is implemented end-to-end; it is noted as such below.

---

## 1. Accounts & authentication

- **Email + password sign-up** — with optional display name, 8-character minimum, and
  email-enumeration protection (an already-registered email is routed to log in rather than left
  waiting for a confirmation mail). `lib/auth/actions.ts` (`signUp`), `components/auth/SignupForm.tsx`
- **Email confirmation flow** — confirmation link lands on `/auth/confirm` (code exchange) and
  forwards into onboarding. `app/auth/confirm/route.ts`
- **Log in / log out** — password sign-in with friendly error mapping. `lib/auth/actions.ts`
  (`signIn`, `signOut`), `components/auth/LoginForm.tsx`
- **Continue with Google (OAuth/PKCE)** — Supabase OAuth flow via `/auth/callback`.
  `components/auth/GoogleButton.tsx`, `app/auth/callback/route.ts`
- **Forgot / reset password** — neutral-response recovery email (never reveals whether an account
  exists) → PKCE callback → set-new-password screen. `lib/auth/actions.ts` (`requestPasswordReset`,
  `resetPassword`), `components/auth/ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`
- **Account settings** — update display name and change password in a tabbed settings surface.
  `lib/auth/actions.ts` (`updateProfile`, `updatePassword`), `components/app/SettingsTabs.tsx`,
  `app/settings/page.tsx`
- **Open-redirect–safe `next` routing** — post-auth redirects are restricted to same-site paths.
  `lib/auth/actions.ts` (`sanitizeNext`)

## 2. Onboarding & trip setup

- **Trip setup wizard** — multi-step capture of trip name, party size, destination, country, and
  airport code, with start/end dates. `components/app/OnboardingWizard.tsx`,
  `lib/onboarding/actions.ts`
- **Optional flight + hotel capture** — flight number/date/seat and hotel name/check-in/check-out,
  feeding the modeled trip. `lib/onboarding/actions.ts` (`OnboardingAnswers`)
- **Itinerary preferences** — optional refinements (ages, interests, pace, must-sees, fixed
  bookings, notes) used to ground AI itinerary generation. `lib/onboarding/actions.ts`
  (`itineraryPrefs`)
- **Auto-save + monotonic completion** — intermediate answers are saved per step (fire-and-forget);
  `completed` is only set on final submit. `lib/onboarding/actions.ts` (`saveOnboarding`)
- **Skip for now** — writes a marker so the dashboard doesn't loop back into onboarding.
  `lib/onboarding/actions.ts` (`skipOnboarding`)
- **Airport autocomplete** — server-side fuzzy search over a vendored ~5.6k-airport OpenFlights
  dataset (exact IATA, city/code/country prefix, substring). `lib/places/airports.ts`,
  `app/api/places/route.ts`, `components/app/DestinationField.tsx`

## 3. Trip-state ingestion (Layer 01 · Substrate)

- **Trip summary view** — destination, dates, flight card, stay, and attachments in one place.
  `app/trips/page.tsx`, `components/app/TripSummary.tsx`
- **Document attachments** — upload booking docs classified by kind (flight, hotel, car, insurance,
  other); 10 MB cap; PDF/PNG/JPG/WebP/HEIC/GIF/TXT; stored per-user in Supabase Storage with signed,
  120-second download URLs and delete-with-rollback. `lib/trips/actions.ts`
  (`uploadAttachment`, `getDownloadUrl`, `deleteAttachment`), `lib/trips/queries.ts`,
  `components/app/TripAttachments.tsx`
- **Pluggable flight data provider** — selected via `FLIGHT_PROVIDER`/key presence:
  - **AeroDataBox** (RapidAPI) — `lib/adapters/aerodatabox.ts`
  - **AirLabs** — `lib/adapters/airlabs.ts`
  - **AviationStack** — `lib/adapters/aviationstack.ts`
  - **Simulator** (keyless, deterministic, for local/testing) — `lib/adapters/simulator.ts`
  - Adapter selection + normalization — `lib/adapters/flight.ts`
- **Normalized flight arrival facts** — scheduled / predicted / actual arrival (UTC), status
  (scheduled, active, landed, cancelled, diverted, unknown), arrival airport (diversion signal), and
  a **revision fingerprint** of the load-bearing fields for change detection.
  `lib/engine/types.ts` (`FlightArrival`)
- **Place resolution & transit** — OSM/Nominatim geocoding to coordinates + IANA timezone, with
  OSRM routing or a manual-buffer fallback for transit minutes; unroutable/ambiguous places carry
  advisory reason codes. `lib/adapters/osm.ts`, `lib/engine/types.ts` (`PlaceResolution`)

## 4. Reconciliation engine (Layer 02 · Spine & moat)

- **Deterministic collision detection** — given predicted arrival, egress + transit, and a
  place-anchored commitment (local wall-time + IANA zone + margin), returns verdict
  (`make`/`miss`/`indeterminate`), projected arrival-at-place, slack, and lead minutes. DST-aware via
  Luxon; deadline is inclusive. `lib/engine/collision.ts`, `lib/engine/types.ts`
- **Watch state machine** — eight states (`OK`, `AT_RISK`, `MISS_PREDICTED`, `RECOVERED`,
  `DEGRADED`, `CANCELLED`, `DEFINITE_MISS`, `LANDED_CAPTURE`) with defined terminal states and
  transition rules. `lib/engine/state.ts`, `lib/engine/transitions.md`
- **Arm a watch** — fetch flight, resolve place + transit, validate, mint a one-time capability
  token (hash stored), and persist the watch with its first calibration snapshot atomically.
  `lib/engine/arm.ts`, `app/api/watch/route.ts`
- **Idempotent per-watch reconcile** — `SELECT … FOR UPDATE` lock, a pure planner deciding
  skip-vs-apply, snapshot fingerprinting to prevent duplicate firings, and adaptive `next_poll_at`
  scheduling. `lib/engine/reconcile.ts`
- **"Can't confirm" on stale data** — when the feed is older than the staleness ceiling the engine
  emits an indeterminate verdict instead of asserting a miss. `lib/engine/reconcile.ts`,
  `lib/engine/collision.ts`
- **Cascade / slack computation** — slack = deadline − (predicted arrival + transit + egress); lead =
  minutes until the traveler must leave. `lib/engine/collision.ts`

## 5. Plan-time itinerary _(experimental track — implemented)_

- **AI itinerary generation** — grounded candidate generation via Groq (`openai/gpt-oss-120b`), with
  per-day targets by pace (relaxed 3 / balanced 4 / packed 6) and strict JSON validation.
  `lib/itinerary/generate.ts`
- **Monitorable-only items** — every candidate is geocoded; an item without lat/lng/IANA-zone is
  dropped (no free-text-only items). `lib/itinerary/resolve.ts`, `lib/itinerary/itinerary.ts`
- **Itinerary items** — kinds (sight, food, activity, transport, other) and adherence status
  (planned, completed, missed, rescheduled), scheduled within the trip's derived date envelope.
  `lib/itinerary/itinerary.ts`, `lib/itinerary/envelope.ts`, `components/app/ItineraryView.tsx`
- **Plan-time feasibility advisories** — flags over-packed days (> 6 stops), too-brief stops
  (< 30 min), and tight transfers (slack < 10 min) without auto-fixing. `lib/itinerary/feasibility.ts`,
  `lib/itinerary/constants.ts`
- **Item CRUD & adherence** — generate/regenerate (replaces prior plan), set item status, delete
  item. `lib/itinerary/actions.ts`, `lib/itinerary/queries.ts`, `app/trips/itinerary/page.tsx`

## 6. Day-of concierge surface (Layer 03 · Output)

- **Web push subscription** — register/refresh a device subscription with endpoint-host allowlisting
  (FCM/APNs/WNS/Mozilla, SSRF-guarded) and key-shape validation; UPSERT keyed on endpoint.
  `app/api/push/subscribe/route.ts`, `lib/push/subscription.ts`
- **PWA install affordance** — context-aware enable-notifications / iOS Add-to-Home-Screen prompt;
  registers the service worker and subscribes with the public VAPID key. `components/InstallPrompt.tsx`
- **Catch notifications** — five kinds (`CATCH`, `ALL_CLEAR`, `CANNOT_CONFIRM`, `DEFINITE_MISS`,
  `CANCELLED`); catches name what broke and the specific move (e.g. call the venue, push the table to
  the nearest 15-minute boundary) with lead time. `lib/push/template.ts`, `lib/engine/types.ts`
  (`FIRED_KINDS`)
- **At-least-once dispatch** — transactional outbox of fired transitions delivered to web push with
  dynamic TTL and stale-subscription pruning on 404/410. `lib/push/dispatch.ts`
- **Dashboard** — capability-gated single-watch view (works logged-out via `?id=&token=`) and a
  signed-in multi-watch console showing state, timeline, and catch history as a reliability backstop.
  `app/dashboard/page.tsx`, `components/app/DashboardDetail.tsx`, `WatchList.tsx`, `WatchStatus.tsx`

## 7. Self-report & calibration (the moat)

- **One-tap self-report** — capability-gated `made` / `missed` / `changed` outcome capture with an
  optional usefulness vote; replay-safe. `app/api/self-report/route.ts`, `lib/calibration/writer.ts`,
  `components/SelfReportForm.tsx`
- **Prediction-vs-outcome telemetry** — each reconcile writes a snapshot (predicted arrival, verdict,
  slack, state, fetched-at); outcomes enrich it to pending → sealed → stale. `lib/calibration/types.ts`,
  `lib/calibration/writer.ts`
- **Actual-arrival backfill** — post-landing, fetch the flight to capture actual arrival and detect
  diversions. `lib/calibration/backfill.ts`
- **Calibration metrics & dashboard view** — accuracy/lead-time metrics and a per-watch timeline.
  `lib/calibration/metrics.ts`, `lib/calibration/dashboard.ts`

## 8. Scheduling & operations

- **Cron reconcile tick** — bearer-token–guarded `/api/cron/reconcile` runs four phases serially:
  reconcile batch → dispatch outbox → expire stale self-reports → backfill actual arrivals; returns a
  summary and is idempotent on replay. `app/api/cron/reconcile/route.ts`, `lib/scheduler/batch.ts`
- **Due-watch selection & caps** — most-due-first ordering, per-tick batch cap, and an upstream-call
  ceiling that stops the tick early on rate limits. `lib/scheduler/select.ts`, `lib/scheduler/batch.ts`
- **Adaptive poll cadence** — out-of-window hourly, near-deadline 5-minute, degraded 10-minute,
  terminal never. `lib/engine/reconcile.ts`, `lib/engine/constants.ts`
- **Backoff for persistent failures** — `lib/scheduler/backoff.ts`

## 9. Security & abuse controls

- **Capability-token access** — 32-byte base64url tokens, SHA-256 hash stored, constant-time verify,
  with uniform denial (missing watch ≡ bad token, no existence oracle). `lib/security/capability.ts`,
  `lib/security/watchGate.ts`
- **IP rate limiting** — Upstash Redis-backed limit on mutating public routes; fail-closed in prod,
  bypass in dev, with an operator escape hatch. `lib/security/ratelimit.ts`
- **Per-device watch cap** — max active watches per device, checked before arm.
  `lib/security/ratelimit.ts`, `lib/engine/arm.ts`
- **Monthly budget circuit-breaker** — blocks new arms once the month's ceiling is hit; existing
  watches keep reconciling. `lib/engine/arm.ts`
- **Cron auth** — constant-time `CRON_SECRET` bearer check. `lib/security/cron.ts`
- **Security headers & cross-origin POST rejection** — `lib/security/headers.ts`, `proxy.ts`

## 10. Marketing & legal site

- **Landing page** — hero, cascade-problem framing, how-it-works, and a tracker-vs-Keeper comparison.
  `app/page.tsx`
- **Features page** — the three-layer breakdown and capability comparison table. `app/features/page.tsx`
- **Contact** — validated, HTML-escaped, rate-limited form sending transactional email (Brevo).
  `app/contact/page.tsx`, `app/api/contact/route.ts`, `components/site/ContactForm.tsx`
- **Legal** — Terms (advisory-only / detect-and-advise) and Privacy. `app/terms/page.tsx`,
  `app/privacy/page.tsx`, `components/site/LegalPage.tsx`
