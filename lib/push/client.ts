import { urlBase64ToUint8Array } from "@/components/InstallPrompt";

/** Stable per-device id (shared with the arm flow) so a push deep-link can self-heal on this device. */
export function getDeviceId(): string {
  const KEY = "keeper-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export type SubscribeResult = "subscribed" | "denied" | "unsupported" | "error";

/**
 * Request notification permission and register a web-push subscription for this device (U8). Pure
 * client helper extracted from InstallPrompt so the onboarding wizard and settings can both trigger
 * it. The VAPID PUBLIC key only — the private key never reaches the browser.
 */
export async function subscribePush(): Promise<SubscribeResult> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return "unsupported";
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return "error";

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

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
    return res.ok ? "subscribed" : "error";
  } catch {
    return "error";
  }
}
