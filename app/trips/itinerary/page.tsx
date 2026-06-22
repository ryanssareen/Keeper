import { redirect } from "next/navigation";

/** Legacy /trips/itinerary — redirects to the command-center Itinerary view. */
export default function TripsItineraryRedirect(): never {
  redirect("/itinerary");
}
