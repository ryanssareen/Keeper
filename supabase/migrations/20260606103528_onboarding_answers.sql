-- Onboarding wizard answers, persisted per authenticated user.
-- One row per user, upserted on each step advance. JSONB answers
-- keeps the schema additive — new wizard fields need no migration.
CREATE TABLE IF NOT EXISTS onboarding (
  user_id    TEXT PRIMARY KEY,
  answers    JSONB NOT NULL DEFAULT '{}',
  step       INTEGER NOT NULL DEFAULT 0,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own row.
CREATE POLICY "owner_all" ON onboarding
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);
