/**
 * Tunable engine constants — planning-time defaults (see plan U2 / Open Questions).
 * These are the knobs that decide useful-catch vs. spam vs. silence; tune against real catches.
 */
export const ENGINE = {
  egressMinutes: 35, // deplane + reach ground transport (domestic; intl/customs deferred)
  defaultMarginMinutes: 0, // be there exactly at commitment time unless the user sets more
  okAtRiskBandMinutes: 20, // deficit within this of the boundary => AT_RISK (pre-miss)
  antiFlapDeficitMinutes: 10, // must overshoot the deadline by this before firing a CATCH
  recoveryBandMinutes: 10, // must recover slack past the boundary by this before ALL_CLEAR
  recoveryDwellUpdates: 2, // ...sustained across this many updates
  stalenessCeilingMinutes: 30, // feed older than this => DEGRADED
  usableLeadMinutes: 30, // a catch with less lead than this is not "useful_lead"
} as const;
