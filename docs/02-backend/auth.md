---
title: Auth
type: overview
domain: auth
version: 1.2.0
last_updated: 17.11.2026
status: stable
sources:
  - src/middleware.ts
  - src/lib/supabase/middleware.ts
  - src/lib/supabase/server.ts
  - src/lib/supabase/client.ts
  - src/app/auth/callback/route.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/layout.tsx
  - src/app/(auth)/oauth/consent/page.tsx
  - src/app/(auth)/oauth/consent/actions.ts
  - src/lib/auth/safe-next.ts
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
| Email/password | `src/app/(auth)/login/page.tsx` — sign-in only; sign-ups are closed (see [[#Sign-ups closed]]) |
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

- `supabase.auth.signInWithPassword({ email, password })` (`login/page.tsx`).

The app has no sign-up call any more — see the next section.

## Sign-ups closed

Since 17.11.2026 the app has a single owner (see [[../_plans/personal-assistant]]), so public sign-up is closed:

- The `/signup` page is gone. The middleware sends any `/signup` URL to `/login` before it builds a Supabase client.
- The login page and the public share page no longer link to sign-up.
- The gate that actually stops new accounts is Supabase Auth's **Allow new users to sign up** setting (dashboard → Authentication → Sign In / Providers), which must stay off. Taking the page down alone would leave `supabase.auth.signUp()` callable by anyone holding the public anon key.
- New accounts are added by the owner in the Supabase dashboard (Authentication → Users). The [[../05-flows/signup-flow|account-creation cascade]] still runs for them.

## Return path after sign-in (`next`)

Since 17.11.2026 a page can send a signed-out visitor to `/login?next=<path>` and get them back after sign-in — the OAuth consent page does. `next` is followed only through `safeNextPath` (`src/lib/auth/safe-next.ts`): one leading slash, no backslash or control characters, same origin after URL parsing.

- Email/password: the login page pushes `next` (or `/map`).
- Google: the login page stores `next` in the short-lived `auth_next` cookie (10 min, SameSite=Lax) so the registered `/auth/callback` redirect URL stays unchanged; the callback reads `?next=` or the cookie, validates it, redirects and clears the cookie.
- Before this, `/auth/callback` appended any `next` to the origin — `next=@evil.com` produced `https://<origin>@evil.com`, an open redirect. Closed by the same validation.

## OAuth 2.1 server (Claude connector)

Supabase Auth also acts as an OAuth 2.1 authorization server for the MCP endpoint `/api/mcp`, so Claude can get a token for the user's library. The app hosts only the consent page, `/oauth/consent` (Supabase's Authorization Path, joined to the Site URL). Only `ASSISTANT_OWNER_EMAILS` accounts can approve, and only for Claude's callback or loopback redirect URIs. Full flow: [[../05-flows/claude-connector-flow]]; the server and its tools: [[../04-integrations/claude-mcp]].

Dashboard state checked on 17.11.2026: sign-ups off (`/auth/v1/settings` → `disable_signup: true`), OAuth server on, signing key ES256 (JWKS), dynamic client registration off.

## Middleware gate

`src/middleware.ts` runs on every request except static assets:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|api/mcp$|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

It delegates to `updateSession()` in `src/lib/supabase/middleware.ts`, which:

1. `/signup` → redirect to `/login` and stop (sign-ups closed, 17.11.2026).
2. Reads cookies from `request.cookies`.
3. Constructs a server Supabase client.
4. Calls `supabase.auth.getUser()` — this triggers cookie refresh if the access token is near expiry.
5. Writes refreshed cookies onto the response.
6. Decides the redirect:

```ts
if (pathname.startsWith("/signup")) {
  return NextResponse.redirect(/login);   // step 1, before the client exists
}

const isAuthRoute = pathname.startsWith("/login");

const isPublicRoute =
  pathname === "/" ||
  pathname.startsWith("/auth/callback") ||
  pathname.startsWith("/shared/") ||
  pathname.startsWith("/api/shared/") ||
  pathname.startsWith("/api/cron/");      // cron authenticates itself

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
| `/login` | Inverse — authenticated users get redirected AWAY from it to `/map`. |
| `/signup` | Closed (17.11.2026) — always redirects to `/login`. |
| `/shared/*` | Slug-based public share view. See [[../01-domain/sharing]]. |
| `/api/shared/*` | The matching API endpoints for the share view. |
| `/api/cron/*` | Cron runs with no cookie; each route authenticates itself with `CRON_SECRET`. |
| `/oauth/*` | The OAuth consent page; it sends signed-out visitors to `/login?next=…` itself. |
| `/api/mcp`, `/.well-known/*` | Not in the middleware at all (matcher): the MCP endpoint checks its own bearer tokens and must answer 401; the metadata documents are public. |

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
