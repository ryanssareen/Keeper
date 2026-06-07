---
title: "Next.js App Router build break — server-only module leaks into the client bundle"
date: 2026-06-07
category: build-errors
module: trips
problem_type: build_error
component: tooling
symptoms:
  - "next build aborts: \"You're importing a module that depends on 'next/headers'\""
  - "Error wrongly says \"you are using it in the Pages Router\" — the repo is 100% App Router"
  - "Import trace shows lib/supabase/server.ts pulled into the [Client Component Browser] graph"
  - "A \"use client\" component that only imports constants/types still triggers it"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [nextjs, app-router, server-components, next-headers, supabase-ssr, use-client, use-server, module-boundary]
related_components: [authentication, database]
---

# Next.js App Router build break — server-only module leaks into the client bundle

## Problem

A `"use client"` component imported constants/types from a shared feature module that *also* contained server-only read functions. Those reads imported `lib/supabase/server.ts` (which calls `cookies()` from `next/headers`), so the client component's import graph transitively dragged a server-only module into the **browser bundle** and the build failed.

## Symptoms

```
You're importing a module that depends on "next/headers".
This API is only available in Server Components in the App Router,
but you are using it in the Pages Router.

  import { cookies } from "next/headers";

Import traces:
  [Client Component Browser]:
    ./lib/supabase/server.ts
    → ./lib/trips/attachments.ts
    → ./components/app/TripAttachments.tsx
```

- Surfaces in the dev overlay and aborts `next build`.
- The **"Pages Router" wording is misleading** — Next.js emits this for *any* client bundle that reaches `next/headers`, regardless of router. Don't go hunting for Pages Router code; it's a bundle-boundary violation.
- It fires even when the client component only used a constant/type from the module — JS bundles the *whole* file, including its top-of-file `import { createClient } from "@/lib/supabase/server"`.

## What Didn't Work

The trap is the natural one: collect everything for a feature — types, constants, server reads, and mutations — into a single `lib/<feature>/<feature>.ts` "utils" module. The moment a `"use client"` component imports *anything* from it, the entire module (including its server-only imports) is pulled into the browser graph.

**(session history)** This is the *second* time the same `{constants / queries / actions}` split resolved a Next.js 16 App Router boundary failure in this repo — the earlier one had a different cause. In the `feat/web-app-shell-auth` session (2026-06-06), `loadOnboarding` (a read) and `saveOnboarding` (a mutation) both lived in one `"use server"` `actions.ts`. Calling the read from a Server Component made `loadOnboarding` run **as a Server Action rather than a plain query**, which lost cookie/request context and made `getUser()` return null — so the page always rendered at step 0. The Next.js 16 docs (`node_modules/next/dist/docs/01-app/`) were explicit: *"Server Functions are designed for server-side mutations… if you need data fetching, use data fetching in Server Components directly."* The fix then was the same shape: move the read into a directiveless `lib/onboarding/queries.ts`, keep the mutation in `actions.ts`. Two distinct failure modes, one structural cure.

## Solution

Split the feature's `lib/` code into three files **by execution context**:

**1. `lib/trips/attachments.ts` — client-safe leaf (NO server imports)**
```ts
// No imports from server-only modules. Safe to import from anywhere.
export const BUCKET = "trip-docs";
export const ATTACHMENT_KINDS = [
  { value: "flight", label: "Flight" },
  { value: "hotel", label: "Hotel" },
  // …
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]["value"];
export const isAttachmentKind = (v: unknown): v is AttachmentKind => /* … */;
export const kindLabel = (value: string): string => /* … */;
export type TripAttachment = { id: string; kind: AttachmentKind; /* … */ };
```

**2. `lib/trips/queries.ts` — server reads (called directly from Server Components)**
```ts
import { createClient } from "@/lib/supabase/server"; // server-only; client never imports this file
import { BUCKET, isAttachmentKind, type TripAttachment } from "@/lib/trips/attachments";

export async function listAttachments(): Promise<TripAttachment[]> { /* … */ }
export async function signedUrl(filePath: string, expiresInSeconds = 60): Promise<string | null> { /* … */ }
```

**3. `lib/trips/actions.ts` — `"use server"` mutations (safe to import from the client)**
```ts
"use server";
import { createClient } from "@/lib/supabase/server"; // hidden behind the "use server" RPC boundary
import { BUCKET, isAttachmentKind } from "@/lib/trips/attachments";
import { signedUrl } from "@/lib/trips/queries";

export async function uploadAttachment(formData: FormData): Promise<ActionResult> { /* … */ }
export async function deleteAttachment(id: string): Promise<ActionResult> { /* … */ }
export async function getDownloadUrl(filePath: string): Promise<string | null> { /* … */ }
```

**The client component now imports only client-safe + action modules:**
```ts
// components/app/TripAttachments.tsx
"use client";
import { ATTACHMENT_KINDS, kindLabel, type TripAttachment } from "@/lib/trips/attachments"; // ✓ leaf
import { uploadAttachment, deleteAttachment, getDownloadUrl } from "@/lib/trips/actions";   // ✓ "use server"
```

## Why This Works

The RSC bundler walks the import graph of every `"use client"` module and bundles everything it reaches for the browser. `next/headers` / `cookies()` has no browser equivalent, so the build fails the instant a server-only module appears anywhere in that graph.

The split creates hard boundaries:

- **`attachments.ts`** is a pure leaf — zero server imports — so it is always safe to import from any context.
- **`queries.ts`** imports the Supabase server client, but no client component imports `queries.ts`, so the browser bundler never visits it. (It must be a directiveless module, **not** `"use server"`, so Server Components call it as a plain async query and keep cookie context — see the session-history note above.)
- **`actions.ts`** also imports the server client, but the `"use server"` directive makes the bundler replace every export with an RPC stub on the client side; the real implementation never enters the browser bundle.

## Prevention

Apply this three-layer rule to any feature spanning client UI and server data:

| Layer | File | Holds | Server imports? |
|-------|------|-------|-----------------|
| Constants / types | `lib/<feature>/<feature>.ts` | Pure values, types, enums, side-effect-free helpers | **No** — keep it a leaf |
| Server reads | `lib/<feature>/queries.ts` | DB/storage/cookie reads, called from Server Components | Yes (directiveless, not `"use server"`) |
| Mutations | `lib/<feature>/actions.ts` | `"use server"` functions called from client UI | Yes (hidden behind RPC) |

- **Never co-locate server-only imports with constants/types a client component needs.** That single shared import is what leaks `next/headers` into the browser graph.
- **A read called from a Server Component goes in a directiveless `queries.ts`, not `actions.ts`** — a `"use server"` function invoked from a Server Component runs as a Server Action and loses request/cookie context.
- This generalizes beyond Supabase: any server-only dependency (`pg`/`prisma`, secret readers, `headers()`/`cookies()`, Node built-ins) triggers the same build break if it reaches the client graph.
- **`next build` catches this; `next dev` can mask it** — run a production build before relying on a clean dev server.

## Related Issues

- Project memory: `keeper-trips-feature` (records the `attachments.ts` / `queries.ts` / `actions.ts` split as deliberate design intent) and `keeper-supabase-grants-gotcha` (an adjacent Supabase boundary gotcha — base-table GRANTs vs RLS).
- Prior precedent (session history): the `lib/onboarding/{queries,actions}.ts` split that fixed `loadOnboarding` returning null — same pattern, Server-Action-context cause.
