"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Enable-notifications / install affordance (U8).
 *
 * Web push only works on iOS from an *installed, standalone* PWA (iOS 16.4+). A plain "Enable
 * notifications" button in mobile Safari is a dead end — `Notification`/`PushManager` aren't even
 * defined there. So we branch on context: an iOS browser tab that isn't standalone gets
 * Add-to-Home-Screen instructions; everywhere else gets the real subscribe button.
 *
 * The browser `applicationServerKey` is the VAPID PUBLIC key, exposed as
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY. The private key NEVER reaches this component.
 *
 * The context detection ({@link detectInstallContext}) and the VAPID key decoder
 * ({@link urlBase64ToUint8Array}) are pure and exported for unit testing — they touch no globals.
 */

/** What the UI should offer, derived purely from the runtime context. */
export type InstallContext =
  | "subscribe" // push is available now (or will be after a permission prompt)
  | "ios-needs-install" // iOS Safari tab: must Add to Home Screen first
  | "unsupported"; // no push support and not an installable iOS path

export interface DetectInputs {
  /** `matchMedia("(display-mode: standalone)").matches`. */
  isStandaloneDisplay: boolean;
  /** Legacy iOS Safari signal: `navigator.standalone`. */
  navigatorStandalone: boolean | undefined;
  /** `navigator.userAgent`. */
  userAgent: string;
  /** Whether `PushManager`/`Notification`/serviceWorker exist in this context. */
  pushApiAvailable: boolean;
}

/** iOS (incl. iPadOS posing as Mac with touch — handled by the caller passing a hinting UA). */
function isIos(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

/**
 * PURE: decide what install affordance to show. An installed PWA (standalone display, or legacy
 * `navigator.standalone`) with push APIs can subscribe directly. An iOS browser tab without push
 * APIs must install first. Anything else genuinely can't do web push.
 */
export function detectInstallContext(inputs: DetectInputs): InstallContext {
  const standalone = inputs.isStandaloneDisplay || inputs.navigatorStandalone === true;

  if (inputs.pushApiAvailable && (standalone || !isIos(inputs.userAgent))) {
    return "subscribe";
  }
  if (isIos(inputs.userAgent) && !standalone) {
    return "ios-needs-install";
  }
  return "unsupported";
}

/**
 * PURE: decode a base64url VAPID public key into the Uint8Array `applicationServerKey` the Push API
 * requires. base64url -> base64 (+ padding) -> bytes. Exported for unit testing.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Allocate over a concrete ArrayBuffer so the result is a valid `BufferSource`
  // (applicationServerKey) under TS's SharedArrayBuffer-aware Uint8Array typing.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function readInstallContext(): InstallContext {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  const pushApiAvailable =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const nav = navigator as Navigator & { standalone?: boolean };
  return detectInstallContext({
    isStandaloneDisplay: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: nav.standalone,
    userAgent: navigator.userAgent,
    pushApiAvailable,
  });
}

// The install context is a one-time, browser-only read (no external changes to subscribe to). A
// stable no-op subscriber + a null server snapshot makes it SSR-safe with no setState-in-effect.
const subscribeNothing = (): (() => void) => () => {};

function getDeviceId(): string {
  const KEY = "keeper-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

type Status = "idle" | "working" | "subscribed" | "denied" | "error";

export function InstallPrompt() {
  // Client-only browser read (null on the server, the real context after hydration).
  const context = useSyncExternalStore(subscribeNothing, readInstallContext, () => null);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Register the worker so a push can be received once the user subscribes.
      navigator.serviceWorker.register("/sw.js").catch(() => {
        setStatus("error");
      });
    }
  }, []);

  const subscribe = useCallback(async () => {
    setStatus("working");
    try {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setStatus("error");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), subscription: sub.toJSON() }),
      });
      setStatus(res.ok ? "subscribed" : "error");
    } catch {
      setStatus("error");
    }
  }, []);

  if (context === null) {
    return null; // pre-mount; avoid flashing the wrong affordance
  }

  const card = "mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800";

  if (context === "ios-needs-install") {
    return (
      <div className={card}>
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Add Keeper to your Home Screen to get the catch
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            Tap the <span className="font-medium">Share</span> button in Safari.
          </li>
          <li>
            Choose <span className="font-medium">Add to Home Screen</span>.
          </li>
          <li>Open Keeper from the new icon, then enable notifications.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-400">
          iOS only delivers web push to installed apps (iOS 16.4+).
        </p>
      </div>
    );
  }

  if (context === "unsupported") {
    return (
      <div className={card}>
        <p className="text-sm text-zinc-500">
          This browser can’t deliver push notifications. Open Keeper in a supported browser to get the
          catch.
        </p>
      </div>
    );
  }

  return (
    <div className={card}>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        Get the catch the moment your flight slips
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        We’ll send one notification if your commitment is at risk — and the move to make.
      </p>
      <button
        type="button"
        onClick={subscribe}
        disabled={status === "working" || status === "subscribed"}
        className="mt-3 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {status === "subscribed"
          ? "Notifications on"
          : status === "working"
            ? "Enabling…"
            : "Enable notifications"}
      </button>
      {status === "denied" && (
        <p className="mt-2 text-xs text-amber-600">
          Notifications are blocked. Enable them for this site in your browser settings.
        </p>
      )}
      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">Couldn’t enable notifications — try again.</p>
      )}
    </div>
  );
}
