-- Trip shares: opaque share tokens minting read-only public links to a user's trip status, one row
-- per token. A token is active until revoked_at is set. Scoped to the owning user. Follows the
-- itinerary_items RLS + base-table GRANT pattern.
CREATE TABLE IF NOT EXISTS trip_shares (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT auth.uid()::text,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS trip_shares_user_idx ON trip_shares (user_id);

ALTER TABLE trip_shares ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE so the migration is idempotent (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "owner_all" ON trip_shares;
CREATE POLICY "owner_all" ON trip_shares
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Base-table GRANTs: RLS alone is not enough — PostgREST checks GRANTs first (the documented gotcha).
GRANT SELECT, INSERT, UPDATE, DELETE ON trip_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON trip_shares TO service_role;
