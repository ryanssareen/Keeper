import { searchAirports } from "@/lib/places/airports";

/**
 * GET /api/places?q= — destination autocomplete. Returns up to `limit` airport matches from the vendored
 * dataset (city / country / IATA), ranked by relevance. Public reference data (no secrets, read-only), so
 * it needs no auth; the proxy still stamps security headers and the mutation/origin guards don't apply to
 * GET. Keeps the ~450KB dataset on the server — the browser only ever receives the handful of matches.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 12) : 8;

  const results = searchAirports(q, limit);
  return Response.json({ results });
}
