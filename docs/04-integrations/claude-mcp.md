---
title: "Claude connector (MCP server)"
type: integration
domain: integrations
version: 1.3.0
last_updated: 18.11.2026
status: draft
sources:
  - src/app/api/mcp/route.ts
  - src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts
  - src/app/(auth)/oauth/consent/page.tsx
  - src/app/(auth)/oauth/consent/actions.ts
  - src/app/(auth)/oauth/consent/consent-form.tsx
  - src/lib/assistant/mcp.ts
  - src/lib/assistant/verify-token.ts
  - src/lib/assistant/oauth.ts
  - src/lib/assistant/owner.ts
  - src/lib/assistant/library.ts
  - src/lib/assistant/place-filters.ts
  - src/lib/assistant/tools/
  - src/lib/mapbox/geocode.ts
  - src/lib/place-search/
  - src/lib/text/fold.ts
  - scripts/assistant-check/run.ts
  - scripts/assistant-check/plans.ts
  - scripts/assistant-check/visits.ts
  - src/lib/assistant/tools/log-visit.ts
  - src/lib/assistant/tools/get-visits.ts
related:
  - "[[../_plans/personal-assistant]]"
  - "[[../05-flows/claude-connector-flow]]"
  - "[[../02-backend/auth]]"
  - "[[supabase]]"
  - "[[gemini]]"
  - "[[mapbox]]"
---

# Claude connector (MCP server)

> Phase 0 of [[../_plans/personal-assistant]]: the user's library as an MCP server, so claude.ai (web, desktop, mobile) and Claude Code can search, read and update saved places. One tool layer, many doors — the in-app assistant moves onto the same tools in Phase 2.

**Status (17.11.2026):** on main and connected. Ozan added the connector in claude.ai; Claude registered itself through dynamic client registration and Ozan approved on `/oauth/consent`. The connector's tools were then called through the real OAuth token from a Claude Code session on the same account: `get_library_overview` returned the owner's 291 places (so the owner gate and RLS work), plus `search_places` with `open_at`, `get_places` with `at`, `read_reviews` and `rank_places`. `update_places` has not been run through the connector yet.

## Shape

| Piece | Where | What it does |
|---|---|---|
| MCP endpoint | `POST/GET/DELETE /api/mcp` | Streamable HTTP, stateless (`mcp-handler` 2 + `@modelcontextprotocol/server` 2). Wrapped in `withMcpAuth(required)`. |
| Resource metadata | `/.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728 document: `resource` = the MCP URL, `authorization_servers` = Supabase Auth. The 401 challenge names the path-inserted URL. |
| Authorization server | Supabase Auth OAuth 2.1 server | Discovery, client registration, authorize, token. Issuer `https://<ref>.supabase.co/auth/v1`. |
| Consent page | `/oauth/consent` (Supabase "Authorization Path") | The user approves or denies. See [[../05-flows/claude-connector-flow]]. |
| Tools | `src/lib/assistant/tools/` | Transport-free definitions: name, description, zod input, annotations, `run(ctx, input)`. |

Both new paths are skipped by the session middleware (matcher in `src/middleware.ts`): `/api/mcp` must answer 401, not redirect, and `.well-known` documents are public. `/oauth/` is a public route that does its own sign-in redirect.

## Who may connect

- **Owner gate:** `ASSISTANT_OWNER_EMAILS` (comma-separated). Unset = nobody. Checked on the consent page and on every MCP request (the token's `email` claim); a valid token for anyone else gets 403.
- **Redirect allowlist** (`isAllowedOAuthRedirect`): dynamic client registration lets any app register any redirect URI, so the consent page approves only `https://claude.ai|claude.com/api/mcp/auth_callback` and loopback `http://localhost|127.0.0.1` (Claude Code, RFC 8252). An unknown app sees "Unknown app" with a Cancel button only; its callback is never followed.
- **Token check** (`verifyAssistantToken`): `supabase.auth.getClaims(token)` — local signature check against the JWKS (the project signs with ES256, verified 17.11.2026); then `role = authenticated` and `iss` = the Supabase issuer. Tools run with a Supabase client carrying that token, so RLS applies; every query also filters `user_id`.

## Tools

| Tool | Kind | What it returns |
|---|---|---|
| `get_library_overview` | read | Countries (spellings merged, e.g. Türkiye + Turkey) with cities, categories with sub-categories, tags and lists — each with counts; visit-status counts (unknown included), logged visits (total, places, last 30 days, last date), closed counts, sources, recently saved, notes on data gaps. |
| `search_places` | read | Filters: keyword, city/country, near (saved place, lat/lng or a neighbourhood geocoded by Mapbox) + radius, category, sub-category, tags (all must apply), list, visit status (incl. `unknown`), Google rating and review floor, max price, open at a place-local time or now, source, saved since. Closed places out unless `include_closed`. Sort: rating, popularity, distance, recent. ≤ 25 compact rows + total. |
| `rank_places` | read, AI call | Same filters, then the AI-search judge (Gemini, `rank-engine`) scores up to 30 profiles against an English `intent`. SKU `ai_rank_results`, budget `rank_backstop`; degrades to rating order with a notice. |
| `get_places` | read | 1–5 places in full: profile (summary, pros, cons, top themes with a quote, `good_for` features), weekly hours, `at` → open?, closes at, busyness at that hour and the day's busiest hours, links (long Google links cut to their path), user status/rating/notes/tags/lists, the last 3 visits (date, rating, notes) and upcoming plans that include the place (v1.38.0; replaced the `visited` date), the Instagram post in the notes, up to 3 "people also search" places not in the library — only listings with ≥ 4.0 and ≥ 20 reviews (a 1-review, 1★ listing showed up in the first live check). |
| `read_reviews` | read | Stored Google reviews (~50 per place) filtered by words (`about`, any match, folded), min rating; sorted by relevance or date; ≤ 20 quotes cut to 450 chars around the hit. Without `about`, also the review themes. |
| `search_google_maps` | read, paid | Google Maps search (DataForSEO SERP, live) around a point: by name or by kind. ≤ 20 results with address, category, Google rating and review count, distance, website, `maps_url`, `google_cid`, and `saved_place_id` when the place is already in the library (matched on cid / place id). No price level — the live response leaves it empty. 18.11.2026. |
| `get_visits` | read | The user's logged visits, newest first: date, place (name, area, Maps link), this visit's rating and notes, the plan it fulfilled. Filters: places, date range, area (city / district / country, folded), minimum rating; ≤ 100. Says so when nothing is logged. |
| `log_visit` | write | "I went": place, date (default today at the place), rating, notes in the user's words → `log_visit` ([[../01-domain/visits]]): one visit per place per day (the same day again updates it, keeping what is left out), marks the place visited, keeps its rating current, ticks off a planned stop that day. `visit_id` corrects a visit (null clears rating / notes). `created_via = assistant`. |
| `update_places` | write | 1–25 places: visit status without a visit (stamps `visited_at` / `booked_at` like `PATCH /api/places/[id]`), an overall rating 1–5 or null, a note about the place appended to its notes (no date prefix since v1.38.0 — visit notes go to `log_visit`), tags to add (created if missing) or remove. Its description sends "I went…" to `log_visit`. |

Filters take **names**, not ids (`resolveNames`): exact folded match, then a unique partial match ("Rooftops" → "Rooftop"); otherwise a `ToolInputError` listing the closest names, which goes back to the model as an error result. The data modules' own refusals (`InputError` / `NotFoundError` from `src/lib/db/errors.ts` — "a visit can't be in the future", "visit not found") go back to the model the same way.

### Matching and payload

- Text matching is on folded text (`src/lib/text/fold.ts`: Turkish lower-casing, no diacritics, no punctuation). Postgres ILIKE in this database folds ASCII case only — a city search for "Istanbul" matched 0 places and "İstanbul" 39 (measured 17.11.2026). With folding both find the same places and "Kadikoy" finds "Kadıköy".
- Rows are a light projection (`loadLibrary`): `google_data` averages ~69 KB per place (55 KB of it reviews; ~20 MB for 291 places), so tools select only the JSON paths they need. Search reads ~3 KB per place.
- Measured on the owner's 291 places: searches 0.4–0.7 s, details 0.2–0.4 s, reviews ~0.1 s.

## Costs

- claude.ai / Claude Code usage runs on the user's Claude plan; the tools spend nothing on the Claude API.
- `rank_places`: one Gemini call per use (existing AI-search SKU and budget).
- `search_google_maps`: one DataForSEO Maps search per call — $0.002 (`dataforseo_maps_search`), from the system DataForSEO balance; measured latency 2.6–12.4 s.
- `near.area`: one Mapbox Geocoding request (`mapbox_geocoding`, 100k free per month, then $0.75 per 1,000).

## Limits and known issues

- `rank_places` took 41 s (50 profiles), 64 s and 28 s (30 profiles) from the check script and 36 s through the connector — Gemini latency varies, the pool size barely matters. `/api/mcp` has `maxDuration = 120`; Claude Code waited 36 s, claude.ai's own limit is untested.
- The shared `queryPlaces` (places page, in-app assistant) still has the ILIKE folding gap and selects all of `google_data`. Not changed here; see the plan's open items.
- `ASSISTANT_OWNER_EMAILS` must be set in each environment, or every connection is refused.

## Setup

1. Supabase → Authentication → OAuth Server: server enabled (on, 17.11.2026), **Allow dynamic client registration** (turned on 17.11.2026 — it only takes effect after Save), Authorization Path `/oauth/consent`. Site URL (Authentication → URL Configuration) must be the production URL — the consent page is reached through it.
2. Vercel env: `ASSISTANT_OWNER_EMAILS` in Production (and Preview if wanted).
3. After the merge: claude.ai → Settings → Connectors → Add custom connector → `https://<production>/api/mcp`. Claude Code: `claude mcp add --transport http map-organiser https://<production>/api/mcp`.

## Testing

`npm run check:assistant` (`scripts/assistant-check/run.ts`) runs every tool against the live database with the service-role key — read checks on the owner's library; the paid calls (geocoding, AI ranking) and one write on the admin test account, the write undone afterwards — plus the plan and visit modules' checks (`scripts/assistant-check/plans.ts`, `visits.ts` — the visit checks also run `log_visit`, `get_visits`, `get_places`, the overview and `update_places`; `npm run check:assistant -- plans` / `-- visits` run only those, with no paid call) and unit checks for `safeNextPath` and the redirect allowlist. The OAuth round trip and real-token RLS were covered by the production end-to-end check of 17.11.2026 (read tools only).

## Failure modes

| Symptom | Cause |
|---|---|
| claude.ai can't register | Dynamic client registration off (Supabase answers 403 `oauth_dynamic_client_registration_disabled`). |
| Consent page says "This account can't connect apps" | Signed-in email not in `ASSISTANT_OWNER_EMAILS`. |
| Consent page says "Unknown app" | The client's redirect URI isn't Claude's callback or loopback. |
| Every tool call 403 | Token belongs to a non-owner account. |
| `rank_places` slow / notice "allowance used up" | Gemini latency / `rank_backstop` budget. |
