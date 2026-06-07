"use server";
import { createClient } from "@/lib/supabase/server";

export type OnboardingAnswers = {
  trip: string;
  party: string;
  dest: string;
  country: string;
  code: string;
  flight: string;
  flightNo: string;
  flightDate: string;
  seat?: string;
  hotel: string;
  hotelName: string;
  hotelIn: string;
  hotelOut: string;
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

  const { error } = await supabase.from("onboarding").upsert(
    {
      user_id: user.id,
      answers,
      step,
      completed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // Never let a persistence failure pass silently again: the client calls this fire-and-forget, so a
  // swallowed error (e.g. a missing table GRANT) once made onboarding selections vanish with no
  // signal anywhere. Surface it in server logs and report status so callers can react if they choose.
  if (error) {
    console.error("[onboarding] failed to persist answers:", error.message);
    return { ok: false };
  }
  return { ok: true };
}
