# Keeper

**It catches your trip falling apart before you do — and tells you what to do about it.**

Keeper is a **trip-state reconciliation engine**. It models a multi-part trip as monitorable
time-and-place items, detects when a real-time change (a delayed flight) invalidates something
downstream (the airport transfer, the hotel check-in window, tonight's dinner), and **advises** the
fix — detect-and-advise, not auto-fix.

See [`STRATEGY.md`](./STRATEGY.md) for the why, [`CONCEPTS.md`](./CONCEPTS.md) for the domain
vocabulary, and **[`docs/FEATURES.md`](./docs/FEATURES.md) for the full feature catalog**.

## What it does (three layers, one promise)

1. **Trip-state ingestion** — turns flights, hotels, and reservations into monitorable items, each
   resolved to a real time and place. Flight tracking (AeroDataBox / AirLabs / AviationStack /
   simulator) is the acquisition hook; document attachments and onboarding capture the rest.
2. **The reconciliation engine** — at trip-time it re-collides arrival + transit + margin against
   each deadline; the moment slack goes negative it's a catch. Every prediction is logged against the
   real outcome to grow the calibration corpus (the moat).
3. **The day-of concierge surface** — one web-push alert that names what broke and the move to make,
   mirrored on a dashboard that stays accurate even if a notification slips.

An experimental **plan-time itinerary** generates booking-anchored, monitorable items (Groq), flags
fragile seams before the trip, and tracks plan adherence during it.

## Feature areas

| Area | Highlights | Code |
| --- | --- | --- |
| Accounts | Email/password, Google OAuth, email confirmation, password reset, settings | `lib/auth`, `app/login`, `app/signup`, `app/settings` |
| Onboarding | Trip setup wizard, flight/hotel capture, itinerary prefs, airport search | `lib/onboarding`, `app/onboarding`, `lib/places` |
| Ingestion | Document attachments, pluggable flight providers, geocoding + transit | `lib/trips`, `lib/adapters`, `app/trips` |
| Engine | Collision detection, 8-state watch machine, arm + reconcile, stale-data handling | `lib/engine` |
| Itinerary | AI generation, monitorable-only items, feasibility advisories, adherence | `lib/itinerary`, `app/trips/itinerary` |
| Concierge | Web push, PWA install, catch templates, at-least-once dispatch, dashboard | `lib/push`, `app/dashboard`, `app/api/push` |
| Calibration | Self-report, prediction-vs-outcome telemetry, actual-arrival backfill, metrics | `lib/calibration`, `app/api/self-report` |
| Operations | Cron reconcile tick, due-watch selection, adaptive poll cadence, backoff | `lib/scheduler`, `app/api/cron/reconcile` |
| Security | Capability tokens, IP rate limiting, watch caps, monthly budget breaker, cron auth | `lib/security`, `proxy.ts` |
| Site | Landing, features, contact, legal pages | `app/page.tsx`, `app/features`, `app/contact` |

Full detail with per-feature file references lives in [`docs/FEATURES.md`](./docs/FEATURES.md).

## Getting started

> **Read `AGENTS.md` first.** This is a customized Next.js — APIs and conventions may differ from
> stock Next.js, and the relevant guides live in `node_modules/next/dist/docs/`.

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase, a flight provider, VAPID, etc.
pnpm dev                     # http://localhost:3000
```

```bash
pnpm test        # vitest
pnpm lint        # eslint
```

Keyless local development works out of the box: the flight **simulator** adapter requires no API key.

## Tech stack

Next.js (App Router) · TypeScript · Supabase (auth, Postgres, storage, RLS) · Upstash Redis (rate
limiting) · Web Push / VAPID · Groq (itinerary generation) · OSM/Nominatim + OSRM (geocoding &
routing) · Brevo (transactional email).

## Repository layout

- `app/` — routes, pages, and API handlers (App Router)
- `components/` — UI (`app/`, `auth/`, `site/`)
- `lib/` — domain logic (engine, adapters, itinerary, push, calibration, scheduler, security, …)
- `docs/` — [`FEATURES.md`](./docs/FEATURES.md), plus `plans/`, `brainstorms/`, and `solutions/`
- `supabase/` — schema and migrations
- `proxy.ts` — edge proxy (security headers, cross-origin guard, rate limiting)
