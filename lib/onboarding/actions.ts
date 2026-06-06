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
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("onboarding").upsert(
    {
      user_id: user.id,
      answers,
      step,
      completed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
