"use client";

import { useState } from "react";
import { InstallPrompt } from "@/components/InstallPrompt";
import { upsertWatchToken } from "@/lib/storage/watchTokens";

type ArmedWatch = {
  watchId: string;
  token: string;
  state: string;
  fired: string | null;
  placeLabel: string;
  zone: string;
  transitMinutes: number;
  slackMinutes: number | null;
  projectedAtPlaceUtc: string | null;
};

function getDeviceId(): string {
  const KEY = "keeper-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Persist the capability token keyed by watchId so a push deep-link (/dashboard?id=…, which carries no
 * token) can resolve on this device: the dashboard's fallback reads keeper-watches[id] and redirects to
 * ?id=&token=. Stored as a map { [watchId]: token }. Reads tolerate the older list shape too.
 */
function saveWatch(w: ArmedWatch): void {
  const KEY = "keeper-watches";
  localStorage.setItem(KEY, upsertWatchToken(localStorage.getItem(KEY), w.watchId, w.token));
}

const STATE_COPY: Record<string, { label: string; tone: string }> = {
  OK: { label: "On track — comfortable", tone: "text-emerald-600" },
  AT_RISK: { label: "Tight — watching closely", tone: "text-amber-600" },
  MISS_PREDICTED: { label: "Heads up — you’re predicted to miss it", tone: "text-red-600" },
  LANDED_CAPTURE: { label: "Flight already landed — capturing the outcome", tone: "text-zinc-500" },
};

export default function Home() {
  const [flightNumber, setFlightNumber] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [commitmentLocal, setCommitmentLocal] = useState("");
  const [reschedulable, setReschedulable] = useState(true);
  const [marginMinutes, setMarginMinutes] = useState("15");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ArmedWatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          flightNumber: flightNumber.trim().toUpperCase(),
          flightDate,
          placeQuery: placeQuery.trim(),
          commitmentLocal,
          reschedulable,
          marginMinutes: Number(marginMinutes) || 0,
          contact: contact.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      saveWatch(data);
      setResult(data);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900";
  const label = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-10 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Keeper</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Watch a flight against one commitment. We’ll catch the cascade before you do.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Flight number</label>
            <input className={field} placeholder="EK1" value={flightNumber}
              onChange={(e) => setFlightNumber(e.target.value)} required />
          </div>
          <div>
            <label className={label}>Flight date</label>
            <input type="date" className={field} value={flightDate}
              onChange={(e) => setFlightDate(e.target.value)} required />
          </div>
        </div>

        <div>
          <label className={label}>Where do you need to be?</label>
          <input className={field} placeholder="Trafalgar Square, London" value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>By when (local)</label>
            <input type="datetime-local" className={field} value={commitmentLocal}
              onChange={(e) => setCommitmentLocal(e.target.value)} required />
          </div>
          <div>
            <label className={label}>Arrival margin (min)</label>
            <input type="number" min={0} max={360} className={field} value={marginMinutes}
              onChange={(e) => setMarginMinutes(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={label}>Who to contact if it slips (optional)</label>
          <input className={field} placeholder="The venue" value={contact}
            onChange={(e) => setContact(e.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={reschedulable}
            onChange={(e) => setReschedulable(e.target.checked)} />
          This commitment can be moved (reschedulable)
        </label>

        <button type="submit" disabled={submitting}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black">
          {submitting ? "Arming…" : "Arm watch"}
        </button>
      </form>

      {error && (
        <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40">{error}</p>
      )}

      {result && (
        <div className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <p className={`text-base font-semibold ${STATE_COPY[result.state]?.tone ?? "text-zinc-700"}`}>
            {STATE_COPY[result.state]?.label ?? result.state}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div className="flex justify-between"><dt>Destination</dt><dd>{result.placeLabel}</dd></div>
            <div className="flex justify-between"><dt>Airport → place</dt><dd>{result.transitMinutes} min drive</dd></div>
            <div className="flex justify-between">
              <dt>Slack</dt>
              <dd>{result.slackMinutes === null ? "—" : `${result.slackMinutes} min`}</dd>
            </div>
          </dl>
          <a
            href={`/dashboard?id=${encodeURIComponent(result.watchId)}&token=${encodeURIComponent(result.token)}`}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-100"
          >
            View watch dashboard
          </a>
          <p className="mt-3 text-xs text-zinc-400">
            Watch armed. Keep this device — your access token is saved locally so a notification link
            opens straight to your dashboard.
          </p>
        </div>
      )}

      <InstallPrompt />
    </main>
  );
}
