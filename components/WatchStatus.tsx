import type { WatchState } from "@/lib/engine/types";

/**
 * Presentational status hero for the dashboard. Color-codes the watch's current state and gives it
 * a human sentence, so the lifecycle reads at a glance: OK is calm green, AT_RISK amber, a predicted
 * or definite miss red, DEGRADED slate ("can't confirm"), recovered/landed neutral. Pure: no IO, no
 * client interactivity — it renders the state the server already resolved.
 */

interface StatePresentation {
  /** One-line headline shown large in the hero. */
  headline: string;
  /** A short supporting sentence under the headline. */
  detail: string;
  /** Tailwind classes for the hero surface (bg + border + text), tuned per tone. */
  surface: string;
  /** Tailwind classes for the small status pill. */
  pill: string;
  /** Short pill label. */
  pillLabel: string;
}

const PRESENTATION: Record<WatchState, StatePresentation> = {
  OK: {
    headline: "On track",
    detail: "Comfortable slack to your commitment. We’re watching the flight for any cascade.",
    surface: "bg-emerald-50 border-emerald-200 text-emerald-950",
    pill: "bg-emerald-600 text-white",
    pillLabel: "OK",
  },
  AT_RISK: {
    headline: "Running tight",
    detail: "The margin has narrowed. Not a miss yet — we’re watching closely and will catch it early.",
    surface: "bg-amber-50 border-amber-200 text-amber-950",
    pill: "bg-amber-500 text-white",
    pillLabel: "At risk",
  },
  MISS_PREDICTED: {
    headline: "You’re predicted to miss it",
    detail: "On the current arrival you won’t reach your commitment in time. Act now while there’s lead.",
    surface: "bg-red-50 border-red-200 text-red-950",
    pill: "bg-red-600 text-white",
    pillLabel: "Miss predicted",
  },
  DEFINITE_MISS: {
    headline: "The commitment has passed",
    detail: "Your deadline came while the flight was still en route. This watch is closed.",
    surface: "bg-red-50 border-red-200 text-red-950",
    pill: "bg-red-700 text-white",
    pillLabel: "Definite miss",
  },
  DEGRADED: {
    headline: "Can’t confirm right now",
    detail: "The flight feed is stale or unusable, so we won’t assert a miss from missing data. Re-checking soon.",
    surface: "bg-slate-100 border-slate-300 text-slate-900",
    pill: "bg-slate-600 text-white",
    pillLabel: "Degraded",
  },
  RECOVERED: {
    headline: "Back on track",
    detail: "Slack has returned and held. You’re clear of the earlier risk.",
    surface: "bg-zinc-50 border-zinc-200 text-zinc-900",
    pill: "bg-zinc-700 text-white",
    pillLabel: "Recovered",
  },
  CANCELLED: {
    headline: "Flight cancelled",
    detail: "The flight was cancelled. This watch is closed.",
    surface: "bg-zinc-100 border-zinc-300 text-zinc-900",
    pill: "bg-zinc-700 text-white",
    pillLabel: "Cancelled",
  },
  LANDED_CAPTURE: {
    headline: "Flight landed",
    detail: "The aircraft is down. We’re capturing the outcome to close the loop.",
    surface: "bg-zinc-50 border-zinc-200 text-zinc-900",
    pill: "bg-zinc-600 text-white",
    pillLabel: "Landed",
  },
};

export function WatchStatus({ state }: { state: WatchState }): React.ReactElement {
  const p = PRESENTATION[state];

  return (
    <section className={`rounded-2xl border p-6 sm:p-8 ${p.surface}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${p.pill}`}>
          {p.pillLabel}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest opacity-60">live status</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{p.headline}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed opacity-80">{p.detail}</p>
    </section>
  );
}
