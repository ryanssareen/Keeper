/**
 * Push-subscription endpoint validation (U8). PURE: a raw subscription -> a discriminated verdict.
 *
 * A push endpoint is an attacker-controllable URL the server will later POST to. We refuse to store
 * one whose host isn't a known browser push service, so the dispatcher can never be coerced into
 * sending requests to an arbitrary origin (SSRF). We also require the two encryption keys to be
 * present and to *look* like base64url, catching obviously-malformed payloads at the door — the
 * cryptographic truth is enforced later by web-push itself.
 *
 * Pure on purpose: no network, no DB, no clock. The route handler runs this before any UPSERT.
 */

/** The two keys a Web Push subscription carries (RFC 8291 / 8292). */
export interface SubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** A PushSubscription as serialized by the browser (`PushSubscription.toJSON()`), narrowed to what we store. */
export interface RawPushSubscription {
  endpoint: string;
  keys: SubscriptionKeys;
}

export type SubscriptionValidation =
  | { valid: true; endpoint: string; keys: SubscriptionKeys }
  | { valid: false; reason: SubscriptionRejection };

export type SubscriptionRejection =
  | "malformed_endpoint"
  | "untrusted_host"
  | "missing_keys"
  | "malformed_keys";

/**
 * Known browser push-service hosts. Exact hosts are matched verbatim; suffix entries match any
 * subdomain (the leading dot guarantees we match a label boundary, so `evil-push.apple.com.attacker.com`
 * can never satisfy `.push.apple.com`).
 */
const EXACT_HOSTS: readonly string[] = ["fcm.googleapis.com", "android.googleapis.com"];

const HOST_SUFFIXES: readonly string[] = [
  ".push.apple.com", // Safari / iOS APNs web push
  ".notify.windows.com", // Edge / WNS
  ".push.services.mozilla.com", // Firefox autopush
];

/** base64url: A–Z a–z 0–9 - _ with optional `=` padding, and non-trivial length. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** A p256dh public key is 65 bytes (~87 base64url chars); auth is 16 bytes (~22). Use loose floors. */
const MIN_P256DH_LEN = 40;
const MIN_AUTH_LEN = 16;

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (EXACT_HOSTS.includes(h)) {
    return true;
  }
  return HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function looksLikeBase64Url(value: unknown, minLen: number): value is string {
  return typeof value === "string" && value.length >= minLen && BASE64URL.test(value);
}

/**
 * Validate a subscription for storage. Returns a discriminated result rather than throwing so the
 * route can map the reason onto a 400 without a try/catch.
 */
export function validateSubscription(sub: RawPushSubscription): SubscriptionValidation {
  const endpoint = sub?.endpoint;
  let host: string;
  try {
    const url = new URL(endpoint);
    // Only https endpoints are legitimate push services; reject http/file/etc outright.
    if (url.protocol !== "https:") {
      return { valid: false, reason: "malformed_endpoint" };
    }
    host = url.host;
  } catch {
    return { valid: false, reason: "malformed_endpoint" };
  }

  if (!isAllowedHost(host)) {
    return { valid: false, reason: "untrusted_host" };
  }

  const keys = sub.keys;
  if (!keys || typeof keys !== "object") {
    return { valid: false, reason: "missing_keys" };
  }
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    return { valid: false, reason: "missing_keys" };
  }
  if (!looksLikeBase64Url(keys.p256dh, MIN_P256DH_LEN) || !looksLikeBase64Url(keys.auth, MIN_AUTH_LEN)) {
    return { valid: false, reason: "malformed_keys" };
  }

  return { valid: true, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
