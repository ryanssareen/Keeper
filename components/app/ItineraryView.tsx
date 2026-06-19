"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateItinerary, deleteItineraryItem, setItemStatus } from "@/lib/itinerary/actions";
import {
  cmpStr,
  groupByDay,
  hasPrefs,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
  type ItineraryItem,
  type ItineraryPrefs,
  type ItemStatus,
  type Pace,
} from "@/lib/itinerary/itinerary";
import type { Advisory } from "@/lib/itinerary/feasibility";
import s from "@/app/trips/itinerary/itinerary.module.css";

const fmtTime = (iso: string | null, zone: string): string =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(iso)) : "";
const fmtDay = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

// Split a day into parts so it reads as a plan, not a flat checklist. Bucket by the scheduled local hour.
const PART_ORDER = ["Morning", "Afternoon", "Evening"] as const;
type DayPart = (typeof PART_ORDER)[number];
const partOfDay = (iso: string | null, zone: string): DayPart => {
  if (!iso) return "Morning";
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: zone }).format(new Date(iso)));
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
};
function groupParts(items: ItineraryItem[]): { label: DayPart; items: ItineraryItem[] }[] {
  const buckets: Record<DayPart, ItineraryItem[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const it of items) buckets[partOfDay(it.startTs, it.ianaZone)].push(it);
  return PART_ORDER.map((label) => ({ label, items: buckets[label] })).filter((b) => b.items.length > 0);
}

type GenSummary = { count: number; dropped: number; advisories: Advisory[] } | null;

export function ItineraryView({
  items,
  anchors,
  hasDates,
  dest,
  initialPrefs,
  party,
}: {
  items: ItineraryItem[];
  anchors: string;
  hasDates: boolean;
  dest: string;
  initialPrefs?: ItineraryPrefs;
  party?: string;
}): React.ReactElement {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenSummary>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Optional refinements (the "rough idea" path). Empty == plan from destination + dates only.
  const [prefs, setPrefs] = useState<ItineraryPrefs>(initialPrefs ?? {});
  const [showRefine, setShowRefine] = useState(hasPrefs(initialPrefs));
  const patchPrefs = (p: Partial<ItineraryPrefs>): void => setPrefs((prev) => ({ ...prev, ...p }));
  const toggleInterest = (label: string): void =>
    setPrefs((prev) => {
      const set = new Set(prev.interests ?? []);
      if (set.has(label)) set.delete(label);
      else set.add(label);
      return { ...prev, interests: [...set] };
    });
  // Optimistic status overlay: the tick must reflect the click instantly and hold, independent of when
  // the server refetch lands — otherwise a refresh/RSC-cache race re-renders the stale status and the
  // tick flashes on then off (issue #7). The overlay stays in sync with the server (it only ever holds
  // the value we just persisted); regenerate creates new item ids, so stale overrides can't linger.
  const [statusOverride, setStatusOverride] = useState<Record<string, ItemStatus>>({});
  const statusOf = (it: ItineraryItem): ItemStatus => statusOverride[it.id] ?? it.status;
  // Optimistically hide a removed item so it disappears on click; if the server delete fails (or removed
  // 0 rows), we un-hide it and show the error — so the row never silently lingers OR vanishes-then-returns.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  async function onGenerate(): Promise<void> {
    if (inFlight.current) return; // guard a double-click before `busy` disables the button
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await generateItinerary(prefs);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummary({ count: res.count, dropped: res.dropped, advisories: res.advisories });
      router.refresh();
    } catch {
      setError("Something went wrong generating your itinerary. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function onToggle(item: ItineraryItem): Promise<void> {
    const current = statusOf(item);
    const next: ItemStatus = current === "completed" ? "planned" : "completed";
    // Optimistic: flip the tick immediately and hold it; the server refetch reconciles to the same value.
    setStatusOverride((prev) => ({ ...prev, [item.id]: next }));
    setPendingId(item.id);
    setError(null);
    setSummary(null); // the generate summary is stale once items are edited
    if (process.env.NODE_ENV !== "production") console.debug("[itinerary] toggle", { id: item.id, from: current, to: next });
    try {
      const res = await setItemStatus(item.id, next);
      if (process.env.NODE_ENV !== "production") console.debug("[itinerary] toggle result", { id: item.id, ok: res.ok });
      if (!res.ok) {
        setStatusOverride((prev) => ({ ...prev, [item.id]: current })); // revert on failure
        setError(res.error);
      } else {
        router.refresh();
      }
    } finally {
      setPendingId(null);
    }
  }

  async function onRemove(id: string): Promise<void> {
    setPendingId(id);
    setError(null);
    setSummary(null);
    setRemovedIds((prev) => new Set(prev).add(id)); // optimistic hide
    try {
      const res = await deleteItineraryItem(id);
      if (!res.ok) {
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(id); // un-hide on failure
          return next;
        });
        setError(res.error);
      } else {
        router.refresh();
      }
    } catch {
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError("Couldn’t remove that item — please try again.");
    } finally {
      setPendingId(null);
    }
  }

  const visible = items.filter((it) => !removedIds.has(it.id));
  const days = [...groupByDay(visible).entries()].sort((a, b) => cmpStr(a[0], b[0]));

  return (
    <div className={s.page}>
      <header className={s.head}>
        <span className={s.who}>Itinerary</span>
        <h1>Your days in {dest}</h1>
        <p>Keeper plans around your real bookings — every place is one Keeper watches against your trip.</p>
        {anchors ? <p className={s.anchors}>Using: {anchors}</p> : null}
        {!hasDates ? <p className={s.note}>We don’t have your trip dates yet — we’ll assume a short trip. Add a hotel or flight for tighter planning.</p> : null}
      </header>

      <div className={s.refine}>
        <button type="button" className={s.refineToggle} onClick={() => setShowRefine((v) => !v)} aria-expanded={showRefine}>
          <span>Refine your plan <em>· optional</em></span>
          <span className={s.chev} data-open={showRefine}>⌄</span>
        </button>
        {showRefine ? (
          <div className={s.refineBody}>
            <p className={s.refineLede}>Add as much or as little as you like — or just hit {items.length > 0 ? "Regenerate" : "Plan my trip"} to plan from your destination and dates.</p>

            <div className={s.refineField}>
              <label htmlFor="prefAges">Who’s going? <span className={s.refineHint}>{party ? `you said: ${party}` : "ages help us tailor picks"}</span></label>
              <input
                id="prefAges" className="field" type="text" placeholder="e.g. 2 adults, 1 child age 7"
                value={prefs.ages ?? ""} onChange={(e) => patchPrefs({ ages: e.target.value })}
              />
            </div>

            <div className={s.refineField}>
              <span className={s.refineLabel}>Interests</span>
              <div className={s.chips}>
                {INTEREST_OPTIONS.map((label) => {
                  const on = (prefs.interests ?? []).includes(label);
                  return (
                    <button key={label} type="button" className={`${s.chip} ${on ? s.chipOn : ""}`} aria-pressed={on} onClick={() => toggleInterest(label)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={s.refineField}>
              <span className={s.refineLabel}>Pace</span>
              <div className={s.segmented}>
                {PACE_OPTIONS.map((p) => (
                  <button
                    key={p} type="button" aria-pressed={prefs.pace === p}
                    className={`${s.seg} ${prefs.pace === p ? s.segOn : ""}`}
                    onClick={() => patchPrefs({ pace: prefs.pace === p ? undefined : (p as Pace) })}
                  >
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.refineField}>
              <label htmlFor="prefMust">Must-sees &amp; areas <span className={s.refineHint}>anything you already want in</span></label>
              <textarea
                id="prefMust" className="field" rows={2} placeholder="e.g. Shibuya, teamLab Planets, a ramen night in Shinjuku"
                value={prefs.mustSee ?? ""} onChange={(e) => patchPrefs({ mustSee: e.target.value })}
              />
            </div>

            <div className={s.refineField}>
              <label htmlFor="prefFixed">Fixed bookings &amp; times <span className={s.refineHint}>we’ll plan around these</span></label>
              <textarea
                id="prefFixed" className="field" rows={2} placeholder="e.g. dinner 8pm Jul 2; museum tickets 10am Jul 1"
                value={prefs.fixed ?? ""} onChange={(e) => patchPrefs({ fixed: e.target.value })}
              />
            </div>

            <div className={s.refineField}>
              <label htmlFor="prefNotes">Notes <span className={s.refineHint}>anything else — dietary, mobility, budget, vibe, errands…</span></label>
              <textarea
                id="prefNotes" className="field" rows={2} placeholder="e.g. vegetarian, no early mornings, mid-range budget, want one onsen day"
                value={prefs.notes ?? ""} onChange={(e) => patchPrefs({ notes: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className={s.actions}>
        <button type="button" className="btn btn-primary" onClick={onGenerate} disabled={busy} aria-busy={busy}>
          {busy ? "Planning your days…" : items.length > 0 ? "Regenerate" : "Plan my trip"}
        </button>
      </div>

      {error ? <p className={s.error} role="alert">{error}</p> : null}
      {summary ? (
        <p className={s.summary}>
          Planned {summary.count} {summary.count === 1 ? "place" : "places"}
          {summary.dropped > 0 ? ` · ${summary.dropped} suggestion${summary.dropped === 1 ? "" : "s"} couldn’t be verified and were left out` : ""}
          {summary.advisories.length > 0 ? ` · ${summary.advisories.length} thing${summary.advisories.length === 1 ? "" : "s"} to check` : ""}
        </p>
      ) : null}

      {summary && summary.advisories.length > 0 ? (
        <ul className={s.advisories}>
          {summary.advisories.map((a, i) => (
            <li key={i} className={s.advisory}>{a.message}</li>
          ))}
        </ul>
      ) : null}

      {visible.length === 0 ? (
        <div className={s.empty}>
          <p>No itinerary yet. <b>Plan my trip</b> builds a day-by-day plan from your bookings — every place resolved to a real spot Keeper can watch.</p>
        </div>
      ) : (
        days.map(([day, dayItems]) => (
          <section key={day} className={s.day}>
            <h2 className={s.dayHead}>{fmtDay(day)}</h2>
            {groupParts(dayItems).map(({ label, items: partItems }) => (
              <div key={label} className={s.part}>
                <h3 className={s.partHead}>{label}</h3>
                <ul className={s.items}>{partItems.map(renderItem)}</ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );

  function renderItem(it: ItineraryItem): React.ReactElement {
    const done = statusOf(it) === "completed";
    return (
      <li key={it.id} className={`${s.item} ${done ? s.done : ""}`}>
        <button
          type="button"
          className={s.check}
          onClick={() => onToggle(it)}
          disabled={pendingId === it.id}
          aria-label={done ? `Mark ${it.title} not done` : `Mark ${it.title} done`}
        >
          {done ? "✓" : ""}
        </button>
        <span className={s.time}>{fmtTime(it.startTs, it.ianaZone) || "—"}</span>
        <span className={s.body}>
          <b className={s.title}>{it.title}</b>
          {it.description ? <span className={s.desc}>{it.description}</span> : null}
          <span className={s.place}>{it.placeName}</span>
        </span>
        <span className={s.watched} title="Keeper watches this against your bookings">Watched</span>
        <button type="button" className={s.remove} onClick={() => onRemove(it.id)} disabled={pendingId === it.id} aria-label={`Remove ${it.title}`}>
          Remove
        </button>
      </li>
    );
  }
}

