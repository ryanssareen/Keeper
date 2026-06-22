-- Checklist items: user-authored packing/prep to-do entries for the redesigned app, one row per
-- item, ordered by sort_order within a user. Scoped to the owning user. Follows the itinerary_items
-- RLS + base-table GRANT pattern.
CREATE TABLE IF NOT EXISTS checklist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL DEFAULT auth.uid()::text,
  label       TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_items_user_idx ON checklist_items (user_id, sort_order);

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE so the migration is idempotent (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "owner_all" ON checklist_items;
CREATE POLICY "owner_all" ON checklist_items
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Base-table GRANTs: RLS alone is not enough — PostgREST checks GRANTs first (the documented gotcha).
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO service_role;
