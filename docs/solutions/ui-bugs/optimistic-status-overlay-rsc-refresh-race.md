---
title: "UI toggle driven by server data flashes/reverts after a server action + router.refresh()"
date: 2026-06-08
category: ui-bugs
module: itinerary
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A completion tick (✓) renders for a few seconds after marking an item done, then disappears"
  - "The revert is non-deterministic — sometimes the tick persists, sometimes it flashes off"
  - "No console error and no network error; the DB write succeeds — the revert is purely visual"
  - "Worse under refetch latency (slow connection / cache pressure); hard to reproduce locally"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [optimistic-ui, rsc, router-refresh, server-actions, react-19, async-timing, itinerary]
---

# UI toggle driven by server data flashes/reverts after a server action + router.refresh()

> `component: frontend_stimulus` is the only frontend value in the schema; the actual component is a React **`"use client"`** RSC component (`components/app/ItineraryView.tsx`). Read it as "frontend component."

## Problem

On `/trips/itinerary` (Next.js 16 App Router), toggling an itinerary item's completion status showed the ✓ tick for a few seconds, then it vanished and the item appeared to revert to un-done — non-deterministically. The tick was rendered **purely from server-fetched data** (`it.status === "completed"`) with no client state holding the user's intended value.

## Symptoms

- Click the checkbox → ✓ shows briefly → item reverts to un-done.
- Non-deterministic; reproduces more reliably under refetch latency, hard to catch locally.
- No console/network error — the Supabase write and `revalidatePath` both succeed. The revert is visual only.

## What Didn't Work

Relying on **`server action → revalidatePath → router.refresh()` alone** to reflect a mutation is a timing race when there is no client state holding the new value:

1. Click → `setItemStatus(id, next)` fires (async round-trip).
2. The server action writes the row and calls `revalidatePath("/trips/itinerary")`.
3. The client calls `router.refresh()` to pull fresh server data.
4. **The race:** between the revalidation and the refreshed Server Component tree settling, the App Router can re-render the page with the **still-cached, pre-mutation** props. During that window `it.status` is still `"planned"`, so the tick disappears.
5. When the refetch lands, `"completed"` renders — but the user has already seen the flash-and-revert.

There is no client state, so every intermediate render uses whatever the server last handed back. (This is why it's timing/cache-dependent and hard to reproduce on a fast local box.)

## Solution

Add an **optimistic per-item status overlay** in the client component so the UI holds the intended value immediately and through the whole refetch cycle.

**Before** — server-data-only render, no client state:
```tsx
const done = it.status === "completed"; // driven purely by the server prop
async function onToggle(item) {
  await setItemStatus(item.id, next);
  router.refresh(); // stale props can win during the refetch → flash/revert
}
```

**After** — `components/app/ItineraryView.tsx`:
```tsx
const [statusOverride, setStatusOverride] = useState<Record<string, ItemStatus>>({});
const statusOf = (it: ItineraryItem): ItemStatus => statusOverride[it.id] ?? it.status;

async function onToggle(item: ItineraryItem): Promise<void> {
  const current = statusOf(item);
  const next: ItemStatus = current === "completed" ? "planned" : "completed";

  // Optimistic: flip the tick immediately; it holds through the refetch.
  setStatusOverride((prev) => ({ ...prev, [item.id]: next }));
  setPendingId(item.id);
  try {
    const res = await setItemStatus(item.id, next);
    if (!res.ok) {
      setStatusOverride((prev) => ({ ...prev, [item.id]: current })); // revert on failure
      setError(res.error);
    } else {
      router.refresh(); // server reconciles to the SAME value — no window where stale wins
    }
  } finally {
    setPendingId(null);
  }
}

// Render uses statusOf(it), NOT it.status:
const done = statusOf(it) === "completed";
```

The server action is unchanged (it already returns a typed result and revalidates):
```ts
export async function setItemStatus(id: string, status: string): Promise<ActionResult> {
  // ... auth + ownership-scoped Supabase update ...
  revalidatePath("/trips/itinerary");
  return { ok: true };
}
```

## Why This Works

`statusOverride` lives in client state and is set **synchronously before** the async call, so every re-render in the race window reads `statusOverride[id] ?? it.status` and the optimistic value wins. When `router.refresh()` finally delivers fresh data, the server value matches the override, so the UI stays consistent — there is no longer a moment where stale server data overrides the user's action. The override map is never cleared on success (it's harmlessly redundant once props catch up); a regenerate mints **new item ids**, so stale overrides for deleted items can't linger. On failure the override is explicitly reverted, giving instant "that didn't work" feedback.

Verified live: the tick appears at ~150ms (before any round-trip) and persists; the DB confirms the status persisted.

## Prevention

**Rule:** any UI element driven purely by server-fetched props that changes via a server action + `router.refresh()` is vulnerable to a flash/revert race. Hold the intended value in client state (an optimistic overlay) so it survives the refetch.

- The same race exists on **remove** and on any toggle / status chip / counter updated by a server action.
- **`useOptimistic` caveat:** React's `useOptimistic` reverts the optimistic value to the base (server) value when the async transition *ends* — which can be **before** `router.refresh()` has re-rendered, reproducing the same flash if the transition resolves faster than the refetch. An explicit `useState` override map avoids that because it is only cleared on explicit revert (failure), never auto-reverted.
- Prefer optimistic feedback for instant UX anyway — it removes the visible server round-trip from the interaction.

## Related Issues

- GitHub issue #7 — "Itinerary completion ticks flash on then disappear" (this bug; full narrative + fix).
- Adjacent: project memory `keeper-trips-feature` notes that `router.refresh()` re-runs the page's server fetches (the same mechanism, flagged there for re-hitting an external API).
- Distinct from `docs/solutions/build-errors/nextjs-server-client-module-boundary.md` (a build-time `"use server"` bundler issue, not a runtime render race).
