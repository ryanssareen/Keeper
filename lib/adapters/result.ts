/**
 * Shared discriminated result for external adapters (U3 AeroDataBox, U4 Mapbox).
 * Frozen in the Step 2 contract pass — adapter bodies branch on `kind`, callers never throw.
 */
export type AdapterResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "error"; message: string };

export const ok = <T>(data: T): AdapterResult<T> => ({ kind: "ok", data });
export const notFound = <T>(): AdapterResult<T> => ({ kind: "not_found" });
export const rateLimited = <T>(retryAfterMs?: number): AdapterResult<T> => ({
  kind: "rate_limited",
  retryAfterMs,
});
export const adapterError = <T>(message: string): AdapterResult<T> => ({ kind: "error", message });
