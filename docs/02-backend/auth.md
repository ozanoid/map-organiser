---
title: Auth
type: overview
domain: auth
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/middleware.ts
  - src/lib/supabase/middleware.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/client.ts
  - src/app/auth/callback/route.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/signup/page.tsx
  - src/app/(auth)/layout.tsx
related:
  - "[[supabase-clients]]"
  - "[[../01-domain/users-and-profiles]]"
  - "[[../05-flows/auth-flow]]"
  - "[[rls-policies]]"
---

# Auth

Cookie-based session via `@supabase/ssr`. Provider options: Google OAuth (primary) and email/password (fallback). The session is the central trust token — every backend authorization decision derives from `auth.uid()`, which Supabase resolves from the session cookie.

## At a glance

| Concern | Mechanism |
|---|---|
| Session storage | HTTP-only cookies (Supabase Auth standard) |
| Session refresh | `src/middleware.ts` on every request |
| OAuth provider | Google (via Supabase Auth) |
| OAuth callback | `src/app/auth/callback/route.ts` |
| Email/password | `src/app/(auth)/login/page.tsx`, `signup/page.tsx` |
| Public routes | `/`, `/auth/callback/*`, `/shared/*`, `/api/shared/*` |
| Default landing | `/map` (after login) |
| Logout | `supabase.auth.signOut()` from header dropdown |
| Server-side check | `await supabase.auth.getUser()` at top of route handler |
| RLS link | Every user-owned table uses `auth.uid() = user_id` |

## Login flow (Google OAuth)

```
1.  User clicks "Sign in with Google" on (auth)/login/page.tsx
        │
        ▼
2.  supabase.auth.signInWithOAuth({ provider: "google",
                                     options: { redirectTo: "/auth/callback" } })
        │  redirect to Google
        ▼
3.  Google → user consent → redirect to /auth/callback?code=...
        │
        ▼
4.  src/app/auth/callback/route.ts
        const { code } = ... // from query
        await supabase.auth.exchangeCodeForSession(code)
        //   ↑ exchange code for session cookies, set on response
        │
        ▼
5.  Redirect to /map
        │
        ▼
6.  Middleware on /map request:
        - supabase.auth.getUser() → returns user
        - cookies refreshed
        - response served
        │
        ▼
7.  First-time users: on auth.users INSERT, two triggers fire
        a. handle_new_user() → INSERT public.profiles row
        b. (on the new profile) create_default_categories() → 12 categories
        └─ see [[../01-domain/users-and-profiles#signup-first-use-flow]]
```

## Email/password flow

Same as OAuth from step 4 onward, but step 1-3 are replaced by:

- `supabase.auth.signUp({ email, password })` (`signup/page.tsx`).
- `supabase.auth.signInWithPassword({ email, password })` (`login/page.tsx`).
- Email confirmation may be enabled in Supabase Auth settings (verify via dashboard).

## Middleware gate

`src/middleware.ts` runs on every request except static assets:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

It delegates to `updateSession()` in `src/lib/supabase/middleware.ts`, which:

1. Reads cookies from `request.cookies`.
2. Constructs a server Supabase client.
3. Calls `supabase.auth.getUser()` — this triggers cookie refresh if the access token is near expiry.
4. Writes refreshed cookies onto the response.
5. Decides the redirect:

```ts
const isAuthRoute =
  request.nextUrl.pathname.startsWith("/login") ||
  request.nextUrl.pathname.startsWith("/signup");

const isPublicRoute =
  request.nextUrl.pathname === "/" ||
  request.nextUrl.pathname.startsWith("/auth/callback") ||
  request.nextUrl.pathname.startsWith("/shared/") ||
  request.nextUrl.pathname.startsWith("/api/shared/");

if (!user && !isAuthRoute && !isPublicRoute) {
  return NextResponse.redirect(/login);
}

if (user && isAuthRoute) {
  return NextResponse.redirect(/map);
}
```

### Public route table

| Path | Why public |
|---|---|
| `/` | Landing page (currently redirects). |
| `/auth/callback/*` | OAuth handshake — must run before session exists. |
| `/login`, `/signup` | Inverse — authenticated users get redirected AWAY from these to `/map`. |
| `/shared/*` | Slug-based public share view. See [[../01-domain/sharing]]. |
| `/api/shared/*` | The matching API endpoints for the share view. |

Anything else requires an authenticated user.

## Server-side auth check pattern

Inside every protected API route:

```ts
const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();
if (!user) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
// ... do work
```

Notes:

- **Why `getUser()` and not `getSession()`:** `getSession()` reads from cookies without server-side verification; `getUser()` validates with Supabase. Use `getUser()` whenever authorization matters.
- **No need to add `.eq("user_id", user.id)` on queries** — RLS does it. Adding it is harmless but redundant.

## RLS and auth.uid()

Every user-owned table has a policy of shape `(auth.uid() = user_id)`. Resolution path:

- Supabase Auth issues a JWT that includes the user's UUID as `sub`.
- The JWT is sent with every Supabase request (via cookie auto-include in the SSR client).
- Postgres exposes `auth.uid()` as a `SELECT auth.jwt() ->> 'sub'::uuid` helper.
- RLS predicates use it directly.

See [[rls-policies]] for the full policy table.

## OAuth callback in detail

`src/app/auth/callback/route.ts` (verify exact code at next read):

- Reads `code` from query string.
- Calls `supabase.auth.exchangeCodeForSession(code)` using the server client.
- The SSR client sets session cookies on the response.
- Redirects to `/map` (or the `next` query param if provided).

If the code is missing or invalid, the route falls back to redirecting to `/login`.

## Logout

`AppHeader` dropdown calls `supabase.auth.signOut()`. This clears cookies; middleware on the next request will redirect to `/login`.

## Edge cases

- **Concurrent tab login.** Logging in one tab updates the cookie; other tabs pick it up on their next request via middleware.
- **Token expiry mid-session.** Middleware refreshes silently. The user only notices a redirect to `/login` if the refresh fails (e.g. revoked session).
- **`/shared/<slug>` viewed by a logged-in user.** Middleware allows the public path AND a session exists. The page reads the session client-side to show the "Save to my account" CTA. The data fetch (`GET /api/shared/[slug]`) still uses the service-role client — it doesn't change behavior based on the viewer.

## Known weak spots (from advisor)

- **Leaked-password protection is disabled.** Supabase Auth can check passwords against HaveIBeenPwned but the setting is off. Worth enabling for any account that supports email/password. Toggle in Supabase dashboard → Authentication → Policies. See [[../_agent/pitfalls#supabase]].
- **No MFA wired.** Supabase supports TOTP MFA but this repo doesn't expose it. Low priority for a personal app; non-negotiable for any multi-user expansion.
- **Service-role client absent from `.env.local.example`.** Means a fresh clone won't have public sharing working until the dev figures this out. See [[supabase-clients#serverts-createserviceclient---bypass-rls]] and [[../06-ops/env-vars]] when written.

## Future work

- Account-deletion path (cleanup must respect RLS on cascade).
- Session activity dashboard (Supabase has `auth.sessions`; not wired into UI).
- Linked-provider support (OAuth from multiple providers tied to one account).
