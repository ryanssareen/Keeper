import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAndVerifyWatch } from "@/lib/security/watchGate";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  buildWatchView,
  loadWatchForView,
  loadWatchesForUser,
} from "@/lib/calibration/dashboard";
import { AppShell } from "@/components/app/AppShell";
import { WatchList } from "@/components/app/WatchList";
import { DashboardDetail } from "@/components/app/DashboardDetail";
import { SelfReportForm, DashboardTokenFallback } from "@/components/SelfReportForm";
import s from "@/components/app/dashboard.module.css";

/**
 * The dashboard serves TWO independent audiences (R16, R22, R23):
 *
 *  1. CAPABILITY path (?id&token): a logged-out push deep-link to one watch. The shared watch gate
 *     verifies the token in constant time (uniform denial, no existence oracle); on success we render
 *     that single watch solo, with the interactive self-report (the token authorizes the POST).
 *
 *  2. ACCOUNT path (no id): a signed-in owner's multi-watch console. The session is the gate — we list
 *     only this user's watches (loadWatchesForUser is WHERE user_id), so any id it returns is already
 *     authorized. Selection is ?w=<id>, server-rendered per click.
 *
 * searchParams is awaited (Request-time API in Next 16) — reading it opts this page into dynamic
 * rendering, which is correct: it is per-watch / per-user and never cached.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : undefined;
  const token = typeof params.token === "string" ? params.token : undefined;

  // ---- Capability path: a watch link carrying a token (works logged out) ----
  if (id) {
    if (!token) return <Gate kind="missing" watchIdForFallback={id} />;
    const access = await loadAndVerifyWatch(id, token);
    if (!access.ok) return <Gate kind="denied" watchIdForFallback={id} />;
    const loaded = await loadWatchForView(id);
    if (loaded.status === "not_found") return <Gate kind="denied" watchIdForFallback={id} />;

    const view = buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration);
    const showSelfReport =
      view.outcome !== null &&
      (view.outcome.selfReportStatus === "pending" || view.outcome.selfReportStatus === "expired");

    return (
      <main className="font-sans">
        <DashboardDetail
          view={view}
          solo
          selfReport={showSelfReport ? <SelfReportForm watchId={id} token={token} /> : undefined}
        />
      </main>
    );
  }

  // ---- Account path: signed-in owner's multi-watch console ----
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const shellUser = {
    name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "",
  };

  const watches = await loadWatchesForUser(user.id);

  // No watches yet → blank state inviting the first arm.
  if (watches.length === 0) {
    return (
      <AppShell user={shellUser} railMiddle={<WatchList watches={[]} selectedId="" />} header={<span>Trips</span>}>
        <div className={s.blank}>
          <div className={s.blankRing}>
            <svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="1.6" fill="#18181b" /><path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#18181b" strokeWidth="1.3" strokeLinecap="round" /><path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </div>
          <h1>No watches yet</h1>
          <p>Arm your first watch — point Keeper at a flight and the one thing downstream of it, and it’ll catch the cascade before you do.</p>
          <Link className={`btn btn-primary btn-lg ${s.cta}`} href="/onboarding">Arm your first watch</Link>
        </div>
      </AppShell>
    );
  }

  // Pick the selected watch from ?w, else the first (active sorts first).
  const requested = typeof params.w === "string" ? params.w : undefined;
  const selected = watches.find((w) => w.id === requested) ?? watches[0];

  const loaded = await loadWatchForView(selected.id);
  const view =
    loaded.status === "ok"
      ? buildWatchView(loaded.watch, loaded.snapshots, loaded.firedRows, loaded.calibration)
      : null;

  return (
    <AppShell
      user={shellUser}
      railMiddle={<WatchList watches={watches} selectedId={selected.id} />}
      header={
        <>
          <span>Trips</span>
          <span className={s.sep}>/</span>
          <b>{selected.flightNumber} → {selected.placeLabel}</b>
        </>
      }
      headerActions={<Link className="btn btn-secondary btn-sm" href="/onboarding">New watch</Link>}
    >
      {view ? <DashboardDetail view={view} /> : <div className={s.empty}>This watch could not be loaded.</div>}
    </AppShell>
  );
}

/* -------------------------------------------------------------------- gate */

function Gate({
  kind,
  watchIdForFallback,
}: {
  kind: "missing" | "denied";
  watchIdForFallback?: string;
}): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center font-sans">
      {watchIdForFallback ? <DashboardTokenFallback watchId={watchIdForFallback} /> : null}
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Keeper</span>
      <h1 className="mt-3 text-xl font-semibold text-zinc-900">Not authorized</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        {kind === "missing"
          ? "This page needs a watch link with a valid access token, or a signed-in account. Open it from your arm confirmation, or log in."
          : "We couldn’t verify access to this watch. The link may be wrong, expired, or for a watch you don’t own."}
      </p>
      <Link href="/login" className="btn btn-primary" style={{ marginTop: 20 }}>Log in</Link>
    </main>
  );
}
