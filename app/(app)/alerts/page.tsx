import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  loadAlertsForUser,
  loadWatchesForUser,
  loadWatchForView,
  buildWatchView,
  type AlertFeedEntry,
} from "@/lib/calibration/dashboard";
import { DashboardDetail } from "@/components/app/DashboardDetail";
import s from "./alerts.module.css";

export const metadata: Metadata = { title: "Keeper — Alerts" };

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ watch?: string }>;
}): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return <></>;

  const { watch: watchIdParam } = await searchParams;

  const [alerts, watches] = await Promise.all([
    loadAlertsForUser(user.id),
    loadWatchesForUser(user.id),
  ]);

  // If a specific watch is selected (or default to the first non-terminal), load its detail view.
  const selectedWatch = watchIdParam
    ? watches.find((w) => w.id === watchIdParam)
    : watches.find((w) => !w.terminal) ?? watches[0] ?? null;

  let detail = null;
  if (selectedWatch) {
    const loaded = await loadWatchForView(selectedWatch.id);
    if (loaded.status === "ok") {
      detail = buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration);
    }
  }

  return (
    <div className={s.page}>
      <div className={s.layout}>
        {/* Left: alert feed */}
        <div className={s.feed}>
          <div className={s.feedHead}>
            <h2 className={s.feedTitle}>Alert history</h2>
            <span className={s.feedCount}>{alerts.length}</span>
          </div>
          {alerts.length === 0 ? (
            <div className={s.empty}>
              <p>No alerts yet. Keeper fires when a downstream commitment is at risk.</p>
            </div>
          ) : (
            <div className={s.rows}>
              {alerts.map((a, i) => (
                <AlertRow key={`${a.watchId}-${a.createdAt}-${i}`} entry={a} />
              ))}
            </div>
          )}
        </div>

        {/* Right: watch detail */}
        <div className={s.detail}>
          {watches.length === 0 ? (
            <div className={s.empty}>
              <p>No watches set up yet.</p>
              <Link className="btn btn-primary btn-sm" href="/dashboard" style={{ marginTop: 14 }}>
                Set up a watch
              </Link>
            </div>
          ) : (
            <>
              {/* Watch selector */}
              <div className={s.watchSelector}>
                {watches.map((w) => (
                  <Link
                    key={w.id}
                    href={`/alerts?watch=${w.id}`}
                    className={`${s.watchTab} ${selectedWatch?.id === w.id ? s.watchTabActive : ""}`}
                  >
                    <span className={s.watchFlight}>{w.flightNumber}</span>
                    <span className={`pill pill-${statePill(w.state)}`}>{stateLabel(w.state)}</span>
                  </Link>
                ))}
              </div>
              {detail ? <DashboardDetail view={detail} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertRow({ entry }: { entry: AlertFeedEntry }): React.ReactElement {
  const kindLabel = KIND_LABELS[entry.kind] ?? entry.kind;
  const pillClass = kindPill(entry.kind);
  const timeLabel = entry.sentAt
    ? fmtRelative(entry.sentAt)
    : fmtRelative(entry.createdAt);

  return (
    <Link href={`/alerts?watch=${entry.watchId}`} className={s.row}>
      <div className={s.rowLeft}>
        <span className={`pill ${pillClass}`}>{kindLabel}</span>
        <div className={s.rowMeta}>
          <span className={s.rowFlight}>{entry.flightNumber}</span>
          <span className={s.rowArrow}>→</span>
          <span className={s.rowPlace}>{entry.placeLabel}</span>
        </div>
        {entry.leadTimeMinutes !== null ? (
          <span className={s.rowLead}>{entry.leadTimeMinutes}m lead</span>
        ) : null}
      </div>
      <div className={s.rowRight}>
        <span className={s.rowTime}>{timeLabel}</span>
        <span className={`${s.deliveryDot} ${deliveryDotClass(entry.deliveryStatus)}`} title={entry.deliveryStatus} />
      </div>
    </Link>
  );
}

const KIND_LABELS: Record<string, string> = {
  CATCH: "Catch",
  AT_RISK: "At risk",
  RECOVERED: "Recovered",
  DEGRADED: "Can't confirm",
  CANCELLED: "Cancelled",
  LANDED: "Landed",
};

function kindPill(kind: string): string {
  if (kind === "CATCH") return "pill-solid-miss";
  if (kind === "AT_RISK") return "pill-risk";
  if (kind === "RECOVERED") return "pill-ok";
  if (kind === "CANCELLED") return "pill-neutral";
  return "pill-neutral";
}

function deliveryDotClass(status: string): string {
  if (status === "sent") return s.dotSent;
  if (status === "failed") return s.dotFailed;
  return s.dotPending;
}

function statePill(state: string): string {
  if (["OK", "RECOVERED", "LANDED_CAPTURE"].includes(state)) return "ok";
  if (["AT_RISK", "DEGRADED"].includes(state)) return "risk";
  if (["MISS_PREDICTED", "DEFINITE_MISS", "CANCELLED"].includes(state)) return "miss";
  return "neutral";
}

function stateLabel(state: string): string {
  const MAP: Record<string, string> = {
    OK: "On track", AT_RISK: "At risk", MISS_PREDICTED: "Miss predicted",
    RECOVERED: "Recovered", DEGRADED: "Can't confirm",
    CANCELLED: "Cancelled", DEFINITE_MISS: "Definite miss", LANDED_CAPTURE: "Landed",
  };
  return MAP[state] ?? state;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
