import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import {
  loadWatchesForUser,
  loadWatchForView,
  buildWatchView,
  type WatchSummary,
} from "@/lib/calibration/dashboard";
import { loadChecklist } from "@/lib/checklist/queries";
import { checklistProgress } from "@/lib/checklist/checklist";
import { buildCatchModel } from "@/lib/alerts/catch";
import { THEME_COOKIE, isTheme } from "@/lib/preferences/preferences";
import { AppChrome } from "@/components/app/AppChrome";
import type { TopbarTitle } from "@/components/app/Topbar";

/** Watches whose live state means a downstream commitment is threatened right now. */
const RISK_STATES = new Set(["AT_RISK", "MISS_PREDICTED"]);
const isRisk = (w: WatchSummary) => !w.terminal && RISK_STATES.has(w.state);

function initialOf(name: string, email: string): string {
  const src = name || email || "K";
  return src.trim().charAt(0).toUpperCase() || "K";
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** "Jun 18–23" from two YYYY-MM-DD strings (best-effort; tolerates missing/odd input). */
function dateRange(start?: string, end?: string): string {
  const fmt = (s?: string) => {
    if (!s) return "";
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  };
  const a = fmt(start);
  const b = end ? new Date(`${end}T00:00:00`).getDate() : null;
  if (a && b) return `${a}–${b}`;
  return a || "Your dates";
}

function dayCount(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/today");

  // The command center assumes a trip exists. A brand-new account (or one mid-setup) is sent to finish
  // onboarding first — mirrors the old dashboard's guard.
  const onboarding = await loadOnboarding();
  if (!onboarding || !onboarding.completed) redirect("/onboarding");

  const answers = onboarding.answers ?? {};
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const email = user.email ?? "";
  const tripLabel = (typeof answers.dest === "string" && answers.dest) || "Your trip";

  const watches = await loadWatchesForUser(user.id);
  const risky = watches.filter(isRisk);
  const alertCount = risky.length;

  // Only pay for the full watch view when something is actually at risk (it powers the catch modal).
  let catchModel = null;
  if (risky[0]) {
    const loaded = await loadWatchForView(risky[0].id);
    if (loaded.status === "ok") {
      catchModel = buildCatchModel(
        buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration),
      );
    }
  }

  const progress = checklistProgress(await loadChecklist());
  const nDays = dayCount(answers.startDate, answers.endDate);

  const titles: Record<string, TopbarTitle> = {
    "/today": {
      kick: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date()),
      title: `${greeting()}${name ? `, ${name.split(" ")[0]}` : ""}`,
    },
    "/itinerary": {
      kick: nDays ? `${tripLabel} · ${nDays}-day plan` : `${tripLabel} · plan`,
      title: "Itinerary",
    },
    "/bookings": {
      kick: `${(typeof answers.country === "string" && answers.country) || "Trip"} · ${dateRange(answers.startDate, answers.endDate)}`,
      title: tripLabel,
    },
    "/alerts": {
      kick: `${watches.length} watched · ${alertCount} active`,
      title: "Alerts",
    },
    "/checklist": {
      kick: `Pre-trip · ${progress.done} of ${progress.total} done`,
      title: "Checklist",
    },
    "/settings": {
      kick: `Account · ${name || email || "Keeper"}`,
      title: "Settings",
    },
  };

  const jar = await cookies();
  const themeCookie = jar.get(THEME_COOKIE)?.value;
  const initialTheme = isTheme(themeCookie) ? themeCookie : "light";

  return (
    <AppChrome
      user={{ name, email, initial: initialOf(name, email), plan: email || "Keeper account" }}
      tripLabel={tripLabel}
      alertCount={alertCount}
      titles={titles}
      catchModel={catchModel}
      initialTheme={initialTheme}
    >
      {children}
    </AppChrome>
  );
}
