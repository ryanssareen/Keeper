import { redirect } from "next/navigation";

/** Legacy /trips — redirects to the command-center Bookings view. */
export default function TripsRedirect(): never {
  redirect("/bookings");
}
