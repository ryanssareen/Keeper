import { redirect } from "next/navigation";
import { loadAndVerifyWatch } from "@/lib/security/watchGate";
import { buildWatchView, loadWatchForView } from "@/lib/calibration/dashboard";
import { getCurrentUser } from "@/lib/supabase/server";
import { DashboardDetail } from "@/components/app/DashboardDetail";
import { SelfReportForm, DashboardTokenFallback } from "@/components/SelfReportForm";
import Link from "next/link";

/**
 * Two audiences:
 *  1. Capability path (?id&token): logged-out push deep-link to a specific watch.
 *  2. Account path: signed-in owner → redirect to the new command-center /today.
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

  // ---- Account path: redirect to the new command-center Today view ----
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/today");
  redirect("/today");
}

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
          : "We couldn't verify access to this watch. The link may be wrong, expired, or for a watch you don't own."}
      </p>
      <Link href="/login" className="btn btn-primary" style={{ marginTop: 20 }}>Log in</Link>
    </main>
  );
}
