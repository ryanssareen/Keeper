import Link from "next/link";
import type { Metadata } from "next";
import { loadOnboarding } from "@/lib/onboarding/queries";
import { loadItinerary } from "@/lib/itinerary/queries";
import { ItineraryView } from "@/components/app/ItineraryView";
import s from "./itinerary.module.css";

export const metadata: Metadata = { title: "Keeper — Itinerary" };
// Generation runs as a server action from this route: Groq call + sequential geocoding (capped).
export const maxDuration = 120;

export default async function AppItineraryPage(): Promise<React.ReactElement> {
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

  if (!trip) {
    return (
      <div className={s.blank}>
        <h1>No trip yet</h1>
        <p>Set up your trip and Keeper can plan your days around your real bookings.</p>
        <Link className="btn btn-primary btn-lg" href="/onboarding" style={{ marginTop: 18 }}>
          Set up your trip
        </Link>
      </div>
    );
  }

  return (
    <ItineraryView
      items={items}
      anchors={anchors}
      hasDates={hasDates}
      dest={trip.dest ?? "your trip"}
      initialPrefs={trip.itineraryPrefs}
      party={trip.party}
      descriptions={trip.itineraryDescriptions}
    />
  );
}
