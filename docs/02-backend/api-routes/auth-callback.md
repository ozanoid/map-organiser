---
title: Auth Callback route
type: route-group
domain: auth
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/auth/callback/route.ts
related:
  - "[[_README]]"
  - "[[../auth]]"
  - "[[../../01-domain/users-and-profiles]]"
---

# Auth Callback route

The OAuth landing endpoint. Supabase Auth redirects here after the user authenticates with the chosen provider (Google primarily). It runs at `/auth/callback`, NOT under `/api/`.

## At a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/auth/callback` | **PUBLIC** | Exchange the OAuth `code` for a session, set cookies, redirect. |

## Per-route detail

### `GET /auth/callback`

- **Source:** `src/app/auth/callback/route.ts`
- **Auth:** **None.** This is the moment a user transitions from unauthenticated to authenticated.
- **Query params:**
  - `code` (required) — the OAuth authorization code returned by the provider.
  - `next` (optional) — destination path after success; defaults to `/map`.
- **DB:** none directly (Supabase Auth handles session storage). However, the triggers `handle_new_user` and `create_default_categories` fire as a side effect of Supabase Auth's INSERT into `auth.users` when this is the user's first sign-in.
- **External:** `supabase.auth.exchangeCodeForSession(code)` — calls Supabase Auth.
- **Behavior:**
  1. Read `code` from query string.
  2. If absent or empty → redirect to `/login?error=auth_failed`.
  3. Exchange the code via the server Supabase client; cookies are set on the response by the SSR client's `setAll` callback.
  4. Redirect to `next` (default `/map`).
  5. On failure → redirect to `/login?error=auth_failed`.

- **Response:** HTTP redirect.

## First-time vs returning users

The route doesn't distinguish — it just exchanges the code. The Postgres-side cascade decides:

```
exchangeCodeForSession(code)
   │
   ▼  (Supabase Auth checks for existing user by provider identity)
   │
   ├─ Existing user → updates session, redirect to /map
   │
   └─ New user → INSERT auth.users
          │
          ▼  on_auth_user_created trigger
          │
          handle_new_user() → INSERT public.profiles
                │
                ▼  on_profile_created_default_categories trigger
                │
                create_default_categories() → 12 categories seeded
                │
                ▼
          Session set, redirect to /map
```

See [[../../01-domain/users-and-profiles#signup-first-use-flow]] for the cascade detail.

## Public-route status

`/auth/callback/*` is exempt from the auth gate in `src/lib/supabase/middleware.ts`:

```ts
const isPublicRoute =
  request.nextUrl.pathname === "/" ||
  request.nextUrl.pathname.startsWith("/auth/callback") ||
  request.nextUrl.pathname.startsWith("/shared/") ||
  request.nextUrl.pathname.startsWith("/api/shared/");
```

Without this exemption, the middleware would redirect unauthenticated requests away from `/auth/callback` before the code exchange could happen — bricking the login flow.

## Error handling

The route assumes success or redirects to `/login?error=auth_failed`. Common failure modes:

- **Expired code.** OAuth codes are single-use and time-limited. Stale codes 4xx.
- **Mismatched redirect URI.** Configured in Supabase Auth → Providers → Google. Must match the deployment's origin.
- **Provider revoked the user.** Supabase Auth surfaces this and the exchange fails.

In all cases the user lands on `/login?error=auth_failed`. The `(auth)/login/page.tsx` should surface a friendly error message based on the query param (verify in code).

## Open questions

- **`next` param trust.** If the route blindly redirects to whatever `next` is, an open-redirect vulnerability could exist. Confirm the route restricts to same-origin paths.
- **Error param UX.** The `auth_failed` query param should produce a visible message on `/login`. Worth a quick test to confirm.
- **Multiple providers.** Today only Google is wired. If/when more providers are added, this route doesn't change — the SSR client handles them generically.
