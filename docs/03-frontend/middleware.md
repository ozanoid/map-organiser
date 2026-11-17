---
title: Middleware
type: overview
domain: frontend
version: 1.2.0
last_updated: 17.11.2026
status: stable
sources:
  - src/middleware.ts
  - src/lib/supabase/middleware.ts
related:
  - "[[_README]]"
  - "[[routing]]"
  - "[[../02-backend/auth]]"
  - "[[../02-backend/supabase-clients#middlewarets-updatesessionrequest---request-middleware]]"
---

# Middleware

The Next.js middleware. Runs before every non-static request. Pure auth gate today — refreshes the Supabase session cookie and decides whether to redirect.

This page is the frontend view. For the gate logic, RLS link, and the OAuth handshake, see [[../02-backend/auth]]. For the Supabase client mechanics, see [[../02-backend/supabase-clients#middlewarets-updatesessionrequest---request-middleware]].

## Wiring

`src/middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Two pieces:

1. **`middleware`** — the request handler. Delegates entirely to `updateSession`.
2. **`config.matcher`** — the path filter. Negates static assets and common image extensions; everything else gets the middleware.

## What `updateSession` does

`src/lib/supabase/middleware.ts`. See [[../02-backend/auth#middleware-gate]] for the full annotated source. Summary:

1. `/signup` → redirect to `/login` and stop (sign-ups closed, 17.11.2026). No Supabase client is built for it.
2. Construct an SSR Supabase client backed by request cookies.
3. Call `supabase.auth.getUser()` — this triggers a token refresh if needed.
4. Write refreshed cookies onto the response.
5. Decide:
   - Public path → continue.
   - Auth path (`/login`) with a logged-in user → redirect to `/map`.
   - Any other path without a user → redirect to `/login`.
6. Return the response.

## Public paths

Hard-coded list in `updateSession`:

- `/` (the landing/redirect page)
- `/auth/callback/*` (OAuth handshake)
- `/shared/*` (public share pages)
- `/api/shared/*` (public share APIs)
- `/api/cron/*` (cron routes — they authenticate themselves with `CRON_SECRET`)

Everything else requires auth.

## Special middleware concerns

### Middleware is the only writer of refreshed cookies

The browser client, the server client, and the service-role client can **read** cookies. Only the middleware writes refreshed ones. If you ever shortcut the middleware for a path that needs an authenticated context, sessions will silently expire mid-use.

This is why the matcher only excludes static assets — every dynamic path goes through the middleware.

### The matcher in plain English

`/((?!_next/static|_next/image|favicon.ico|sw\.js$|manifest\.webmanifest$|offline$|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`

- `?!` is a negative lookahead.
- Excludes `_next/static`, `_next/image`, `favicon.ico`, any URL ending in `.svg / .png / .jpg / .jpeg / .gif / .webp`, and three public files a signed-out visitor must be able to load: `/sw.js` (service worker), `/manifest.webmanifest` (PWA manifest) and `/offline` (the page the service worker precaches). Until 17.11.2026 these three went through the session check and were redirected to `/login`, so on the public share pages and the login page the service worker never registered (console: "The script resource is behind a redirect").
- Everything else matches.
- Next.js needs the matcher as a literal constant (it is analysed at build time), so a new exclusion goes into this string, not into a variable.

### Next.js 16: `middleware` → `proxy`

The dev server warns that the `middleware` file convention is deprecated in favour of `proxy` (seen 17.11.2026). `src/middleware.ts` still runs; renaming it is a separate change — see `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.

### Adding a new public route

If a new path needs to be public:

1. Add the prefix check in `src/lib/supabase/middleware.ts#updateSession`:
   ```ts
   const isPublicRoute =
     request.nextUrl.pathname === "/" ||
     request.nextUrl.pathname.startsWith("/auth/callback") ||
     request.nextUrl.pathname.startsWith("/shared/") ||
     request.nextUrl.pathname.startsWith("/api/shared/") ||
     request.nextUrl.pathname.startsWith("/<new-prefix>/"); // add here
   ```
2. Update [[../02-backend/auth#public-route-table]].
3. Update [[routing]] to mark the route as public.
4. Log in [[../CHANGELOG]].

### Adding a new auth-gated route

Default behavior — no changes needed. The middleware redirects unauthenticated users to `/login` for any path not in the public list and not an auth route.

## Next.js 16 note

The Vercel knowledge update mentions `proxy.ts` being preferred over `middleware.ts` in Next.js 16. This repo still uses `middleware.ts`. As of `last_updated`, both names work; `middleware.ts` is the older convention and continues to be supported. **No urgency to rename**, but if the Next.js team announces deprecation, this is the migration target. See [[../_agent/pitfalls#next-js-16]] (to be updated).

## Not in the middleware

For clarity, the middleware does NOT:

- Handle rewrites or redirects beyond the auth gate.
- Inspect request bodies (it can't read them efficiently).
- Talk to external services other than Supabase Auth.
- Modify Server Component responses (only redirects or pass-through).
- Touch the DB tables beyond `auth.getUser()`.

If you need any of those, build a route handler instead.

## Debugging

When something behaves like a session bug:

1. **Check the Network tab.** Look at cookies on the response — does the middleware path return refreshed `sb-...` cookies?
2. **`console.log` inside `updateSession`.** Cheap, fast, doesn't show up in production unless you commit it.
3. **`supabase.auth.getUser()` return value.** `null` means no session is being recovered from cookies — verify the matcher is including the path.
4. **Open `/auth/callback?code=...` directly.** Should exchange the code and redirect to `/map`. If it doesn't, the OAuth side is broken, not the middleware.
