-- Reconciliation walking skeleton (Slice 1) schema.
-- Append-only calibration corpus: watches -> prediction_snapshots -> fired_transitions -> calibration.
-- push_subscriptions is a DELETABLE delivery credential attached to a device, never the corpus owner,
-- so pruning an expired (404/410) subscription never erases calibration history.

CREATE TABLE IF NOT EXISTS watches (
  id                  TEXT PRIMARY KEY,                 -- unguessable (UUID), never serial
  device_id           TEXT NOT NULL,                    -- stable client-generated owner key
  owner_token_hash    TEXT NOT NULL,                    -- hash of the capability token minted at arm
  flight_number       TEXT NOT NULL,
  flight_date         DATE NOT NULL,
  arrival_airport     TEXT,                             -- baseline arrival airport (set at arm, for diversion detection)
  commitment_local    TIMESTAMP NOT NULL,               -- wall-clock at the place
  commitment_zone     TEXT NOT NULL,                    -- IANA zone of the geocoded place
  commitment_instant  TIMESTAMPTZ NOT NULL,             -- resolved instant (index/query convenience)
  place_label         TEXT NOT NULL,
  place_lat           DOUBLE PRECISION,
  place_lng           DOUBLE PRECISION,
  place_resolved      BOOLEAN NOT NULL,                 -- geocode succeeded (thesis-exercising gate)
  margin_minutes      INTEGER NOT NULL,
  margin_source       TEXT NOT NULL CHECK (margin_source IN ('user','default')),
  egress_minutes      INTEGER NOT NULL,
  transit_minutes     INTEGER NOT NULL,
  transit_source      TEXT NOT NULL CHECK (transit_source IN ('osrm','manual_buffer')),
  reschedulable       BOOLEAN NOT NULL,
  contact             TEXT,
  state               TEXT NOT NULL,                    -- state-machine state
  revision            TEXT,                             -- data-derived fingerprint of last processed input
  next_poll_at        TIMESTAMPTZ,
  last_fetched_at     TIMESTAMPTZ,
  terminal            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent arm: one active watch per device + flight + commitment.
CREATE UNIQUE INDEX IF NOT EXISTS watches_dedupe_active
  ON watches (device_id, flight_number, flight_date, commitment_instant)
  WHERE terminal = FALSE;

-- Scheduler selector: WHERE next_poll_at <= now().
CREATE INDEX IF NOT EXISTS watches_due
  ON watches (next_poll_at) WHERE terminal = FALSE;

-- Append-only: one row per reconcile. Never overwritten; idempotent on (watch_id, revision).
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  watch_id              TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  fetched_at            TIMESTAMPTZ NOT NULL,
  predicted_arrival     TIMESTAMPTZ,                    -- NULL when verdict is indeterminate
  transit_minutes_used  INTEGER NOT NULL,
  egress_minutes_used   INTEGER NOT NULL,
  margin_minutes_used   INTEGER NOT NULL,
  slack_minutes         INTEGER,
  verdict               TEXT NOT NULL CHECK (verdict IN ('make','miss','indeterminate')),
  resulting_state       TEXT NOT NULL,
  revision              TEXT NOT NULL,
  fired_transition      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watch_id, revision)
);

-- Transactional outbox + dedup: the unique insert is the commit gate that authorizes one send.
CREATE TABLE IF NOT EXISTS fired_transitions (
  id                 BIGSERIAL PRIMARY KEY,
  watch_id           TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  transition         TEXT NOT NULL,
  revision           TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('CATCH','ALL_CLEAR','CANNOT_CONFIRM','DEFINITE_MISS','CANCELLED')),
  lead_time_minutes  INTEGER,
  useful_lead        BOOLEAN,
  delivery_status    TEXT NOT NULL DEFAULT 'attempting'
                       CHECK (delivery_status IN ('attempting','sent','failed','no_device')),
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watch_id, transition, revision)
);

-- One outcome row per watch. Non-response is explicit, never a sentinel.
CREATE TABLE IF NOT EXISTS calibration (
  watch_id             TEXT PRIMARY KEY REFERENCES watches(id) ON DELETE CASCADE,
  actual_arrival       TIMESTAMPTZ,                     -- backfilled first-write-wins when the flight lands
  diverted_to_airport  TEXT,
  self_report_status   TEXT NOT NULL DEFAULT 'pending'
                         CHECK (self_report_status IN ('pending','answered','dismissed','expired','no_channel')),
  outcome              TEXT CHECK (outcome IN ('made','missed','changed')),
  was_useful           BOOLEAN,
  enrichment_state     TEXT NOT NULL DEFAULT 'armed'
                         CHECK (enrichment_state IN ('armed','awaiting_actual','awaiting_self_report','sealed')),
  self_report_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- outcome is present iff the self-report was answered; non-response never masquerades as "missed".
  CONSTRAINT self_report_answered_has_outcome
    CHECK ((self_report_status = 'answered') = (outcome IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_device ON push_subscriptions (device_id);
