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

/** The current user's itinerary, ordered by day then start time. RLS scopes the query to its owner. */
export async function loadItinerary(): Promise<ItineraryItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("itinerary_items")
    .select("id, day, start_ts, end_ts, title, place_name, lat, lng, iana_zone, kind, status, created_at")
    .eq("user_id", user.id)
    .order("day", { ascending: true })
    .order("start_ts", { ascending: true });

  if (error) {
    console.error("[itinerary] load failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: ItineraryRow) => mapRow(r));
}
