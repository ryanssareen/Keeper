import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { OnboardingWizard } from "@/components/app/OnboardingWizard";
import { loadOnboarding } from "@/lib/onboarding/queries";
import s from "./onboarding.module.css";

export const metadata: Metadata = { title: "Keeper — Set up your trip" };

export default async function OnboardingPage(): Promise<React.ReactElement> {
  const saved = await loadOnboarding();
  return (
    <div className={s.page}>
      <div className={s.obTop}>
        <div className={s.obTopInner}>
          <Logo href="/dashboard" />
          <Link className={s.obSkip} href="/dashboard">Skip for now</Link>
        </div>
      </div>
      <OnboardingWizard initialAnswers={saved?.answers} initialStep={saved?.step} />
    </div>
  );
}
