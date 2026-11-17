---
title: Auth Flow
type: flow
domain: auth
version: 1.3.0
last_updated: 17.11.2026
status: stable
sources:
  - src/middleware.ts
  - src/lib/supabase/middleware.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/client.ts
  - src/app/auth/callback/route.ts
  - src/app/(auth)/login/page.tsx
related:
  - "[[signup-flow]]"
  - "[[../02-backend/auth]]"
  - "[[../03-frontend/middleware]]"
  - "[[../04-integrations/supabase]]"
---

# Auth Flow

How a user transitions from anonymous to authenticated. Covers Google OAuth (primary) and email/password.

## Trigger

User opens any protected path while unauthenticated, or clicks "Sign in" deliberately. There is no sign-up path: sign-ups are closed since 17.11.2026 ([[../02-backend/auth#Sign-ups closed]]).

## Steps (Google OAuth)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant LP as /login page
    participant SA as Supabase Auth
    participant G as Google
    participant CB as /auth/callback
    participant MW as middleware
    participant MAP as /map

    U->>LP: Open /login
    Note over LP: (auth)/layout.tsx renders centered form
    U->>LP: Click "Sign in with Google"
    LP->>SA: supabase.auth.signInWithOAuth({ provider:'google', redirectTo:'/auth/callback' })
    SA-->>U: Redirect to Google consent
    U->>G: Approve
    G-->>CB: Redirect with ?code=…
    CB->>SA: exchangeCodeForSession(code)
    SA-->>CB: Set sb-* session cookies on response
    CB-->>U: Redirect to /map (or ?next=…)
    U->>MW: Request /map
    MW->>SA: getUser() — verifies + refreshes if needed
    MW-->>MAP: Pass through
```

## Steps (email/password)

Same path from step 5 onward. Steps 1–4 replaced by:

- `supabase.auth.signInWithPassword({ email, password })` — existing accounts only.

## Inputs / outputs

| Step | Input | Output / persisted state |
|---|---|---|
| OAuth redirect | provider choice | Google session (temporary) |
| Callback | `code` query param | `sb-access-token`, `sb-refresh-token` cookies on the response |
| New account (added by the owner in the Supabase dashboard since 17.11.2026) | user metadata (`full_name`, `avatar_url`), if any | `auth.users` row → triggers `handle_new_user` → `profiles` row → triggers `create_default_categories` → 12 category rows |
| Middleware on next request | request cookies | refreshed cookies, redirect decision |

## Public route table (middleware exempt)

- `/`
- `/auth/callback/*`
- `/shared/*`
- `/api/shared/*`
- `/api/cron/*` (15.07.2026) — cron runs with no cookie; it authenticates itself via `CRON_SECRET`. **Without this exemption the middleware 307-redirects the cron to `/login` and it never runs.**

Plus `/login` is the "auth route" — accessible while unauthenticated, redirects to `/map` if authenticated. `/signup` redirects everyone to `/login` (sign-ups closed).

Everything else requires auth. See [[../02-backend/auth#middleware-gate]].

## Failure modes

| Step | Failure | Surfaces as |
|---|---|---|
| OAuth redirect | User cancels | Returns to `/login` (Google handles the back) |
| Code exchange | Invalid / expired code | Redirect to `/login?error=auth_failed` |
| Code exchange | Mismatched redirect URI | Same. Fix in Supabase Auth → Providers → Google. |
| Email confirmation | User hasn't clicked the link | `signInWithPassword` returns "Email not confirmed" |
| Session refresh | Refresh token revoked | Middleware redirects to `/login` |
| Cookie write | Wrong domain config | Cookies don't stick → user keeps getting bounced to `/login` |

## Logout

`AppHeader` → user menu → "Sign out" → `supabase.auth.signOut()`. Clears cookies; next request redirects to `/login`.

## Related code

- `src/middleware.ts` — Next.js middleware entry.
- `src/lib/supabase/middleware.ts` — `updateSession` (refresh + redirect).
- `src/app/auth/callback/route.ts` — OAuth code exchange.
- `src/app/(auth)/layout.tsx` — pre-auth layout.
- `src/app/(auth)/login/page.tsx` — login form (Google button + email/password).
- `src/components/layout/app-header.tsx` — sign-out button.
- `src/lib/supabase/client.ts`, `server.ts` — clients used after auth lands.

## Open questions

- ~~**`next` param.**~~ Resolved 17.11.2026: `/auth/callback` and the login page follow `next` only through `safeNextPath` (same-origin path); Google sign-in carries it in the `auth_next` cookie. See [[../02-backend/auth#Return path after sign-in (`next`)]].
