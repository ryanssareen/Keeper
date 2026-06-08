-- AI itinerary items: booking-anchored, monitorable trip-plan items, one row per item,
-- scoped to the owning user. Follows the trip_attachments RLS + base-table GRANT pattern.
-- Every persisted item is monitorable (resolved to time + place); unresolved candidates are
-- dropped before insert, so lat/lng/iana_zone are NOT NULL by construction.
CREATE TABLE IF NOT EXISTS itinerary_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT auth.uid()::text,
  day         DATE NOT NULL,
  start_ts    TIMESTAMPTZ,
  end_ts      TIMESTAMPTZ,
  title       TEXT NOT NULL,
  place_name  TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  iana_zone   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'other',
  status      TEXT NOT NULL DEFAULT 'planned',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS itinerary_items_user_day_idx ON itinerary_items (user_id, day);

ALTER TABLE itinerary_items ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE so the migration is idempotent (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "owner_all" ON itinerary_items;
CREATE POLICY "owner_all" ON itinerary_items
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Base-table GRANTs: RLS alone is not enough — PostgREST checks GRANTs first (the documented gotcha).
GRANT SELECT, INSERT, UPDATE, DELETE ON itinerary_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON itinerary_items TO service_role;
