/**
 * One instant formatter shared by push (U8) and the dashboard (U10), so the same UTC instant never
 * renders two slightly different ways across the surfaces. PURE: a UTC ISO string + an IANA zone in,
 * a deterministic wall-time string out — no machine clock, no process-locale dependence (the locale
 * is pinned per style). Built on Intl.DateTimeFormat (no Luxon) so it works in any runtime.
 *
 * Two house styles, picked explicitly by the caller:
 *  - "clock-12h"  → push's terse "8:30 PM" (en-US, h12). Empty string for a null instant.
 *  - "datetime-24h" / "weekday-24h" → the dashboard's stable 24-hour readouts (en-GB, h23).
 *
 * Both surfaces render in the commitment's own zone (what the traveler experiences), never UTC,
 * except formatUtc which is the dashboard's deliberate fixed-UTC readout (audit instants).
 */

/** The presentation styles the two surfaces need. Each pins its own locale + hour cycle. */
export type TimeStyle =
  | "clock-12h" // push: "8:30 PM"
  | "datetime-24h" // dashboard header: "Sat, 20 Dec, 20:00"
  | "weekday-24h"; // dashboard audit rows: "Sat, 20:00"

const OPTIONS: Record<TimeStyle, { locale: string; opts: Intl.DateTimeFormatOptions }> = {
  // en-US + h12 so AM/PM is stable regardless of the process locale (matches the old push format).
  "clock-12h": { locale: "en-US", opts: { hour: "numeric", minute: "2-digit", hourCycle: "h12" } },
  // en-GB + h23 so the dashboard reads 24-hour and never drifts on hydration.
  "datetime-24h": {
    locale: "en-GB",
    opts: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  },
  "weekday-24h": {
    locale: "en-GB",
    opts: { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  },
};

/**
 * Format a UTC ISO instant into local wall-time at `zone`, in the chosen house style.
 * A null instant yields "" (push relies on this to drop optional clauses). An unparseable instant
 * is returned verbatim, and an invalid/unknown zone falls back to the same style rendered in UTC —
 * we never throw on the render path.
 */
export function formatInZone(iso: string | null, zone: string, style: TimeStyle): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const { locale, opts } = OPTIONS[style];
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, ...opts }).format(d);
  } catch {
    // Unknown/invalid IANA zone — degrade to the fixed-UTC readout rather than crash the render.
    return formatUtc(iso, style);
  }
}

/**
 * Format a UTC ISO instant in a fixed UTC readout (the dashboard's audit timestamps). Server-stable
 * and locale-pinned so there is no client/server hydration drift. Appends " UTC" so the fixed frame
 * is unambiguous. Defaults to the weekday-24h style the dashboard uses for snapshot/firing rows.
 */
export function formatUtc(iso: string, style: TimeStyle = "weekday-24h"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const { locale, opts } = OPTIONS[style];
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(d) + " UTC";
}
