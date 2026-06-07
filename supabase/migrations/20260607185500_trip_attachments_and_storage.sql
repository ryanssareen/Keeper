-- Trip attachments: booking documents (flight, hotel, etc.) classified by `kind`, stored in the
-- private `trip-docs` storage bucket. One row per uploaded file, scoped to the owning user.
-- Follows the onboarding table's RLS + GRANT pattern: RLS scopes rows to their owner, and the
-- base-table GRANTs to `authenticated` are the orthogonal privilege layer PostgREST checks first.
CREATE TABLE IF NOT EXISTS trip_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'other',
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_attachments_user_idx ON trip_attachments (user_id, created_at DESC);

ALTER TABLE trip_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON trip_attachments
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON trip_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON trip_attachments TO service_role;

-- Private bucket for the files themselves (RLS on storage.objects is what protects them).
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-docs', 'trip-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Object-level RLS: a user may only touch files under a folder named for their uid ("<uid>/<file>").
CREATE POLICY "trip_docs_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "trip_docs_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "trip_docs_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'trip-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
