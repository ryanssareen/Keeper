-- Grant table-level privileges on `onboarding` to the PostgREST roles.
--
-- The Supabase browser/server client operates as the `authenticated` role (via the user JWT).
-- Enabling RLS + an `owner_all` policy is NOT enough on its own: PostgREST first checks base
-- table GRANTs, and `authenticated` was never granted any DML here. Every upsert from
-- saveOnboarding() therefore failed with `permission denied for table onboarding`, and because the
-- client call is fire-and-forget the failure was swallowed — onboarding selections silently never
-- persisted. RLS (`owner_all`) still scopes every row to its owner; these GRANTs are the orthogonal
-- base-privilege layer it sits on top of.
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding TO authenticated;

-- service_role is the trusted server-side key (bypasses RLS) — needed for any admin/maintenance path.
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding TO service_role;
