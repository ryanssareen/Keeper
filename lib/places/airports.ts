import airportsData from "./airports.json";
import type { Airport } from "./types";

/**
 * Server-side destination search over the vendored OpenFlights airport dataset (lib/places/airports.json,
 * ~5.6k IATA airports). Imported once at module scope so a warm serverless invocation reuses it; a linear
 * scored scan over a few thousand rows per keystroke is comfortably fast and needs no index. Exposed to the
 * client through app/api/places/route.ts — the dataset never ships to the browser.
 */
const ALL = airportsData as Airport[];

/**
 * Rank matches so the most likely destination floats up: an exact IATA code first, then city-prefix,
 * code-prefix, country-prefix, then substring hits. Within a tier we keep dataset order (sorted by city).
 */
function score(a: Airport, q: string): number {
  const city = a.city.toLowerCase();
  const country = a.country.toLowerCase();
  const code = a.code.toLowerCase();
  if (code === q) return 0;
  if (city.startsWith(q)) return 1;
  if (code.startsWith(q)) return 2;
  if (country.startsWith(q)) return 3;
  if (city.includes(q)) return 4;
  if (country.includes(q)) return 5;
  return Infinity;
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: { a: Airport; s: number }[] = [];
  for (const a of ALL) {
    const s = score(a, q);
    if (s !== Infinity) hits.push({ a, s });
  }
  hits.sort((x, y) => x.s - y.s);
  return hits.slice(0, limit).map((h) => h.a);
}
