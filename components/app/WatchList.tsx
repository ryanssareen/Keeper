import Link from "next/link";
import type { WatchState } from "@/lib/engine/types";
import type { WatchSummary } from "@/lib/calibration/dashboard";
import { RailNewButton } from "./AppShell";
import s from "./dashboard.module.css";

const DOT: Record<WatchState, string> = {
  OK: "var(--emerald-500)",
  RECOVERED: "var(--emerald-500)",
  AT_RISK: "var(--amber-500)",
  MISS_PREDICTED: "var(--red-500)",
  DEFINITE_MISS: "var(--red-500)",
  DEGRADED: "var(--slate-400)",
  CANCELLED: "var(--zinc-300)",
  LANDED_CAPTURE: "var(--zinc-300)",
};

const SHORT: Record<WatchState, { label: string; color: string }> = {
  OK: { label: "On track", color: "var(--emerald-600)" },
  RECOVERED: { label: "Recovered", color: "var(--emerald-600)" },
  AT_RISK: { label: "At risk", color: "var(--amber-600)" },
  MISS_PREDICTED: { label: "Miss", color: "var(--red-600)" },
  DEFINITE_MISS: { label: "Missed", color: "var(--red-600)" },
  DEGRADED: { label: "Unsure", color: "var(--slate-500)" },
  CANCELLED: { label: "Cancelled", color: "var(--text-faint)" },
  LANDED_CAPTURE: { label: "Landed", color: "var(--text-faint)" },
};

/** Dashboard rail: the user's watches, grouped active/closed, each linking to ?w=<id>. */
export function WatchList({
  watches,
  selectedId,
}: {
  watches: WatchSummary[];
  selectedId: string;
}): React.ReactElement {
  const active = watches.filter((w) => !w.terminal);
  const closed = watches.filter((w) => w.terminal);

  return (
    <>
      <RailNewButton />
      {active.length > 0 ? (
        <>
          <div className={s.railSection}><span className="k-label">Active · {active.length}</span></div>
          <div className={s.watchList}>
            {active.map((w) => (
              <WatchRow key={w.id} w={w} selected={w.id === selectedId} />
            ))}
          </div>
        </>
      ) : null}
      {closed.length > 0 ? (
        <>
          <div className={s.railSection} style={{ marginTop: 10 }}><span className="k-label">Closed · {closed.length}</span></div>
          <div className={s.watchList}>
            {closed.map((w) => (
              <WatchRow key={w.id} w={w} selected={w.id === selectedId} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function WatchRow({ w, selected }: { w: WatchSummary; selected: boolean }): React.ReactElement {
  const short = SHORT[w.state];
  return (
    <Link href={`/dashboard?w=${encodeURIComponent(w.id)}`} className={`${s.wlItem} ${selected ? s.sel : ""}`}>
      <div className={s.wlRoute}>
        <span className={s.wlDot} style={{ background: DOT[w.state] }} />
        <b>{w.flightNumber} → {w.placeLabel}</b>
      </div>
      <div className={s.wlSub}>
        <span className="place">{w.placeLabel}</span>
        <span className="slack" style={{ color: short.color }}>{short.label}</span>
      </div>
    </Link>
  );
}
