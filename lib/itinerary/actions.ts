"use server";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { fetchFlight } from "@/lib/adapters/flight";
import { getArmRateLimiter } from "@/lib/security/ratelimit";
import { generateCandidates, type GenerationAnchors } from "@/lib/itinerary/generate";
import { deriveTripDates } from "@/lib/itinerary/envelope";
import { assembleItinerary } from "@/lib/itinerary/assemble";
import { isItemStatus } from "@/lib/itinerary/itinerary";
import type { Advisory } from "@/lib/itinerary/feasibility";

export type ItineraryResult =
  | { ok: true; count: number; dropped: number; advisories: Advisory[] }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_DAYS = 14;

/** Inclusive YYYY-MM-DD list from start to end, capped so a malformed range can't explode. */
function eachDate(startDate: string, endDate: string): string[] {
  const start = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);
  if (!start.isValid || !end.isValid || end < start) return [startDate];
  const out: string[] = [];
  for (let d = start; d <= end && out.length < MAX_DAYS; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

/**
 * Generate (or regenerate) the itinerary: derive anchors from the trip, run the gate pipeline
 * (generate → resolve → envelope → feasibility), and replace the user's stored items. Button-triggered
 * (never on render — so it doesn't re-hit Groq on every refresh), per-user rate-limited, and it sends
 * only city + dates + party to Groq (minimum-data, not the raw hotel blob).
 */
export async function generateItinerary(): Promise<ItineraryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  // Best-effort per-user rate limit (no-op when Upstash isn't configured).
  const limiter = getArmRateLimiter();
  if (limiter) {
    const { success } = await limiter.limit(`itinerary:generate:${user.id}`);
    if (!success) return { ok: false, error: "You're generating a lot — give it a minute and try again." };
  }

  const onboarding = await loadOnboarding();
  const answers = onboarding?.completed ? onboarding.answers : null;
  if (!answers?.dest) return { ok: false, error: "Set up your trip first." };

  const dates = deriveTripDates(answers);
  if (!dates) return { ok: false, error: "Add your trip dates (a hotel or flight) so we can plan around them." };

  // Raw flight instants for the arrival-day floor (loadTripFlight's view model drops them).
  let arrivalInstant: string | null = null;
  const flightNo = (answers.flightNo ?? "").trim();
  if (answers.flight === "Booked" && flightNo) {
    const fr = await fetchFlight(flightNo.replace(/\s+/g, ""), (answers.flightDate || dates.startDate).slice(0, 10));
    if (fr.kind === "ok") arrivalInstant = fr.data.predictedUtc ?? fr.data.scheduledUtc;
  }

  const anchors: GenerationAnchors = {
    city: answers.dest,
    country: answers.country ?? "",
    days: eachDate(dates.startDate, dates.endDate),
    party: answers.party ?? "Solo",
  };

  const gen = await generateCandidates(anchors);
  if (gen.kind === "rate_limited") return { ok: false, error: "Generation is busy right now — try again shortly." };
  if (gen.kind !== "ok") return { ok: false, error: "Couldn’t generate an itinerary — please try again." };

  const { items, dropped, advisories } = await assembleItinerary(gen.data, {
    city: answers.dest,
    startDate: dates.startDate,
    endDate: dates.endDate,
    arrivalInstant,
    assumed: dates.assumed,
  });

  // Don't wipe an existing itinerary when generation produced nothing usable — e.g. a geocoder outage
  // made every candidate drop. Surface it and leave the stored plan intact rather than replacing it
  // with an empty one (the silent-wipe the review flagged).
  if (items.length === 0) {
    return {
      ok: false,
      error:
        dropped > 0
          ? "We couldn’t verify any of the suggested places just now — your itinerary is unchanged. Try again shortly."
          : "We couldn’t build an itinerary from your trip details yet.",
    };
  }

  // Regenerate replaces: clear the user's items, then insert the fresh set.
  const { error: delErr } = await supabase.from("itinerary_items").delete().eq("user_id", user.id);
  if (delErr) {
    console.error("[itinerary] clear failed:", delErr.message);
    return { ok: false, error: "Couldn’t save the itinerary — please try again." };
  }
  {
    const rows = items.map((i) => ({
      user_id: user.id,
      day: i.day,
      start_ts: i.startTs,
      end_ts: i.endTs,
      title: i.title,
      place_name: i.placeName,
      lat: i.lat,
      lng: i.lng,
      iana_zone: i.ianaZone,
      kind: i.kind,
      status: "planned",
    }));
    const { error: insErr } = await supabase.from("itinerary_items").insert(rows);
    if (insErr) {
      console.error("[itinerary] insert failed:", insErr.message);
      return { ok: false, error: "Couldn’t save the itinerary — please try again." };
    }
  }

  revalidatePath("/trips/itinerary");
  return { ok: true, count: items.length, dropped, advisories };
}

/** Remove one item. Scoped by id AND user_id (defense-in-depth beyond RLS). */
export async function deleteItineraryItem(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { error } = await supabase.from("itinerary_items").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    console.error("[itinerary] delete failed:", error.message);
    return { ok: false, error: "Couldn’t remove that item — please try again." };
  }
  revalidatePath("/trips/itinerary");
  return { ok: true };
}

/** Set an item's adherence status (planned/completed/missed/rescheduled). Scoped by id AND user_id. */
export async function setItemStatus(id: string, status: string): Promise<ActionResult> {
  if (!isItemStatus(status)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { error } = await supabase
    .from("itinerary_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[itinerary] status update failed:", error.message);
    return { ok: false, error: "Couldn’t update that item — please try again." };
  }
  revalidatePath("/trips/itinerary");
  return { ok: true };
}
