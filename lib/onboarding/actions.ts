"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryPrefs } from "@/lib/itinerary/itinerary";

export type OnboardingAnswers = {
  trip: string;
  party: string;
  dest: string;
  country: string;
  code: string;
  startDate: string; // trip start (depart) — YYYY-MM-DD, mandatory
  endDate: string; // trip end (return) — YYYY-MM-DD, mandatory
  flight: string;
  flightNo: string;
  flightDate: string;
  seat?: string;
  hotel: string;
  hotelName: string;
  hotelIn: string;
  hotelOut: string;
  itineraryPrefs?: ItineraryPrefs; // optional refinements for itinerary generation (set on the itinerary page)
  // Per-stop one-line descriptions, keyed by place name. Stored here (a flexible JSON blob) so the feature
  // needs no DB migration on itinerary_items — looked up by place when rendering the plan.
  itineraryDescriptions?: Record<string, string>;
};

export type OnboardingRow = {
  answers: Partial<OnboardingAnswers>;
  step: number;
  completed: boolean;
};

export async function saveOnboarding(
  answers: Partial<OnboardingAnswers>,
  step: number,
  completed = false,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // Only EVER write `completed` when finalizing (completed === true). Intermediate step autosaves are
  // fire-and-forget, so one entering the last step can land AFTER the final submit's completed=true
  // write and — if it carried completed=false — flip a just-finished trip back to incomplete, making
  // it silently vanish from the dashboard. Re-opening a finished trip's onboarding had the same effect.
  // Omitting the column on autosave means an upsert UPDATE never touches it (and a fresh INSERT uses
  // the table default FALSE), so completion is monotonic and can't be clobbered by a late autosave.
  const row: {
    user_id: string;
    answers: Partial<OnboardingAnswers>;
    step: number;
    updated_at: string;
    completed?: boolean;
  } = {
    user_id: user.id,
    answers,
    step,
    updated_at: new Date().toISOString(),
  };
  if (completed) row.completed = true;

  const { error } = await supabase.from("onboarding").upsert(row, { onConflict: "user_id" });

  // Never let a persistence failure pass silently again: the client calls this fire-and-forget, so a
  // swallowed error (e.g. a missing table GRANT) once made onboarding selections vanish with no
  // signal anywhere. Surface it in server logs and report status so callers can react if they choose.
  if (error) {
    console.error("[onboarding] failed to persist answers:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * "Skip for now" from the onboarding wizard. Persists a minimal marker row (no `completed`, so it does
 * not pretend the trip is set up) and returns to the dashboard. The marker matters: a brand-new account
 * with NO onboarding row is bounced into onboarding by the dashboard (so signup leads to onboarding,
 * not the empty "no trips" dead-end) — writing a row here records that the user has been offered
 * onboarding and chose to skip, so the dashboard shows its empty-state CTA instead of looping back.
 */
export async function skipOnboarding(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("onboarding").upsert(
      { user_id: user.id, step: 0, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  }
  redirect("/dashboard");
}
