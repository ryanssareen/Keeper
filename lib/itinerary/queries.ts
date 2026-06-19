import { createClient } from "@/lib/supabase/server";
import { isItemKind, isItemStatus, type ItineraryItem } from "@/lib/itinerary/itinerary";

/**
 * Server-only itinerary reads. Directiveless (NOT "use server") so a Server Component calls it as a
 * plain async query and keeps cookie context — never invoked from a client component.
 */

type ItineraryRow = {
  id: string;
  day: string;
  start_ts: string | null;
  end_ts: string | null;
  title: string;
  place_name: string;
  description?: string | null;
  lat: number;
  lng: number;
  iana_zone: string;
  kind: string;
  status: string;
  created_at: string;
};

function mapRow(r: ItineraryRow): ItineraryItem {
  return {
    id: r.id,
    title: r.title,
    placeName: r.place_name,
    description: r.description ?? undefined,
    lat: r.lat,
    lng: r.lng,
    ianaZone: r.iana_zone,
    kind: isItemKind(r.kind) ? r.kind : "other",
    day: r.day,
    startTs: r.start_ts,
    endTs: r.end_ts,
    status: isItemStatus(r.status) ? r.status : "planned",
    createdAt: r.created_at,
  };
}

const COLS = "id, day, start_ts, end_ts, title, place_name, description, lat, lng, iana_zone, kind, status, created_at";
const COLS_NO_DESC = COLS.replace(", description", "");
/** True when an error is PostgREST not knowing the `description` column yet (migration not applied). */
const isMissingDescription = (msg?: string): boolean =>
  Boolean(msg && /description/i.test(msg) && /(does not exist|schema cache|column)/i.test(msg));

/** The current user's itinerary, ordered by day then start time. RLS scopes the query to its owner. */
export async function loadItinerary(): Promise<ItineraryItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const run = (cols: string) =>
    supabase
      .from("itinerary_items")
      .select(cols)
      .eq("user_id", user.id)
      .order("day", { ascending: true })
      .order("start_ts", { ascending: true });

  let { data, error } = await run(COLS);
  // Back-compat: if the `description` column hasn't been migrated yet, re-read without it rather than fail.
  if (error && isMissingDescription(error.message)) {
    ({ data, error } = await run(COLS_NO_DESC));
  }
  if (error) {
    console.error("[itinerary] load failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as ItineraryRow[]).map((r) => mapRow(r));
}
