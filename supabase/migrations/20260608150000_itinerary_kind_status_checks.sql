-- Defense-in-depth: constrain kind/status at the DB layer (previously app-enforced only via the
-- TypeScript guards). Idempotent. Existing rows already satisfy these.
ALTER TABLE itinerary_items DROP CONSTRAINT IF EXISTS itinerary_items_kind_chk;
ALTER TABLE itinerary_items ADD  CONSTRAINT itinerary_items_kind_chk
  CHECK (kind IN ('sight','food','activity','transport','other'));

ALTER TABLE itinerary_items DROP CONSTRAINT IF EXISTS itinerary_items_status_chk;
ALTER TABLE itinerary_items ADD  CONSTRAINT itinerary_items_status_chk
  CHECK (status IN ('planned','completed','missed','rescheduled'));
