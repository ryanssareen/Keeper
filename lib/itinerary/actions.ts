"use server";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { fetchFlight } from "@/lib/adapters/flight";
import { getArmRateLimiter } from "@/lib/security/ratelimit";
import { generateCandidates, resolveLlmProvider, type GenerationAnchors } from "@/lib/itinerary/generate";
import { deriveTripDates } from "@/lib/itinerary/envelope";
import { assembleItinerary } from "@/lib/itinerary/assemble";
import { isItemStatus, type ItineraryPrefs } from "@/lib/itinerary/itinerary";
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
export async function generateItinerary(prefs?: ItineraryPrefs): Promise<ItineraryResult> {
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

  // Persist the refinements alongside the trip (best-effort) so a reload / regenerate keeps them. Only
  // touch `answers` — never `completed`/`step` — so this can't disturb onboarding state.
  const effectivePrefs = prefs ?? answers.itineraryPrefs;
  if (prefs) {
    const { error: prefErr } = await supabase
      .from("onboarding")
      .update({ answers: { ...answers, itineraryPrefs: prefs }, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (prefErr) console.error("[itinerary] failed to persist prefs:", prefErr.message);
  }

  // Prefer the trip's real dates; if none are derivable at all (a legacy/date-less trip), assume a short
  // trip rather than dead-ending — the UI already promises this ("we'll assume a short trip"). The
  // advisory tells the user their dates were assumed so they can tighten them.
  const dates =
    deriveTripDates(answers) ?? {
      startDate: DateTime.now().toISODate()!,
      endDate: DateTime.now().plus({ days: 2 }).toISODate()!,
      assumed: ["trip dates (none set — assumed a 3-day trip starting today; add dates for tighter planning)"],
    };

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
    prefs: effectivePrefs,
  };

  const provider = resolveLlmProvider();
  const gen = await generateCandidates(anchors);
  if (gen.kind === "rate_limited") return { ok: false, error: "Generation is busy right now — try again shortly." };
  if (gen.kind !== "ok") {
    console.error(
      `[itinerary] generation failed ${JSON.stringify({
        provider,
        city: anchors.city,
        days: anchors.days.length,
        kind: gen.kind,
        message: gen.kind === "error" ? gen.message : undefined,
      })}`,
    );
    return { ok: false, error: "Couldn’t generate an itinerary — please try again." };
  }

  const candidateCount = gen.data.days.reduce((n, d) => n + d.places.length, 0);
  // A stub provider in production means GROQ_API_KEY isn't set — the stub emits generic placeholder
  // places that can't geocode, so the whole run drops. Flag it loudly; it's a config issue, not a bug.
  if (provider === "stub") {
    console.warn(`[itinerary] using STUB generator (GROQ_API_KEY unset) — places will likely fail geocoding`);
  }

  // Defensive: geocoding/scheduling does network + date math; a thrown error here would otherwise reject
  // the whole server action (the client shows a generic "Something went wrong"). Catch it and degrade.
  let assembled;
  try {
    assembled = await assembleItinerary(gen.data, {
      city: answers.dest,
      startDate: dates.startDate,
      endDate: dates.endDate,
      arrivalInstant,
      assumed: dates.assumed,
    });
  } catch (e) {
    console.error(`[itinerary] assemble threw: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return { ok: false, error: "Couldn’t build your itinerary just now — please try again." };
  }
  const { items, dropped, dropResolve, dropEnvelope, advisories } = assembled;

  console.info(
    `[itinerary] run ${JSON.stringify({
      provider,
      city: anchors.city,
      days: anchors.days.length,
      candidates: candidateCount,
      dropResolve,
      dropEnvelope,
      kept: items.length,
    })}`,
  );

  // Don't wipe an existing itinerary when generation produced nothing usable — e.g. a geocoder outage
  // made every candidate drop. Surface it and leave the stored plan intact rather than replacing it
  // with an empty one (the silent-wipe the review flagged). Distinguish the two failure shapes so the
  // message points at the real cause: places that wouldn't verify vs. places that wouldn't fit the dates.
  if (items.length === 0) {
    if (dropResolve > 0 && dropEnvelope === 0) {
      return {
        ok: false,
        error: "We couldn’t verify any of the suggested places just now — your itinerary is unchanged. Try again shortly.",
      };
    }
    if (dropEnvelope > 0) {
      return {
        ok: false,
        error: "We found places but none fit within your trip dates — check your travel dates and try again.",
      };
    }
    return { ok: false, error: "We couldn’t build an itinerary from your trip details yet." };
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

  // `.select()` returns the rows actually deleted — so a 0-row delete (e.g. an RLS/grant mismatch that
  // Postgres reports without an error) surfaces as a real failure instead of a silent "success" that
  // leaves the item on screen.
  const { data, error } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    console.error("[itinerary] delete failed:", error.message);
    return { ok: false, error: "Couldn’t remove that item — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn(`[itinerary] delete removed 0 rows ${JSON.stringify({ id })}`);
    return { ok: false, error: "Couldn’t remove that item — please reload and try again." };
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

  const { data, error } = await supabase
    .from("itinerary_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    console.error("[itinerary] status update failed:", error.message);
    return { ok: false, error: "Couldn’t update that item — please try again." };
  }
  if (!data || data.length === 0) {
    console.warn(`[itinerary] status update changed 0 rows ${JSON.stringify({ id, status })}`);
    return { ok: false, error: "Couldn’t update that item — please reload and try again." };
  }
  revalidatePath("/trips/itinerary");
  return { ok: true };
}
