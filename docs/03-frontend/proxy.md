---
title: Proxy
type: overview
domain: frontend
version: 1.5.0
last_updated: 19.11.2026
status: stable
sources:
  - src/proxy.ts
  - src/lib/supabase/proxy.ts
related:
  - "[[_README]]"
  - "[[routing]]"
  - "[[../02-backend/auth]]"
  - "[[../02-backend/supabase-clients#proxyts-updatesessionrequest---request-proxy]]"
---

# Proxy

The Next.js proxy. Runs before every non-static request. Pure auth gate today — refreshes the Supabase session cookie and decides whether to redirect.

This page is the frontend view. For the gate logic, RLS link, and the OAuth handshake, see [[../02-backend/auth]]. For the Supabase client mechanics, see [[../02-backend/supabase-clients#proxyts-updatesessionrequest---request-proxy]].

## Wiring

`src/proxy.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|api/mcp$|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Two pieces:

1. **`proxy`** — the request handler. Delegates entirely to `updateSession`.
2. **`config.matcher`** — the path filter. Negates static assets and common image extensions; everything else gets the proxy.

## What `updateSession` does

`src/lib/supabase/proxy.ts`. See [[../02-backend/auth#proxy-gate]] for the full annotated source. Summary:

1. `/signup` → redirect to `/login` and stop (sign-ups closed, 17.11.2026). No Supabase client is built for it.
2. Construct an SSR Supabase client backed by request cookies.
3. Call `supabase.auth.getUser()` — this triggers a token refresh if needed.
4. Write refreshed cookies onto the response.
5. Decide:
   - Public path → continue.
   - Auth path (`/login`) with a logged-in user → redirect to its `next` when that is a same-site path (`safeNextPath`), otherwise `/map`.
   - Any other path without a user → redirect to `/login?next=<path and query>`, so sign-in comes back to the page that was asked for — a plan link Claude gave, the iOS Shortcut's `/map?add=…` (v1.39.0; before, every sign-in landed on `/map`). API paths get no `next`: a fetch has no page to return to. The login page and `/auth/callback` follow `next` only through `safeNextPath`.
6. Return the response. Redirects copy the cookies from step 4 (`redirectKeepingSession`, v1.39.0) — a bare redirect would drop a refreshed session and leave the browser with a spent refresh token.

## Public paths

Hard-coded list in `updateSession`:

- `/` (the landing/redirect page)
- `/auth/callback/*` (OAuth handshake)
- `/shared/*` (public share pages)
- `/api/shared/*` (public share APIs)
- `/api/cron/*` (cron routes — they authenticate themselves with `CRON_SECRET`)
- `/oauth/*` (the OAuth consent page — it redirects signed-out visitors to `/login?next=…` itself, so the authorization request survives sign-in)

Not in the proxy at all (matcher exclusions, 17.11.2026): `/api/mcp` — the MCP endpoint authenticates bearer tokens and must answer 401 with a challenge, not a redirect — and `/.well-known/*` metadata documents.

Everything else requires auth.

## Special proxy concerns

### Proxy is the only writer of refreshed cookies

The browser client, the server client, and the service-role client can **read** cookies. Only the proxy writes refreshed ones. If you ever shortcut the proxy for a path that needs an authenticated context, sessions will silently expire mid-use.

This is why the matcher only excludes static assets — every dynamic path goes through the proxy.

### The matcher in plain English

`/((?!_next/static|_next/image|favicon.ico|sw\.js$|manifest\.webmanifest$|offline$|api/mcp$|\.well-known/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`

- `?!` is a negative lookahead.
- Excludes `_next/static`, `_next/image`, `favicon.ico`, any URL ending in `.svg / .png / .jpg / .jpeg / .gif / .webp`, and three public files a signed-out visitor must be able to load: `/sw.js` (service worker), `/manifest.webmanifest` (PWA manifest) and `/offline` (the page the service worker precaches). Until 17.11.2026 these three went through the session check and were redirected to `/login`, so on the public share pages and the login page the service worker never registered (console: "The script resource is behind a redirect").
- Everything else matches.
- Next.js needs the matcher as a literal constant (it is analysed at build time), so a new exclusion goes into this string, not into a variable.

### Next.js 16: `proxy` → `proxy`

The dev server warns that the `proxy` file convention is deprecated in favour of `proxy` (seen 17.11.2026). `src/proxy.ts` still runs; renaming it is a separate change — see `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.

### Adding a new public route

If a new path needs to be public:

1. Add the prefix check in `src/lib/supabase/proxy.ts#updateSession`:
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

Default behavior — no changes needed. The proxy redirects unauthenticated users to `/login?next=…` for any path not in the public list and not an auth route, and sign-in returns them to it.

## Next.js 16: middleware → proxy (v1.44.0)

Until v1.44.0 this file was `src/middleware.ts` (function `middleware`) and the helper `src/lib/supabase/middleware.ts`. Next 16 deprecated the name — every build warned — and renamed it Proxy. The rename also changed the runtime: middleware ran on Edge by default, Proxy runs only on Node.js. The code didn't change.

The runtime change is why the functions moved to `fra1` in the same version (`vercel.json` `regions`): on Node the proxy runs where the functions run, and they were in Vercel's default `iad1` while Supabase is in `eu-central-1` — the session check would have crossed the Atlantic on every request (the Edge middleware ran at the visitor's nearest edge). In `fra1` it is a same-region call, as is every database call of the routes. The proxy is now instrumented like the routes ([[../05-flows/observability-flow]]).

## Not in the proxy

For clarity, the proxy does NOT:

- Handle rewrites or redirects beyond the auth gate.
- Inspect request bodies (it can't read them efficiently).
- Talk to external services other than Supabase Auth.
- Modify Server Component responses (only redirects or pass-through).
- Touch the DB tables beyond `auth.getUser()`.

If you need any of those, build a route handler instead.

## Debugging

When something behaves like a session bug:

1. **Check the Network tab.** Look at cookies on the response — does the proxy path return refreshed `sb-...` cookies?
2. **`console.log` inside `updateSession`.** Cheap, fast, doesn't show up in production unless you commit it.
3. **`supabase.auth.getUser()` return value.** `null` means no session is being recovered from cookies — verify the matcher is including the path.
4. **Open `/auth/callback?code=...` directly.** Should exchange the code and redirect to `/map`. If it doesn't, the OAuth side is broken, not the proxy.
