import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import type { OnboardingAnswers } from "@/lib/onboarding/actions";
import { loadTripFlight, type TripFlight } from "@/lib/trips/flight";
import { listAttachments } from "@/lib/trips/queries";
import { loadChecklist } from "@/lib/checklist/queries";
import { checklistProgress } from "@/lib/checklist/checklist";
import { loadActiveShareToken } from "@/lib/share/queries";
import { TripAttachments } from "@/components/app/TripAttachments";
import s from "./bookings.module.css";

export const metadata: Metadata = { title: "Keeper — Bookings" };

export default async function BookingsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  // user is guaranteed by the (app) layout gate, but we need the id for share token
  if (!user) return <></>;

  const onboarding = await loadOnboarding();
  const trip = onboarding?.completed && onboarding.answers?.dest ? onboarding.answers : null;

  if (!trip) {
    return (
      <div className={s.blank}>
        <h1>No trip yet</h1>
        <p>Set up your first trip and Keeper will keep every booking, document, and plan in one place.</p>
        <Link className="btn btn-primary btn-lg" href="/onboarding" style={{ marginTop: 22 }}>
          Set up your trip
        </Link>
      </div>
    );
  }

  const [attachments, checklist, shareToken] = await Promise.all([
    listAttachments(),
    loadChecklist(),
    loadActiveShareToken(user.id),
  ]);
  const progress = checklistProgress(checklist);

  const nights = nightCount(trip.hotelIn, trip.hotelOut);
  const stayLabel = trip.hotelName
    ? trip.hotelName
    : trip.hotel === "Booked"
      ? "Hotel booked"
      : "No hotel added";

  return (
    <div className={s.page}>
      {/* Cover */}
      <header className={s.cover}>
        <div className={s.ph} />
        <div className={s.coverText}>
          <span className={s.chip}>{trip.country || "Your trip"}</span>
          <h1>{trip.dest}</h1>
          <p className={s.sub}>
            {trip.startDate && trip.endDate ? `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate)} · ` : ""}
            {trip.party || ""}
          </p>
        </div>
      </header>

      {/* Quick facts */}
      <div className={s.facts}>
        <div className={s.fact}>
          <dt>Flight</dt>
          <dd>{trip.flightNo || (trip.flight === "Booked" ? "Booked" : "Not added")}</dd>
        </div>
        <div className={s.fact}>
          <dt>Stay</dt>
          <dd>{nights ? `${nights} nights` : stayLabel}</dd>
        </div>
        <div className={s.fact}>
          <dt>Checklist</dt>
          <dd>
            <Link href="/checklist" className={s.progressLink}>
              {progress.done} of {progress.total}
              <span className={s.pbar}><span className={s.pfill} style={{ width: `${progress.pct}%` }} /></span>
            </Link>
          </dd>
        </div>
      </div>

      <div className={s.cols}>
        <div className={s.main}>
          {/* Flight card */}
          <Suspense fallback={<FlightSkeleton />}>
            <FlightSection trip={trip} />
          </Suspense>

          {/* Stay card */}
          <article className="card card-pad">
            <div className={s.cardTop}>
              <span className="k-eyebrow">Stay</span>
            </div>
            <p className={s.bigVal}>{stayLabel}</p>
            <dl className={s.metaGrid}>
              <div><dt>Status</dt><dd>{trip.hotel === "Booked" ? "Booked" : trip.hotel || "—"}</dd></div>
              <div><dt>Check-in</dt><dd>{trip.hotelIn || "—"}</dd></div>
              <div><dt>Check-out</dt><dd>{trip.hotelOut || "—"}</dd></div>
              <div><dt>Travelers</dt><dd>{trip.party || "—"}</dd></div>
            </dl>
          </article>
        </div>

        <aside className={s.side}>
          {/* Checklist card */}
          <article className="card card-pad">
            <div className={s.cardTop}>
              <span className="k-eyebrow">Checklist</span>
              <Link className="btn btn-ghost btn-sm" href="/checklist">Open</Link>
            </div>
            <div className={s.pbarWrap}>
              <div className={s.pbarTrack}><div className={s.pbarFill} style={{ width: `${progress.pct}%` }} /></div>
              <span className={s.pbarLabel}>{progress.done} of {progress.total} done</span>
            </div>
          </article>

          {/* Documents */}
          <article className="card card-pad">
            <div className={s.cardTop}>
              <span className="k-eyebrow">Documents</span>
            </div>
            <TripAttachments attachments={attachments} />
          </article>

          {/* Sharing */}
          <article className="card card-pad">
            <div className={s.cardTop}>
              <span className="k-eyebrow">Shared with family</span>
            </div>
            {shareToken ? (
              <div className={s.shareOn}>
                <span className={s.shareDot} />
                <span className={s.shareLabel}>Live · family can see your status</span>
                <Link className="btn btn-ghost btn-sm" href={`/shared/${shareToken}`} target="_blank">
                  View link
                </Link>
              </div>
            ) : (
              <p className={s.shareOff}>
                Sharing is off.{" "}
                <Link href="/settings" className={s.shareLink}>Turn it on in Settings.</Link>
              </p>
            )}
          </article>
        </aside>
      </div>
    </div>
  );
}

async function FlightSection({ trip }: { trip: Partial<OnboardingAnswers> }): Promise<React.ReactElement> {
  const flight = await loadTripFlight(trip);
  return <FlightCard flight={flight} />;
}

function FlightSkeleton(): React.ReactElement {
  return (
    <article className="card card-pad" aria-busy="true">
      <div className={s.cardTop}>
        <span className="k-eyebrow">Flight</span>
        <span className="pill pill-neutral">Checking…</span>
      </div>
      <p className={s.bigValMuted}>Loading live status…</p>
    </article>
  );
}

function FlightCard({ flight }: { flight: TripFlight }): React.ReactElement {
  if (flight.state === "none") {
    return (
      <article className="card card-pad">
        <div className={s.cardTop}><span className="k-eyebrow">Flight</span></div>
        <p className={s.bigValMuted}>No flight added</p>
        <p className={s.note}>Add a flight number in onboarding to see live status here.</p>
      </article>
    );
  }
  if (flight.state === "unavailable") {
    return (
      <article className="card card-pad">
        <div className={s.cardTop}>
          <span className="k-eyebrow">Flight</span>
          <span className="pill pill-neutral">No live status</span>
        </div>
        <p className={s.bigVal}>{flight.flightNo}</p>
        <p className={s.note}>{flight.reason}</p>
      </article>
    );
  }
  const delayText =
    flight.delayMinutes === null
      ? null
      : flight.delayMinutes <= 0
        ? "On time"
        : `${flight.delayMinutes} min late`;
  const pillClass =
    flight.tone === "ok" ? "pill pill-ok" : flight.tone === "warn" ? "pill pill-risk" : flight.tone === "bad" ? "pill pill-miss" : "pill pill-neutral";
  return (
    <article className="card card-pad">
      <div className={s.cardTop}>
        <span className="k-eyebrow">Flight</span>
        <span className={pillClass}>{flight.statusLabel}</span>
      </div>
      <div className={s.bigRow}>
        <p className={s.bigVal}>{flight.flightNo}</p>
        {delayText ? (
          <span className={flight.delayMinutes && flight.delayMinutes > 0 ? s.delayBad : s.delayOk}>
            {delayText}
          </span>
        ) : null}
      </div>
      <dl className={s.metaGrid}>
        <div><dt>Seat(s)</dt><dd>{flight.seat || "—"}</dd></div>
        <div><dt>Arrives</dt><dd>{flight.arrivalAirport || "—"}</dd></div>
        <div><dt>Scheduled arrival</dt><dd>{flight.scheduledArrival || "—"}</dd></div>
        <div>
          <dt>{flight.actualArrival ? "Actual arrival" : "Expected arrival"}</dt>
          <dd>{flight.actualArrival || flight.predictedArrival || "—"}</dd>
        </div>
      </dl>
      <p className={s.note}>Live status via {flight.provider}.</p>
    </article>
  );
}

function fmtDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

function nightCount(inn?: string, out?: string): number | null {
  if (!inn || !out) return null;
  const a = new Date(`${inn}T00:00:00`).getTime();
  const b = new Date(`${out}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}
