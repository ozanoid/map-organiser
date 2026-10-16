---
title: Supabase Clients
type: overview
domain: backend
version: 1.1.1
last_updated: 16.10.2026
status: stable
sources:
  - src/lib/supabase/client.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/middleware.ts
related:
  - "[[auth]]"
  - "[[rls-policies]]"
  - "[[../_agent/conventions#supabase-clients]]"
  - "[[../_agent/pitfalls#supabase-supabase-ssr]]"
---

# Supabase Clients

This repo has **three Supabase clients** plus a **service-role helper**, all in `src/lib/supabase/`. Picking the wrong one breaks auth silently — there is no runtime error, just an unauthenticated request.

## The four clients

| File | Function | Runtime | Returns | RLS |
|---|---|---|---|---|
| `client.ts` | `createClient()` | Browser (Client Components) | `SupabaseClient` (browser) | Respected (anon role until session) |
| `server.ts` | `createClient()` | Server (Server Components, Route Handlers, Server Actions) | `SupabaseClient` (cookies via `next/headers`) | Respected (authenticated role via cookie session) |
| `server.ts` | `createServiceClient()` | Server only, restricted | `SupabaseClient` (service-role key) | **BYPASSED** |
| `middleware.ts` | `updateSession(request)` | Next.js middleware | `NextResponse` | Respected; refreshes session cookies |

## When to use which

### `client.ts#createClient()` — browser

```ts
"use client";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
```

Use inside any Client Component that:

- Subscribes to realtime channels.
- Listens for auth state changes (`supabase.auth.onAuthStateChange`).
- Needs to upload directly to Storage from the browser.

**Don't** use it for ordinary data fetching — prefer a TanStack Query hook in `src/lib/hooks/` that itself uses this client.

### `server.ts#createClient()` — server-side, user-scoped

```ts
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // ... regular queries, RLS will enforce user_id = auth.uid()
}
```

Use in:

- Every API route handler (`route.ts`).
- Server Components that read user data.
- Server Actions.

The cookies come from `next/headers`. The `setAll` callback tries to write cookies and silently ignores the error in Server Component context (where cookies can't be set). The middleware is responsible for actually writing refreshed cookies — see [[#why-middleware-matters]].

### `server.ts#createServiceClient()` — bypass RLS

```ts
import { createServiceClient } from "@/lib/supabase/server";
const supabase = createServiceClient(); // bypasses RLS — use with care
```

**Used only where no session can do the job** (checked 16.10.2026 — `createServiceClient` is imported by these seven files):

| File | Why the service role |
|---|---|
| `src/app/api/shared/[slug]/route.ts` | Public read of a shared list/trip/place — the viewer is anonymous, so the user-scoped client can't read the underlying rows; the route assembles a whitelisted public payload. |
| `src/app/api/shared/[slug]/save/route.ts` | Reads the shared **originals** only (they belong to another user); every insert stays on the viewer's cookie client. |
| `src/app/api/cron/refresh-places/route.ts` | Daily sweep across users — no cookie. |
| `src/app/api/cron/drain-imports/route.ts` | Drains the import queue across users — no cookie (v1.26.0). |
| `src/app/api/places/import-jobs/route.ts` | Inserts `import_job_items`, which has no INSERT policy on purpose (v1.26.0). |
| `src/app/api/instagram/import/route.ts` | The `after()` job that reads the post and writes the job's items, after the response has gone (v1.28.0). |
| `src/app/api/instagram/import/[id]/pick/route.ts` | Moves a skipped item back into the queue (or marks it `Already exists`) after the session client has read the job and the item under RLS — `import_job_items` has no UPDATE policy (v1.28.1). |

Every query on this client filters by `user_id` (or by an id the server itself
created, or has just read through the session client) explicitly — RLS is not
there to catch a mistake.

**Hard rules:**

- Never import in a Client Component or anything bundled to the browser. The service-role key is server-only.
- Never use to do something the user-scoped client could do — that's a recipe for accidental data leaks.
- Never log queries made through this client to user-visible places.
- Env: `SUPABASE_SERVICE_ROLE_KEY` (server only — **note this is missing from `.env.local.example`**).

### `middleware.ts#updateSession(request)` — request middleware

Used only from `src/middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

Behavior:

1. Reads cookies from the incoming request.
2. Calls `supabase.auth.getUser()` to refresh tokens if expired.
3. Writes refreshed cookies back to the response.
4. Redirects unauthenticated users to `/login` (with public-route exceptions).
5. Redirects logged-in users away from `/login` and `/signup` to `/map`.

Public routes (no auth required): `/`, `/auth/callback/*`, `/shared/*`, `/api/shared/*`.

See [[auth]] for the full flow.

## Why middleware matters

The browser and server clients on their own can read auth state from cookies, but **only the middleware writes refreshed cookies** back to the response. Without it, expired sessions never refresh — users get unauthenticated mid-session.

If you change the middleware matcher or shortcut it for a path, **make sure the path doesn't need an authenticated Supabase context** — or it'll start failing silently after the token expires.

## Visual: which client where

```
┌─────────────────────────────────────────────────────────────┐
│ src/middleware.ts                                            │
│   └─ updateSession() → middleware.ts#createServerClient      │
│                          (cookies from NextRequest)           │
└──────────────────────────┬──────────────────────────────────┘
                           │ cookies refreshed
                           ▼
┌──────────────────────────┴──────────────────────────────────┐
│ Page render                                                   │
│                                                               │
│ Server Components ────► server.ts#createClient()              │
│                          (cookies via next/headers)           │
│                                                               │
│ API route handlers ───► server.ts#createClient()              │
│                          (cookies via next/headers)           │
│                          OR                                   │
│                         server.ts#createServiceClient()       │
│                          (share reads, crons, import queue,   │
│                           Instagram job — table above)        │
│                                                               │
│ Client Components ────► client.ts#createClient()              │
│                          (browser cookies, anon → auth)       │
└─────────────────────────────────────────────────────────────┘
```

## Mistakes that bite

- **Importing `client.ts` into a Server Component.** Works locally (no error) but uses the wrong cookie strategy — auth state can drift.
- **Importing `server.ts` into a Client Component.** Fails at build with "next/headers can't be used in client component".
- **Using `createServiceClient()` where the cookie client would do, or without a `user_id` filter.** Bypasses RLS — every query returns every row across all users. Hard to detect, easy to ship. Add a new caller to the table in the `createServiceClient()` section above only with a reason no session can serve.
- **Forgetting to `await createClient()`** in `server.ts`. The function is `async` because `cookies()` is async in Next.js 16.

See [[../_agent/pitfalls#supabase-supabase-ssr]] for the canonical list.

## Auth API helpers

All four clients expose the same `auth` namespace. The methods this repo uses:

- `supabase.auth.getUser()` — returns `{ data: { user }, error }`. Use in API routes for auth gating.
- `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })` — used in `(auth)/login/page.tsx`.
- `supabase.auth.signUp(...)` — used in `(auth)/signup/page.tsx`.
- `supabase.auth.exchangeCodeForSession(code)` — used in `src/app/auth/callback/route.ts`.
- `supabase.auth.signOut()` — used in `AppHeader` logout button.

## Generated types

There is **no** `database.types.ts` in this repo. Types come from hand-maintained `src/lib/types/index.ts`. If the schema and types drift, the TypeScript layer won't catch it. Worth wiring `supabase gen types` into a script — see [[../06-ops/runbooks/regenerate-db-types]] when written.
