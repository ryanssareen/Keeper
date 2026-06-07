import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { loadTripFlight, type TripFlight } from "@/lib/trips/flight";
import { listAttachments } from "@/lib/trips/queries";
import { AppShell } from "@/components/app/AppShell";
import { TripAttachments } from "@/components/app/TripAttachments";
import s from "./trips.module.css";

export const metadata: Metadata = { title: "Keeper — Your trips" };

export default async function TripsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/trips");

  const shellUser = {
    name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "",
  };

  const onboarding = await loadOnboarding();
  const trip = onboarding?.completed && onboarding.answers?.dest ? onboarding.answers : null;

  const rail = (
    <nav className={s.rail}>
      <span className={s.railLabel}>Trips</span>
      {trip ? (
        <Link className={`${s.railItem} ${s.railItemActive}`} href="/trips">
          <span className={s.railDest}>{trip.dest}</span>
          <span className={s.railSub}>{trip.country}</span>
        </Link>
      ) : (
        <span className={s.railEmpty}>No trips yet</span>
      )}
    </nav>
  );

  if (!trip) {
    return (
      <AppShell user={shellUser} railMiddle={rail} header={<span>Trips</span>}>
        <div className={s.blank}>
          <h1>No trips yet</h1>
          <p>Set up your first trip and Keeper will keep every booking, document, and plan in one calm place.</p>
          <Link className="btn btn-primary btn-lg" href="/onboarding" style={{ marginTop: 22 }}>Set up your trip</Link>
        </div>
      </AppShell>
    );
  }

  const [flight, attachments] = await Promise.all([loadTripFlight(trip), listAttachments()]);

  const hotel =
    trip.hotel === "Booked" && trip.hotelName ? `Booked · ${trip.hotelName}` : trip.hotel || "Not added";

  return (
    <AppShell
      user={shellUser}
      railMiddle={rail}
      header={
        <>
          <span>Trips</span>
          <span className={s.sep}>/</span>
          <b>{trip.dest}</b>
        </>
      }
      headerActions={<Link className="btn btn-secondary btn-sm" href="/onboarding">Edit trip</Link>}
    >
      <div className={s.page}>
        <header className={s.tripHead}>
          <span className={s.who}>Your trip</span>
          <h1>{trip.dest}{trip.country ? `, ${trip.country}` : ""}</h1>
          <p>Live flight status, your stay, and every document in one place.</p>
        </header>

        <div className={s.cards}>
          <FlightCard flight={flight} />

          <article className={s.card}>
            <div className={s.cardTop}>
              <span className={s.cardKicker}>Stay</span>
            </div>
            <div className={s.bigRow}>
              <span className={s.bigVal}>{trip.hotelName || (trip.hotel === "Booked" ? "Hotel booked" : "No hotel yet")}</span>
            </div>
            <dl className={s.metaGrid}>
              <div><dt>Status</dt><dd>{hotel.startsWith("Booked") ? "Booked" : trip.hotel || "—"}</dd></div>
              <div><dt>Check-in</dt><dd>{trip.hotelIn || "—"}</dd></div>
              <div><dt>Check-out</dt><dd>{trip.hotelOut || "—"}</dd></div>
              <div><dt>Travelers</dt><dd>{trip.party || "—"}</dd></div>
            </dl>
          </article>
        </div>

        <TripAttachments attachments={attachments} />
      </div>
    </AppShell>
  );
}

function FlightCard({ flight }: { flight: TripFlight }): React.ReactElement {
  if (flight.state === "none") {
    return (
      <article className={s.card}>
        <div className={s.cardTop}><span className={s.cardKicker}>Flight</span></div>
        <div className={s.bigRow}><span className={s.bigValMuted}>No flight added</span></div>
        <p className={s.note}>Add a flight number in onboarding to see live status here.</p>
      </article>
    );
  }

  if (flight.state === "unavailable") {
    return (
      <article className={s.card}>
        <div className={s.cardTop}>
          <span className={s.cardKicker}>Flight</span>
          <span className={`${s.statusPill} ${s.pillMuted}`}>No live status</span>
        </div>
        <div className={s.bigRow}><span className={s.bigVal}>{flight.flightNo}</span></div>
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

  return (
    <article className={s.card}>
      <div className={s.cardTop}>
        <span className={s.cardKicker}>Flight</span>
        <span className={`${s.statusPill} ${s[`pill_${flight.tone}`]}`}>{flight.statusLabel}</span>
      </div>
      <div className={s.bigRow}>
        <span className={s.bigVal}>{flight.flightNo}</span>
        {delayText ? <span className={`${s.delay} ${flight.delayMinutes && flight.delayMinutes > 0 ? s.delayBad : s.delayOk}`}>{delayText}</span> : null}
      </div>
      <dl className={s.metaGrid}>
        <div><dt>Seat(s)</dt><dd>{flight.seat || "—"}</dd></div>
        <div><dt>Arrives</dt><dd>{flight.arrivalAirport || "—"}</dd></div>
        <div><dt>Scheduled arrival</dt><dd>{flight.scheduledArrival || "—"}</dd></div>
        <div><dt>{flight.actualArrival ? "Actual arrival" : "Expected arrival"}</dt><dd>{flight.actualArrival || flight.predictedArrival || "—"}</dd></div>
      </dl>
      <p className={s.note}>Live status via {flight.provider}.</p>
    </article>
  );
}
