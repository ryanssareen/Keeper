# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Trips

### Trip
A user's planned journey — its destination, travel party, and optional flight and hotel bookings — captured during onboarding and surfaced as the single place that holds everything for that journey. A user currently has at most one Trip.

### Attachment
A booking document a user keeps against their Trip — a flight ticket, hotel confirmation, or similar — each classified by a *kind* (Flight, Hotel, Car rental, Insurance, or Other). Attachments are private to the owning user: only they can view, download, or remove one.

### Itinerary
A user's AI-generated day-by-day plan for their Trip — a set of Itinerary Items scheduled around the trip's real bookings. Generation is button-triggered and replaces the prior plan; there is one Itinerary per Trip.

### Itinerary Item
A single planned stop in an Itinerary — a place with a kind (sight, food, activity, transport, other), a scheduled time window, and an adherence *status* (planned, completed, missed, rescheduled). Every Item is **monitorable**: it resolved to a real, geocoded place (a time and a location), which is what lets the engine watch it against the trip. A candidate that doesn't resolve is dropped, never stored — so a free-text-only item cannot exist.
