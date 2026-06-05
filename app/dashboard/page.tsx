import { verifyToken } from "@/lib/security/capability";
import { buildWatchView, loadWatchForView } from "@/lib/calibration/dashboard";
import type {
  CatchHistoryEntry,
  OutcomeView,
  TimelineEntry,
  WatchView,
} from "@/lib/calibration/dashboard";
import type { DeliveryStatus, SelfReportStatus } from "@/lib/calibration/types";
import type { FiredKind, Verdict, WatchState } from "@/lib/engine/types";
import { WatchStatus } from "@/components/WatchStatus";

/**
 * U10 dashboard (R16, R22) — the in-app mirror and reliability backstop for best-effort push.
 *
 * Renders ONE watch's full lifecycle: live state, resolved place/zone/transit, the catch history
 * (shown first — this is the page a traveler lands on when a push never arrived), and the
 * prediction-snapshot timeline. CAPABILITY-GATED: ?id & ?token come from the URL; we load the
 * watch's owner_token_hash and verify the presented token in constant time. On a missing or wrong
 * token we render a not-authorized view carrying NO watch data. All user text is rendered as React
 * children (auto-escaped) — never dangerouslySetInnerHTML.
 *
 * searchParams is a Promise in Next 16 (Request-time API) and is awaited; reading it opts this page
 * into dynamic rendering, which is correct — it is per-watch, capability-scoped, and never cached.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : undefined;
  const token = typeof params.token === "string" ? params.token : undefined;

  if (!id || !token) {
    return <Gate kind="missing" />;
  }

  const loaded = await loadWatchForView(id);

  // Not-found and bad-token both render the gate with NO watch data. We do not distinguish a
  // missing watch from a wrong token in the copy, so a guesser learns nothing about which it was.
  if (loaded.status === "not_found" || !verifyToken(token, loaded.ownerTokenHash)) {
    return <Gate kind="denied" />;
  }

  const view = buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 font-sans sm:py-14">
      <Header view={view} />
      <div className="mt-6">
        <WatchStatus state={view.state} />
      </div>
      <FactGrid view={view} />
      {view.outcome ? <OutcomeStrip outcome={view.outcome} /> : null}
      <CatchHistory entries={view.catchHistory} />
      <Timeline entries={view.timeline} />
      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs leading-relaxed text-zinc-400 dark:border-zinc-800">
        This page is your record of the watch — it stays accurate even if a push notification never
        reached your device. Bookmark it; the link carries your private access token.
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ header */

function Header({ view }: { view: WatchView }): React.ReactElement {
  return (
    <header>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Keeper · watch</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {view.flightNumber}
        <span className="text-zinc-400"> → </span>
        {view.placeLabel}
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500">
        Be there by{" "}
        <time dateTime={view.commitmentInstantUtc} className="font-medium text-zinc-700 dark:text-zinc-300">
          {formatInZone(view.commitmentInstantUtc, view.zone)}
        </time>{" "}
        <span className="text-zinc-400">({view.zone})</span>
      </p>
    </header>
  );
}

/* --------------------------------------------------------------- fact grid */

function FactGrid({ view }: { view: WatchView }): React.ReactElement {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 text-sm dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-4">
      <Fact label="Arrival airport" value={view.arrivalAirport ?? "—"} />
      <Fact
        label="Airport → place"
        value={`${view.transitMinutes} min`}
        hint={view.transitSource === "osrm" ? "live route" : "manual buffer"}
      />
      <Fact label="Place resolved" value={view.placeResolved ? "Yes" : "Approx"} hint={view.placeResolved ? "geocoded" : "low confidence"} />
      <Fact label="Reschedulable" value={view.reschedulable ? "Yes" : "Fixed"} />
    </dl>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="bg-white p-4 dark:bg-zinc-950">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{value}</dd>
      {hint ? <dd className="mt-0.5 text-[11px] text-zinc-400">{hint}</dd> : null}
    </div>
  );
}

/* ----------------------------------------------------------- outcome strip */

function OutcomeStrip({ outcome }: { outcome: OutcomeView }): React.ReactElement {
  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Outcome</h3>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            outcome.sealed
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {outcome.sealed ? "Sealed" : "In progress"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-zinc-400">Made it?</dt>
          <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">{outcomeLabel(outcome)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-zinc-400">Self-report</dt>
          <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">{selfReportLabel(outcome.selfReportStatus)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-zinc-400">Actual arrival</dt>
          <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
            {outcome.actualArrivalUtc ? (
              <time dateTime={outcome.actualArrivalUtc}>{formatUtc(outcome.actualArrivalUtc)}</time>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {outcome.divertedToAirport ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Diverted to {outcome.divertedToAirport}
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------- catch history */

function CatchHistory({ entries }: { entries: CatchHistoryEntry[] }): React.ReactElement {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Catch history</h3>
        <span className="text-xs text-zinc-400">{entries.length === 0 ? "no alerts yet" : `${entries.length} alert${entries.length === 1 ? "" : "s"}`}</span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
          Nothing has fired. We’ll surface every alert here — delivered or not — so this page is a
          complete record even if a push slips past your device.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map((e) => (
            <li
              key={`${e.transition}:${e.revision}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <KindBadge kind={e.kind} />
              <span className="font-mono text-xs text-zinc-500">{e.transition}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                {e.leadTimeMinutes !== null ? (
                  <span className={e.usefulLead ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
                    {e.leadTimeMinutes} min lead{e.usefulLead ? " · useful" : ""}
                  </span>
                ) : null}
                <DeliveryBadge status={e.deliveryStatus} />
              </span>
              <span className="w-full text-[11px] text-zinc-400">
                {e.firedAt ? <time dateTime={e.firedAt}>{formatUtc(e.firedAt)}</time> : "not yet delivered"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- timeline */

function Timeline({ entries }: { entries: TimelineEntry[] }): React.ReactElement {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Prediction timeline</h3>
        <span className="text-xs text-zinc-400">{entries.length} snapshot{entries.length === 1 ? "" : "s"}</span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No predictions recorded yet.</p>
      ) : (
        <ol className="mt-3 border-l border-zinc-200 dark:border-zinc-800">
          {entries.map((e) => (
            <li key={e.revision} className="relative ml-4 pb-5 last:pb-0">
              <span
                className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-zinc-950 ${verdictDot(e.verdict)}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{stateLabel(e.resultingState)}</span>
                <VerdictTag verdict={e.verdict} />
                {e.firedTransition ? (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
                    fired {e.firedTransition}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {e.slackMinutes === null
                  ? "Slack indeterminate"
                  : e.slackMinutes >= 0
                    ? `${e.slackMinutes} min slack`
                    : `${Math.abs(e.slackMinutes)} min deficit`}
                {" · "}
                <time dateTime={e.fetchedAt}>{formatUtc(e.fetchedAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ badges */

function KindBadge({ kind }: { kind: FiredKind }): React.ReactElement {
  const tone: Record<FiredKind, string> = {
    CATCH: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
    ALL_CLEAR: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    CANNOT_CONFIRM: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    DEFINITE_MISS: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
    CANCELLED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${tone[kind]}`}>{kind}</span>
  );
}

function DeliveryBadge({ status }: { status: DeliveryStatus }): React.ReactElement {
  const map: Record<DeliveryStatus, { label: string; cls: string }> = {
    sent: { label: "Sent", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    attempting: { label: "Sending…", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    failed: { label: "Failed", cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
    no_device: { label: "No device", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  };
  const m = map[status];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

function VerdictTag({ verdict }: { verdict: Verdict }): React.ReactElement {
  const map: Record<Verdict, string> = {
    make: "text-emerald-600 dark:text-emerald-400",
    miss: "text-red-600 dark:text-red-400",
    indeterminate: "text-slate-500",
  };
  return <span className={`text-xs font-medium ${map[verdict]}`}>{verdict}</span>;
}

/* -------------------------------------------------------------------- gate */

function Gate({ kind }: { kind: "missing" | "denied" }): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center font-sans">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Keeper</span>
      <h1 className="mt-3 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Not authorized</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        {kind === "missing"
          ? "This page needs a watch link with a valid access token. Open it from the original arm confirmation on your device."
          : "We couldn’t verify access to this watch. The link may be wrong, expired, or for a watch you don’t own."}
      </p>
    </main>
  );
}

/* ---------------------------------------------------------------- helpers */

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

function stateLabel(state: WatchState): string {
  return STATE_LABELS[state] ?? state;
}

function verdictDot(verdict: Verdict): string {
  if (verdict === "make") return "bg-emerald-500";
  if (verdict === "miss") return "bg-red-500";
  return "bg-slate-400";
}

const SELF_REPORT_LABELS: Record<SelfReportStatus, string> = {
  pending: "Awaiting reply",
  answered: "Answered",
  dismissed: "Dismissed",
  expired: "Expired",
  no_channel: "No channel",
};

function selfReportLabel(status: SelfReportStatus): string {
  return SELF_REPORT_LABELS[status] ?? status;
}

function outcomeLabel(outcome: OutcomeView): string {
  if (outcome.outcome === "made") return "Made it";
  if (outcome.outcome === "missed") return "Missed";
  if (outcome.outcome === "changed") return "Plans changed";
  return "—";
}

/** Format a UTC ISO instant in a fixed, locale-stable UTC string (server-rendered, no hydration drift). */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d) + " UTC";
}

/** Format a UTC ISO instant in the commitment's own IANA zone (what the traveler actually experiences). */
function formatInZone(iso: string, zone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return formatUtc(iso);
  }
}
