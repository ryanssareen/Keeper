-- User preferences: one row per user holding redesigned-app UI + notification settings
-- (theme, accent color, cascade/quiet-hours/share toggles). Keyed directly on user_id so each
-- user has at most one preferences row. Follows the itinerary_items RLS + base-table GRANT pattern.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id        TEXT PRIMARY KEY DEFAULT auth.uid()::text,
  theme          TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
  accent         TEXT NOT NULL DEFAULT 'emerald' CHECK (accent IN ('emerald','teal','indigo','violet')),
  notify_cascade BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours    BOOLEAN NOT NULL DEFAULT TRUE,
  share_status   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE so the migration is idempotent (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "owner_all" ON user_preferences;
CREATE POLICY "owner_all" ON user_preferences
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Base-table GRANTs: RLS alone is not enough — PostgREST checks GRANTs first (the documented gotcha).
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO service_role;
