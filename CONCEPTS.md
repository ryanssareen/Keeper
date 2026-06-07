# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Trips

### Trip
A user's planned journey — its destination, travel party, and optional flight and hotel bookings — captured during onboarding and surfaced as the single place that holds everything for that journey. A user currently has at most one Trip.

### Attachment
A booking document a user keeps against their Trip — a flight ticket, hotel confirmation, or similar — each classified by a *kind* (Flight, Hotel, Car rental, Insurance, or Other). Attachments are private to the owning user: only they can view, download, or remove one.
