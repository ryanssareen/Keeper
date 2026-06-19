-- Add an optional one-line description to each itinerary item (the "why / what it is" shown under the
-- place name), so the plan reads like a guide instead of a bare checklist. Nullable + IF NOT EXISTS so
-- it is safe to re-run and back-compatible with rows created before the column existed.
ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS description TEXT;
