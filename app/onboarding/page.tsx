import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { OnboardingWizard } from "@/components/app/OnboardingWizard";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { skipOnboarding } from "@/lib/onboarding/actions";
import s from "./onboarding.module.css";

export const metadata: Metadata = { title: "Keeper — Set up your trip" };

export default async function OnboardingPage(): Promise<React.ReactElement> {
  const saved = await loadOnboarding();
  return (
    <div className={s.page}>
      <div className={s.obTop}>
        <div className={s.obTopInner}>
          <Logo href="/dashboard" />
          {/* Skip writes a marker row (see skipOnboarding) so the dashboard won't bounce the user
              straight back into onboarding — otherwise "Skip for now" would loop. */}
          <form action={skipOnboarding}>
            <button className={s.obSkip} type="submit">Skip for now</button>
          </form>
        </div>
      </div>
      <OnboardingWizard initialAnswers={saved?.answers} initialStep={saved?.step} />
    </div>
  );
}
