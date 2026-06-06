/**
 * Pure parsing/serialization for the device-local capability-token store (`keeper-watches`).
 *
 * The arm form (app/page.tsx) saves `{ [watchId]: token }` here at arm time so a tokenless push
 * deep-link (/dashboard?id=…, which never carries the secret token) can self-heal on the SAME device:
 * the dashboard's client fallback (components/SelfReportForm.tsx → DashboardTokenFallback) reads the
 * token back by id and redirects to ?id=&token=. Both halves used to inline their own shape handling —
 * three chances to diverge on the legacy-list migration. Centralized here, PURE (a raw string in, a
 * value out — no localStorage, no DOM), so the tolerant parse is unit-tested without a browser,
 * mirroring the codebase's pure-decision / thin-IO split (see decideWatchAccess).
 *
 * The current shape is a map `{ [watchId]: token }`. An earlier build wrote a list
 * `[{ watchId, token }]`; reads tolerate both so a device that armed under the old shape still resolves.
 */

/** Tolerantly parse the raw `keeper-watches` value into a `{ [watchId]: token }` map. */
export function parseWatchTokenMap(raw: string | null): Record<string, string> {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  // Legacy shape: a list of { watchId, token } — fold it into the keyed map.
  if (Array.isArray(parsed)) {
    const map: Record<string, string> = {};
    for (const entry of parsed) {
      if (entry && typeof entry === "object") {
        const { watchId, token } = entry as { watchId?: unknown; token?: unknown };
        if (typeof watchId === "string" && typeof token === "string") {
          map[watchId] = token;
        }
      }
    }
    return map;
  }

  // Current shape: a map { [watchId]: token }. Keep only string values (drop any corruption).
  if (parsed && typeof parsed === "object") {
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  }

  return {};
}

/** Look up the capability token saved for `watchId`, or null if none is stored on this device. */
export function tokenForWatch(raw: string | null, watchId: string): string | null {
  const token = parseWatchTokenMap(raw)[watchId];
  return typeof token === "string" ? token : null;
}

/**
 * Add/overwrite `watchId`'s token and return the serialized map to write back. Migrates a legacy
 * list to the map shape in passing, so the store converges on one shape after the next arm.
 */
export function upsertWatchToken(raw: string | null, watchId: string, token: string): string {
  const map = parseWatchTokenMap(raw);
  map[watchId] = token;
  return JSON.stringify(map);
}
