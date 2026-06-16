/** A destination the user can pick: a real airport with an IATA code, its city and country. */
export type Airport = {
  code: string; // IATA, e.g. "LHR"
  city: string;
  country: string;
  name: string; // distinguishing airport name, e.g. "Heathrow" (for same-city disambiguation)
};

/** A handful of popular destinations shown as quick-pick chips (client-safe; no dataset import). */
export const POPULAR: Airport[] = [
  { code: "LIS", city: "Lisbon", country: "Portugal", name: "Portela" },
  { code: "LHR", city: "London", country: "United Kingdom", name: "Heathrow" },
  { code: "CDG", city: "Paris", country: "France", name: "Charles de Gaulle" },
  { code: "HND", city: "Tokyo", country: "Japan", name: "Haneda" },
  { code: "JFK", city: "New York", country: "United States", name: "John F Kennedy Intl" },
  { code: "BCN", city: "Barcelona", country: "Spain", name: "El Prat" },
];

/** "City, Country" label for a chosen airport (with the airport name when a city has several). */
export function airportLabel(a: Pick<Airport, "city" | "country">): string {
  return `${a.city}, ${a.country}`;
}
