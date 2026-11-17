---
title: "Claude Connector Flow"
type: flow
domain: auth
version: 1.0.1
last_updated: 17.11.2026
status: draft
sources:
  - src/app/api/mcp/route.ts
  - src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts
  - src/app/(auth)/oauth/consent/page.tsx
  - src/app/(auth)/oauth/consent/actions.ts
  - src/app/(auth)/login/page.tsx
  - src/app/auth/callback/route.ts
  - src/lib/auth/safe-next.ts
  - src/lib/assistant/verify-token.ts
  - src/lib/assistant/oauth.ts
related:
  - "[[../04-integrations/claude-mcp]]"
  - "[[auth-flow]]"
  - "[[../02-backend/auth]]"
---

# Claude Connector Flow

How claude.ai (or Claude Code) gets a token for the user's library and uses it. Supabase Auth is the OAuth 2.1 authorization server; the app is the protected resource and hosts the consent page. Merged to main on 17.11.2026; not yet run end to end — dynamic client registration was still off at merge time (see [[../04-integrations/claude-mcp#Setup]]).

## Trigger

The user adds `https://<production>/api/mcp` as a custom connector in Claude, or Claude's token expired.

## Steps

```
1. Claude → POST /api/mcp (no token)
   ← 401  WWW-Authenticate: Bearer … resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"
2. Claude → GET that metadata
   ← { resource: "<origin>/api/mcp", authorization_servers: ["https://<ref>.supabase.co/auth/v1"] }
3. Claude → GET https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1
   (authorize, token, registration endpoints)
4. Claude → POST registration endpoint (dynamic client registration)
   redirect_uri https://claude.ai/api/mcp/auth_callback
5. Browser → Supabase /oauth/authorize (PKCE)
   → redirect to Site URL + /oauth/consent?authorization_id=…
6. /oauth/consent (server component)
   • signed out → /login?next=/oauth/consent?authorization_id=…
       – email/password: login page pushes `next` after sign-in
       – Google: login page sets the auth_next cookie (10 min); /auth/callback
         reads it after exchanging the code, clears it, redirects to it
   • email not in ASSISTANT_OWNER_EMAILS → "This account can't connect apps"
   • getAuthorizationDetails(id):
       – error → "This request has expired"
       – already approved → redirect to its redirect_url (allowlisted only)
       – redirect_uri not allowlisted → "Unknown app" + Cancel (deny, go to /map)
       – otherwise → consent card: app name, account, what it can read/write
7. Allow → server action re-checks owner + details + allowlist
   → approveAuthorization(id, skipBrowserRedirect) → redirect to Claude's callback with ?code
   Deny → denyAuthorization → Claude's callback with access_denied
8. Claude → Supabase /oauth/token (code + PKCE verifier) → access + refresh token
9. Claude → POST /api/mcp  Authorization: Bearer <token>
   withMcpAuth → verifyAssistantToken: getClaims (JWKS, ES256), role, iss, owner email
   → tools run with a Supabase client carrying the token (RLS)
```

## Inputs / outputs

| Step | Input | Output |
|---|---|---|
| 1–2 | MCP URL | Resource metadata naming Supabase |
| 4 | Client metadata | A Supabase OAuth client (one per registration) |
| 6–7 | `authorization_id`, the user's session | Authorization code at Claude's callback |
| 8 | Code + PKCE verifier | Supabase access token (`role: authenticated`, `client_id`) |
| 9 | Bearer token | Tool results; writes under RLS |

## Security notes

- `next` is followed only through `safeNextPath`: one leading slash, no backslash or control characters, same origin after parsing. Before 17.11.2026 `/auth/callback` appended any `next` to the origin, so `next=@evil.com` became `https://<origin>@evil.com`.
- The consent decision re-runs every check server-side; the form posts only the id.
- Claude's callback and loopback are the only redirect targets ever followed — see [[../04-integrations/claude-mcp#Who may connect]].

## Failure modes

See [[../04-integrations/claude-mcp#Failure modes]].

## Open questions

- Does Supabase accept the RFC 8707 `resource` parameter Claude sends on authorize and token? Unverified until the end-to-end test.
- Claude's tool-call timeout versus `rank_places`' 41–64 s.
