import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { loadWatchesForUser, loadWatchForView, buildWatchView, type WatchSummary } from "@/lib/calibration/dashboard";
import { loadChecklist } from "@/lib/checklist/queries";
import { checklistProgress } from "@/lib/checklist/checklist";
import { loadActiveShareToken } from "@/lib/share/queries";
import { buildCatchModel } from "@/lib/alerts/catch";
import s from "./today.module.css";

export const metadata: Metadata = { title: "Keeper — Today" };

const RISK_STATES = new Set(["AT_RISK", "MISS_PREDICTED"]);
const isRisk = (w: WatchSummary) => !w.terminal && RISK_STATES.has(w.state);

export default async function TodayPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return <></>;

  const [onboarding, watches, checklist, shareToken] = await Promise.all([
    loadOnboarding(),
    loadWatchesForUser(user.id),
    loadChecklist(),
    loadActiveShareToken(user.id),
  ]);

  const trip = onboarding?.completed && onboarding.answers?.dest ? onboarding.answers : null;
  const progress = checklistProgress(checklist);
  const risky = watches.filter(isRisk);
  const alertCount = risky.length;

  // Full watch view for the status card
  let watchView = null;
  let catchModel = null;
  if (risky[0]) {
    const loaded = await loadWatchForView(risky[0].id);
    if (loaded.status === "ok") {
      watchView = buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration);
      catchModel = buildCatchModel(watchView);
    }
  }

  const watch = risky[0] ?? watches.find((w) => !w.terminal) ?? watches[0] ?? null;
  const stateLabel = watch ? stateText(watch.state) : null;
  const stateTone = watch ? stateToneOf(watch.state) : "neutral";

  return (
    <div className={s.page}>
      {/* Alert banner */}
      {alertCount > 0 ? (
        <Link href="?catch=1" className={s.alertBanner} scroll={false}>
          <span className={s.alertDot} />
          <span className={s.alertText}>
            {alertCount === 1 ? "1 active alert" : `${alertCount} active alerts`} — cascade detected
          </span>
          <span className={s.alertCta}>Review now →</span>
        </Link>
      ) : null}

      {/* Status hero */}
      <div className={`${s.hero} ${s[`hero_${stateTone}`]}`}>
        <div className={s.heroInner}>
          <span className={s.heroPill}>
            <span className={s.heroDot} />
            {watch ? "Live watch" : "No active watch"}
          </span>
          <h1 className={s.heroH}>{heroHeadline(watch, trip?.dest)}</h1>
          <p className={s.heroSub}>{heroSub(watch, stateLabel)}</p>
          {watch ? (
            <div className={s.heroMeta}>
              <span className={s.heroFlight}>{watch.flightNumber}</span>
              <span className={s.heroDivider}>→</span>
              <span className={s.heroPlace}>{watch.placeLabel}</span>
            </div>
          ) : null}
        </div>
        <div className={s.heroActions}>
          {catchModel ? (
            <Link className={s.btnPrimary} href="?catch=1" scroll={false}>See cascade detail</Link>
          ) : (
            <Link className={s.btnGhost} href="/alerts">Alert history</Link>
          )}
          <Link className={s.btnGhost} href="/itinerary">View plan</Link>
        </div>
      </div>

      {/* Cards row */}
      <div className={s.cards}>
        {/* Checklist */}
        <Link href="/checklist" className={`${s.card} ${s.cardLink}`}>
          <span className="k-eyebrow">Checklist</span>
          <div className={s.cardStat}>{progress.pct}%</div>
          <div className={s.pbarTrack}><div className={s.pbarFill} style={{ width: `${progress.pct}%` }} /></div>
          <p className={s.cardSub}>{progress.done} of {progress.total} done</p>
        </Link>

        {/* Trip */}
        {trip ? (
          <Link href="/bookings" className={`${s.card} ${s.cardLink}`}>
            <span className="k-eyebrow">Trip</span>
            <div className={s.cardDest}>{trip.dest}</div>
            {trip.startDate ? <p className={s.cardSub}>{fmtDate(trip.startDate)}{trip.endDate ? ` – ${fmtDate(trip.endDate)}` : ""}</p> : null}
          </Link>
        ) : null}

        {/* Sharing */}
        <div className={s.card}>
          <span className="k-eyebrow">Sharing</span>
          {shareToken ? (
            <>
              <div className={s.shareOn}>
                <span className={s.shareDot} />
                <span>Live · family can see status</span>
              </div>
              <Link href={`/shared/${shareToken}`} target="_blank" className={s.shareViewLink}>View family link →</Link>
            </>
          ) : (
            <p className={s.cardSub}>
              <Link href="/settings" className={s.shareSetupLink}>Turn on family sharing</Link> from Settings.
            </p>
          )}
        </div>

        {/* Watches */}
        <Link href="/alerts" className={`${s.card} ${s.cardLink}`}>
          <span className="k-eyebrow">Watches</span>
          <div className={s.cardStat}>{watches.filter((w) => !w.terminal).length}</div>
          <p className={s.cardSub}>
            {alertCount > 0 ? `${alertCount} active alert${alertCount > 1 ? "s" : ""}` : "All quiet"}
          </p>
        </Link>
      </div>
    </div>
  );
}

function heroHeadline(watch: WatchSummary | null, dest?: string): string {
  if (!watch) return dest ? `Your trip to ${dest}` : "You're all set";
  switch (watch.state) {
    case "OK": return "You're on track";
    case "AT_RISK": return "Timing is getting tight";
    case "MISS_PREDICTED": return "Cascade detected";
    case "DEFINITE_MISS": return "You may miss your connection";
    case "RECOVERED": return "Back on track";
    case "CANCELLED": return "Flight cancelled";
    case "DEGRADED": return "Status unconfirmed";
    case "LANDED_CAPTURE": return "Landed";
    default: return "Keeper is watching";
  }
}

function heroSub(watch: WatchSummary | null, label: string | null): string {
  if (!watch) return "No active watch — you're good to go.";
  return label ?? "Keeper is monitoring your downstream commitments.";
}

function stateText(state: string): string {
  switch (state) {
    case "OK": return "Everything looks good — no delays expected.";
    case "AT_RISK": return "Running a little behind — you may be cutting it close.";
    case "MISS_PREDICTED": return "The next commitment is predicted to slip — review the cascade.";
    case "DEFINITE_MISS": return "Your downstream plan won't make it in time.";
    case "RECOVERED": return "Things settled down — you're good for what's next.";
    case "CANCELLED": return "Your flight was cancelled. Sort out a new plan.";
    case "DEGRADED": return "We can't confirm the latest just now — no news isn't bad news.";
    case "LANDED_CAPTURE": return "On the ground and on your way.";
    default: return "Keeper is monitoring your flight and downstream plans.";
  }
}

function stateToneOf(state: string): string {
  if (["OK", "RECOVERED", "LANDED_CAPTURE"].includes(state)) return "ok";
  if (["AT_RISK", "DEGRADED"].includes(state)) return "risk";
  if (["MISS_PREDICTED", "DEFINITE_MISS", "CANCELLED"].includes(state)) return "miss";
  return "neutral";
}

function fmtDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}
