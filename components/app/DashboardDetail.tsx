import type {
  CatchHistoryEntry,
  OutcomeView,
  TimelineEntry,
  WatchView,
} from "@/lib/calibration/dashboard";
import type { FiredKind, Verdict, WatchState } from "@/lib/engine/types";
import type { DeliveryStatus } from "@/lib/calibration/types";
import { formatInZone, formatUtc } from "@/lib/format/time";
import s from "./dashboard.module.css";

/* ------------------------------------------------------------- presentation */

interface Hero {
  pill: string; // pill class
  surface: string; // global state surface class, or "" for neutral (module heroNeutral)
  neutral: boolean;
  headline: string;
  detail: string;
  advice: boolean;
}

const HERO: Record<WatchState, Hero> = {
  OK: { pill: "pill-solid-ok", surface: "state-ok", neutral: false, headline: "On track — comfortable", detail: "Comfortable slack to your commitment. We’re watching the flight for any cascade and will catch it early if anything slips.", advice: false },
  AT_RISK: { pill: "pill-solid-risk", surface: "state-risk", neutral: false, headline: "Running tight", detail: "The margin has narrowed. Not a miss yet — we’re watching closely and will catch it early.", advice: true },
  MISS_PREDICTED: { pill: "pill-solid-miss", surface: "state-miss", neutral: false, headline: "You’re predicted to miss it", detail: "On the current arrival you won’t reach your commitment in time. Act now while there’s lead.", advice: true },
  DEFINITE_MISS: { pill: "pill-solid-miss", surface: "state-miss", neutral: false, headline: "The commitment has passed", detail: "Your deadline came while the flight was still en route. This watch is closed.", advice: false },
  DEGRADED: { pill: "pill-unsure", surface: "state-unsure", neutral: false, headline: "Can’t confirm right now", detail: "The flight feed is stale or unusable, so we won’t assert a miss from missing data. Re-checking soon.", advice: false },
  RECOVERED: { pill: "pill-neutral", surface: "", neutral: true, headline: "Back on track", detail: "Slack returned and held. You’re clear of the earlier risk.", advice: false },
  CANCELLED: { pill: "pill-neutral", surface: "", neutral: true, headline: "Flight cancelled", detail: "The flight was cancelled. This watch is closed.", advice: false },
  LANDED_CAPTURE: { pill: "pill-neutral", surface: "", neutral: true, headline: "Flight landed", detail: "The aircraft is down. We’re capturing the outcome to close the loop.", advice: false },
};

const STATE_LABELS: Record<WatchState, string> = {
  OK: "On track",
  AT_RISK: "At risk",
  MISS_PREDICTED: "Miss predicted",
  RECOVERED: "Recovered",
  DEGRADED: "Can’t confirm",
  CANCELLED: "Cancelled",
  DEFINITE_MISS: "Definite miss",
  LANDED_CAPTURE: "Landed",
};

/** Render one watch's full lifecycle in the design's detail style. `solo` centers it (capability path). */
export function DashboardDetail({
  view,
  solo = false,
  selfReport,
}: {
  view: WatchView;
  solo?: boolean;
  selfReport?: React.ReactNode;
}): React.ReactElement {
  const hero = HERO[view.state];
  const latestSlack = view.timeline[0]?.slackMinutes ?? null;

  return (
    <div className={solo ? s.solo : s.detail}>
      <div className={s.dHeader}>
        <span className="k-label">Keeper · watch{view.outcome?.sealed ? " · closed" : ""}</span>
        <h1>
          {view.flightNumber} <span className={s.arr}>→</span> {view.placeLabel}
        </h1>
        <p className={s.when}>
          Be there by{" "}
          <b>
            <time dateTime={view.commitmentInstantUtc}>
              {formatInZone(view.commitmentInstantUtc, view.zone, "datetime-24h")}
            </time>
          </b>{" "}
          · <span className="mono">{view.zone}</span>
        </p>
      </div>

      {/* status hero */}
      <div className={`${s.hero} ${hero.neutral ? s.heroNeutral : hero.surface}`}>
        <div className={s.row}>
          <span className={`pill ${hero.pill} pill-dot`}>{STATE_LABELS[view.state]}</span>
          <span className={s.live}>live status</span>
        </div>
        <h2>{hero.headline}</h2>
        <p>{hero.detail}</p>
        {hero.advice ? (
          <div className={s.advice} style={{ borderColor: view.state === "AT_RISK" ? "var(--amber-200)" : "var(--red-200)" }}>
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none" style={{ marginTop: 1, flex: "0 0 auto" }}>
              <path d="M8 1.5 9.6 6h4.4l-3.6 2.6 1.4 4.4L8 10.4 4.2 13l1.4-4.4L2 6h4.4L8 1.5Z" stroke={view.state === "AT_RISK" ? "#d97706" : "#dc2626"} strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
            <div>
              <span className="k-label" style={{ color: view.state === "AT_RISK" ? "var(--amber-600)" : "var(--red-600)" }}>Do this now</span>
              <p>Act while there’s still lead — push or hold the commitment, and tell whoever’s waiting. The dashboard keeps the full record either way.</p>
            </div>
          </div>
        ) : null}
      </div>

      {/* facts */}
      <dl className={s.facts}>
        <Fact label="Arrival airport" value={view.arrivalAirport ?? "—"} hint={view.lastFetchedAt ? "live" : "baseline"} />
        <Fact label="Airport → place" value={`${view.transitMinutes} min`} hint={view.transitSource === "osrm" ? "live route" : "manual buffer"} />
        <Fact label="Slack" value={formatSlack(latestSlack)} hint={slackHint(latestSlack)} valueColor={slackColor(latestSlack)} />
        <Fact label="Reschedulable" value={view.reschedulable ? "Yes" : "Fixed"} hint={view.reschedulable ? "can be moved" : "hard window"} />
      </dl>

      {/* outcome */}
      {view.outcome ? <Outcome outcome={view.outcome} /> : null}

      {/* self-report (interactive form passed in only on the capability path) */}
      {selfReport}

      {/* catch history */}
      <section className={s.sec}>
        <div className={s.secHead}>
          <h3>Catch history</h3>
          <span className={s.meta}>{view.catchHistory.length === 0 ? "no alerts yet" : `${view.catchHistory.length} alert${view.catchHistory.length === 1 ? "" : "s"}`}</span>
        </div>
        {view.catchHistory.length === 0 ? (
          <div className={s.empty}>Nothing has fired. We’ll surface every alert here — delivered or not — so this page is a complete record even if a push slips past your device.</div>
        ) : (
          <div className={s.catchList}>
            {view.catchHistory.map((e) => (
              <CatchRow key={`${e.transition}:${e.revision}`} e={e} />
            ))}
          </div>
        )}
      </section>

      {/* timeline */}
      <section className={s.sec}>
        <div className={s.secHead}>
          <h3>Prediction timeline</h3>
          <span className={s.meta}>{view.timeline.length} snapshot{view.timeline.length === 1 ? "" : "s"}</span>
        </div>
        {view.timeline.length === 0 ? (
          <div className={s.empty}>No predictions recorded yet.</div>
        ) : (
          <div className={s.timeline}>
            {view.timeline.map((e) => (
              <TimelineRow key={e.revision} e={e} />
            ))}
          </div>
        )}
      </section>

      <p className={s.footerNote}>
        This page is your record of the watch — it stays accurate even if a push notification never
        reached your device.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- fragments */

function Fact({ label, value, hint, valueColor }: { label: string; value: string; hint?: string; valueColor?: string }): React.ReactElement {
  return (
    <div className={s.f}>
      <span className="k-label">{label}</span>
      <div className={s.v} style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {hint ? <div className={s.h}>{hint}</div> : null}
    </div>
  );
}

function Outcome({ outcome }: { outcome: OutcomeView }): React.ReactElement {
  return (
    <div className={s.outcome}>
      <div className={s.outcomeHead}>
        <h3>Outcome</h3>
        <span className={`pill ${outcome.sealed ? "pill-solid-ink" : "pill-neutral"}`}>{outcome.sealed ? "Sealed" : "In progress"}</span>
      </div>
      <dl className={s.outcomeFacts}>
        <div><dt>Made it?</dt><dd>{outcomeLabel(outcome)}</dd></div>
        <div><dt>Self-report</dt><dd>{selfReportLabel(outcome.selfReportStatus)}</dd></div>
        <div><dt>Actual arrival</dt><dd>{outcome.actualArrivalUtc ? <time dateTime={outcome.actualArrivalUtc}>{formatUtc(outcome.actualArrivalUtc)}</time> : "—"}</dd></div>
      </dl>
    </div>
  );
}

function CatchRow({ e }: { e: CatchHistoryEntry }): React.ReactElement {
  return (
    <div className={s.catchItem}>
      <span className="badge" style={KIND_STYLE[e.kind]}>{e.kind}</span>
      <span className={s.trans}>{e.transition}</span>
      <span className={s.right}>
        {e.leadTimeMinutes !== null ? (
          <span className={e.usefulLead ? s.leadGood : undefined} style={e.usefulLead ? undefined : { color: "var(--text-muted)" }}>
            {e.leadTimeMinutes} min lead{e.usefulLead ? " · useful" : ""}
          </span>
        ) : null}
        <DeliveryBadge status={e.deliveryStatus} />
      </span>
      <span className={s.stamp}>{e.firedAt ? <time dateTime={e.firedAt}>{formatUtc(e.firedAt)}</time> : "not yet delivered"}</span>
    </div>
  );
}

function TimelineRow({ e }: { e: TimelineEntry }): React.ReactElement {
  return (
    <div className={s.tlItem}>
      <span className={s.tlDot} style={{ background: verdictDot(e.verdict) }} />
      <div className={s.tlRow}>
        <span className={s.st}>{STATE_LABELS[e.resultingState]}</span>
        <span className={s.tlVerdict} style={{ color: verdictColor(e.verdict) }}>{e.verdict}</span>
        {e.firedTransition ? <span className={s.tlFired}>fired {e.firedTransition}</span> : null}
      </div>
      <div className={s.tlMeta}>
        {e.slackMinutes === null ? "Slack indeterminate" : e.slackMinutes >= 0 ? `${e.slackMinutes} min slack` : `${Math.abs(e.slackMinutes)} min deficit`}
        {" · "}
        <time dateTime={e.fetchedAt}>{formatUtc(e.fetchedAt)}</time>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

const KIND_STYLE: Record<FiredKind, React.CSSProperties> = {
  CATCH: { background: "var(--red-100)", color: "var(--red-700)" },
  ALL_CLEAR: { background: "var(--emerald-100)", color: "var(--emerald-700)" },
  CANNOT_CONFIRM: { background: "var(--slate-200)", color: "var(--slate-600)" },
  DEFINITE_MISS: { background: "var(--red-200)", color: "var(--red-950)" },
  CANCELLED: { background: "var(--zinc-200)", color: "var(--zinc-700)" },
};

const DELIVERY: Partial<Record<DeliveryStatus, { label: string; bg: string; fg: string }>> = {
  sent: { label: "Sent", bg: "var(--emerald-50)", fg: "var(--emerald-700)" },
  attempting: { label: "Sending…", bg: "var(--amber-50)", fg: "var(--amber-600)" },
  sending: { label: "Sending…", bg: "var(--amber-50)", fg: "var(--amber-600)" },
  failed: { label: "Failed", bg: "var(--red-50)", fg: "var(--red-600)" },
  no_device: { label: "No device", bg: "var(--zinc-100)", fg: "var(--zinc-600)" },
};

function DeliveryBadge({ status }: { status: DeliveryStatus }): React.ReactElement {
  const m = DELIVERY[status] ?? { label: "In progress", bg: "var(--amber-50)", fg: "var(--amber-600)" };
  return <span className="badge" style={{ background: m.bg, color: m.fg }}>{m.label}</span>;
}

function verdictDot(v: Verdict): string {
  return v === "make" ? "var(--emerald-500)" : v === "miss" ? "var(--red-500)" : "var(--slate-400)";
}
function verdictColor(v: Verdict): string {
  return v === "make" ? "var(--emerald-600)" : v === "miss" ? "var(--red-600)" : "var(--amber-600)";
}
function formatSlack(min: number | null): string {
  if (min === null) return "—";
  const sign = min < 0 ? "−" : "+";
  const abs = Math.abs(min);
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${h}h${m ? ` ${m}m` : ""}`;
  }
  return `${sign}${abs} min`;
}
function slackColor(min: number | null): string | undefined {
  if (min === null) return "var(--text-muted)";
  if (min < 0) return "var(--red-600)";
  if (min < 30) return "var(--amber-600)";
  return "var(--emerald-600)";
}
function slackHint(min: number | null): string {
  if (min === null) return "indeterminate";
  if (min < 0) return "deficit";
  if (min < 30) return "tight";
  return "comfortable";
}
function outcomeLabel(o: OutcomeView): string {
  if (o.outcome === "made") return "Made it";
  if (o.outcome === "missed") return "Missed";
  if (o.outcome === "changed") return "Plans changed";
  return "—";
}
function selfReportLabel(status: string): string {
  const map: Record<string, string> = { pending: "Awaiting reply", answered: "Answered", dismissed: "Dismissed", expired: "Expired", no_channel: "No channel" };
  return map[status] ?? status;
}
