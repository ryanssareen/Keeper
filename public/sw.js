/* Keeper service worker (U8).
 *
 * Two notification shapes ride the same push channel, distinguished by payload `type`:
 *   - "catch"        — the cascade alert (sent by the U8 dispatcher). Clicking focuses/opens the
 *                      dashboard URL carried in `data.url`.
 *   - "self_report"  — the one-shot outcome ask (sent later by U9). Action buttons made/missed/changed
 *                      POST to /api/self-report with the watchId + capability token from `data`.
 *
 * Plain JS on purpose: this file is served verbatim from /public; it is not bundled or typechecked.
 */

self.addEventListener("install", () => {
  // Activate this version immediately rather than waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of already-open clients so the first push after registration is handled.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  event.waitUntil(showFor(payload));
});

function readPayload(event) {
  if (!event.data) {
    return null;
  }
  try {
    return event.data.json();
  } catch (_e) {
    // A non-JSON push still deserves a generic notification rather than silent loss.
    return { type: "catch", title: "Keeper", body: event.data.text() };
  }
}

function showFor(payload) {
  if (!payload) {
    return self.registration.showNotification("Keeper", {
      body: "Open Keeper to see the latest on your flight.",
    });
  }

  if (payload.type === "self_report") {
    return self.registration.showNotification(payload.title || "How did it go?", {
      body: payload.body || "",
      tag: "keeper-self-report",
      requireInteraction: true,
      data: payload.data || {},
      actions: [
        { action: "made", title: "Made it" },
        { action: "missed", title: "Missed it" },
        { action: "changed", title: "Plans changed" },
      ],
    });
  }

  // Default: a catch (cascade alert).
  return self.registration.showNotification(payload.title || "Keeper", {
    body: payload.body || "",
    tag: "keeper-catch",
    requireInteraction: true,
    data: payload.data || {},
    actions: [{ action: "open", title: "See details" }],
  });
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  notification.close();

  if (notification.tag === "keeper-self-report" && isOutcome(event.action)) {
    event.waitUntil(postSelfReport(data, event.action));
    return;
  }

  // Any other click (the catch, or a self-report body tap) focuses/opens the dashboard.
  const url = data.url || "/dashboard";
  event.waitUntil(focusOrOpen(url));
});

function isOutcome(action) {
  return action === "made" || action === "missed" || action === "changed";
}

// Contract owned by U9: POST /api/self-report { watchId, token, outcome, wasUseful? }.
function postSelfReport(data, outcome) {
  if (!data.watchId || !data.token) {
    return Promise.resolve();
  }
  return fetch("/api/self-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watchId: data.watchId, token: data.token, outcome }),
  }).catch(() => {
    // Best-effort: a failed POST shouldn't reject the notificationclick handler.
  });
}

function focusOrOpen(url) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    });
}
