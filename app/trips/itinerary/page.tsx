import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { loadItinerary } from "@/lib/itinerary/queries";
import { AppShell } from "@/components/app/AppShell";
import { ItineraryView } from "@/components/app/ItineraryView";
import s from "./itinerary.module.css";

export const metadata: Metadata = { title: "Keeper — Itinerary" };
// Generation runs as a server action from this page: a Groq call + sequential geocoding (capped).
// Raise the function budget above the platform default so a multi-day plan can't be killed mid-run.
export const maxDuration = 120;

export default async function ItineraryPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/trips/itinerary");

  const shellUser = {
    name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "",
  };

  const onboarding = await loadOnboarding();
  const trip = onboarding?.completed && onboarding.answers?.dest ? onboarding.answers : null;
  const items = trip ? await loadItinerary() : [];

  const tripDates =
    trip && trip.startDate && trip.endDate ? `${trip.startDate} → ${trip.endDate}` : null;
  const anchors = trip
    ? [
        trip.dest,
        tripDates,
        trip.flight === "Booked" && trip.flightNo ? `flight ${trip.flightNo}` : null,
        trip.hotelName ? `hotel ${trip.hotelName}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const hasDates = Boolean(trip && (trip.startDate || trip.endDate || trip.hotelIn || trip.flightDate));

  const rail = (
    <nav className={s.rail}>
      <span className={s.railLabel}>Trips</span>
      <Link className={s.railItem} href="/trips">{trip?.dest ?? "Your trip"}</Link>
      <Link className={`${s.railItem} ${s.railActive}`} href="/trips/itinerary">Itinerary</Link>
    </nav>
  );

  return (
    <AppShell
      user={shellUser}
      railMiddle={rail}
      header={
        <>
          <span>Trips</span>
          <span className={s.sep}>/</span>
          <b>Itinerary</b>
        </>
      }
    >
      {!trip ? (
        <div className={s.blank}>
          <h1>No trip yet</h1>
          <p>Set up your trip and Keeper can plan your days around your real bookings.</p>
          <Link className="btn btn-primary btn-lg" href="/onboarding" style={{ marginTop: 18 }}>Set up your trip</Link>
        </div>
      ) : (
        <ItineraryView
          items={items}
          anchors={anchors}
          hasDates={hasDates}
          dest={trip.dest ?? "your trip"}
          initialPrefs={trip.itineraryPrefs}
          party={trip.party}
        />
      )}
    </AppShell>
  );
}
