"use client";

import { useState } from "react";
import type { Outcome } from "@/lib/calibration/types";
import { postSelfReport } from "@/lib/calibration/selfReport";
import { tokenForWatch } from "@/lib/storage/watchTokens";

/**
 * Self-report capture (U8/R14) — the calibration moat's outcome input, rendered IN-APP as the
 * reliability backstop for the notification-action path. The traveler taps Made it / Missed it /
 * Changed it (optionally flagging whether the heads-up was useful), and we POST the same
 * { watchId, token, outcome, wasUseful? } contract the service-worker action posts, to /api/self-report.
 *
 * The token already rode in via the dashboard URL (?token=), so the form just forwards it. On success
 * we reflect a thank-you in place — the page itself is server-rendered and won't live-refresh, but the
 * write is durable (recordSelfReport only touches a pending/expired row, so a later page load shows the
 * answered outcome). The parent only mounts this when the self-report is still pending or expired.
 */

interface SelfReportFormProps {
  watchId: string;
  token: string;
}

const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: "made", label: "Made it", hint: "You reached your commitment in time" },
  { value: "missed", label: "Missed it", hint: "You didn’t make it" },
  { value: "changed", label: "Changed it", hint: "You moved or cancelled the plan" },
];

type Status = "idle" | "submitting" | "done" | "error";

export function SelfReportForm({ watchId, token }: SelfReportFormProps): React.ReactElement {
  const [status, setStatus] = useState<Status>("idle");
  const [recorded, setRecorded] = useState<Outcome | null>(null);
  const [wasUseful, setWasUseful] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(outcome: Outcome): Promise<void> {
    setStatus("submitting");
    setError(null);
    try {
      const result = await postSelfReport({ watchId, token, outcome, wasUseful });
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setRecorded(outcome);
      setStatus("done");
    } catch {
      setError("Network error — try again.");
      setStatus("error");
    }
  }

  if (status === "done" && recorded) {
    const label = OUTCOMES.find((o) => o.value === recorded)?.label ?? recorded;
    return (
      <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Thanks — recorded.</h3>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
          You told us: <span className="font-medium">{label}</span>
          {wasUseful ? " · the heads-up was useful" : ""}. This sharpens Keeper’s predictions.
        </p>
      </section>
    );
  }

  const busy = status === "submitting";

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">How did it go?</h3>
      <p className="mt-1 text-xs text-zinc-500">
        One tap closes the loop and improves your future watches. Only you can answer this.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => submit(o.value)}
            title={o.hint}
            className="flex flex-col items-start rounded-xl border border-zinc-300 bg-white px-4 py-3 text-left transition hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-100"
          >
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{o.label}</span>
            <span className="mt-0.5 text-[11px] text-zinc-500">{o.hint}</span>
          </button>
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={wasUseful}
          disabled={busy}
          onChange={(e) => setWasUseful(e.target.checked)}
          className="h-4 w-4"
        />
        The heads-up was useful
      </label>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Deep-link token resolver (R23 deep-link affordance). A push notification opens /dashboard?id=… with
 * NO token (the token is a secret we never embed in a notification URL). On the device that armed the
 * watch, the token was saved to localStorage at arm time; this client component looks it up by id and
 * redirects to ?id=&token= so the page authorizes. If no token is stored for that id (a different
 * device, or cleared storage), it renders nothing and the server keeps showing its not-authorized gate.
 *
 * It is mounted by the server page ONLY when ?id is present but the token is missing/invalid — so the
 * common, already-authorized path never ships or runs this. Uses window.location (a full navigation) so
 * the server re-runs the capability gate with the resolved token; no router import needed.
 */
export function DashboardTokenFallback({ watchId }: { watchId: string }): null {
  if (typeof window !== "undefined") {
    const token = readStoredToken(watchId);
    if (token) {
      const url = new URL(window.location.href);
      // Only redirect if we'd actually change the token param, to avoid a reload loop on a bad token.
      if (url.searchParams.get("token") !== token) {
        url.searchParams.set("id", watchId);
        url.searchParams.set("token", token);
        window.location.replace(url.toString());
      }
    }
  }
  return null;
}

/** Read the capability token saved at arm time for this watch id from the keeper-watches store. */
function readStoredToken(watchId: string): string | null {
  try {
    return tokenForWatch(localStorage.getItem("keeper-watches"), watchId);
  } catch {
    return null;
  }
}
