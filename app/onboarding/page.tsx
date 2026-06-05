import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { OnboardingWizard } from "@/components/app/OnboardingWizard";
import s from "./onboarding.module.css";

export const metadata: Metadata = { title: "Keeper — Arm your first watch" };

/** Post-auth onboarding (proxy-gated to signed-in users). The wizard arms a real watch via /api/watch. */
export default function OnboardingPage(): React.ReactElement {
  return (
    <div className={s.page}>
      <div className={s.obTop}>
        <div className={s.obTopInner}>
          <Logo href="/dashboard" />
          <Link className={s.obSkip} href="/dashboard">Skip for now</Link>
        </div>
      </div>
      <OnboardingWizard />
    </div>
  );
}
