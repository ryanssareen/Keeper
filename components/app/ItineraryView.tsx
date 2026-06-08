"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateItinerary, deleteItineraryItem, setItemStatus } from "@/lib/itinerary/actions";
import { cmpStr, groupByDay, type ItineraryItem } from "@/lib/itinerary/itinerary";
import type { Advisory } from "@/lib/itinerary/feasibility";
import s from "@/app/trips/itinerary/itinerary.module.css";

const fmtTime = (iso: string | null, zone: string): string =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(iso)) : "";
const fmtDay = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

type GenSummary = { count: number; dropped: number; advisories: Advisory[] } | null;

export function ItineraryView({
  items,
  anchors,
  hasDates,
  dest,
}: {
  items: ItineraryItem[];
  anchors: string;
  hasDates: boolean;
  dest: string;
}): React.ReactElement {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenSummary>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onGenerate(): Promise<void> {
    if (inFlight.current) return; // guard a double-click before `busy` disables the button
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await generateItinerary();
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
    setPendingId(item.id);
    setError(null);
    setSummary(null); // the generate summary is stale once items are edited
    try {
      const next = item.status === "completed" ? "planned" : "completed";
      const res = await setItemStatus(item.id, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function onRemove(id: string): Promise<void> {
    setPendingId(id);
    setError(null);
    setSummary(null);
    try {
      const res = await deleteItineraryItem(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  const days = [...groupByDay(items).entries()].sort((a, b) => cmpStr(a[0], b[0]));

  return (
    <div className={s.page}>
      <header className={s.head}>
        <span className={s.who}>Itinerary</span>
        <h1>Your days in {dest}</h1>
        <p>Keeper plans around your real bookings — every place is one Keeper watches against your trip.</p>
        {anchors ? <p className={s.anchors}>Using: {anchors}</p> : null}
        {!hasDates ? <p className={s.note}>We don’t have your trip dates yet — we’ll assume a short trip. Add a hotel or flight for tighter planning.</p> : null}
      </header>

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

      {items.length === 0 ? (
        <div className={s.empty}>
          <p>No itinerary yet. <b>Plan my trip</b> builds a day-by-day plan from your bookings — every place resolved to a real spot Keeper can watch.</p>
        </div>
      ) : (
        days.map(([day, dayItems]) => (
          <section key={day} className={s.day}>
            <h2 className={s.dayHead}>{fmtDay(day)}</h2>
            <ul className={s.items}>
              {dayItems.map((it) => (
                <li key={it.id} className={`${s.item} ${it.status === "completed" ? s.done : ""}`}>
                  <button
                    type="button"
                    className={s.check}
                    onClick={() => onToggle(it)}
                    disabled={pendingId === it.id}
                    aria-label={it.status === "completed" ? `Mark ${it.title} not done` : `Mark ${it.title} done`}
                  >
                    {it.status === "completed" ? "✓" : ""}
                  </button>
                  <span className={s.time}>{fmtTime(it.startTs, it.ianaZone) || "—"}</span>
                  <span className={s.body}>
                    <b className={s.title}>{it.title}</b>
                    <span className={s.place}>{it.placeName}</span>
                  </span>
                  <span className={s.watched} title="Keeper watches this against your bookings">Watched</span>
                  <button type="button" className={s.remove} onClick={() => onRemove(it.id)} disabled={pendingId === it.id} aria-label={`Remove ${it.title}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

