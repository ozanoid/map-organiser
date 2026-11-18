---
title: "Claude connector (MCP server)"
type: integration
domain: integrations
version: 1.5.1
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
  - scripts/assistant-check/plan-tools.ts
  - scripts/assistant-check/context.ts
  - src/lib/assistant/tools/log-visit.ts
  - src/lib/assistant/tools/get-visits.ts
  - src/lib/assistant/tools/get-plans.ts
  - src/lib/assistant/tools/create-plan.ts
  - src/lib/assistant/tools/update-plan.ts
  - src/lib/assistant/tools/delete-visit.ts
  - src/lib/assistant/tools/get-lists.ts
  - src/lib/assistant/tools/save-list.ts
  - src/lib/plans/schema.ts
  - src/lib/lists/schema.ts
  - scripts/assistant-check/lists.ts
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

**Lists (v1.40.0, on main since 18.11.2026):** `get_lists`, `save_list`, and `get_places` showing each list's note for the place; run against the live database by `npm run check:assistant -- lists`. After the deploy a connector call with the real token (`get_places`) ran the new code in production; `get_lists` and `save_list` appear in new claude.ai conversations — a Claude Code session keeps the tool list it started with.

**Plans (v1.39.0, on main since 18.11.2026):** `get_plans`, `create_plan`, `update_plan`, `log_visit` with `plan_stop_id` and `delete_visit`, run against the live database by `npm run check:assistant -- plan-tools`. After the deploy a connector call with the real token (`get_library_overview`) confirmed the new tool context (`appUrl`) in production; the new tools themselves appear in new claude.ai conversations — a Claude Code session keeps the tool list it started with.

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
| `get_places` | read | 1–5 places in full: profile (summary, pros, cons, top themes with a quote, `good_for` features), weekly hours, `at` → open?, closes at, busyness at that hour and the day's busiest hours, links (long Google links cut to their path), user status/rating/notes/tags, the lists it is on with its note on each (`{ list_id, name, note }`, v1.40.0), the last 3 visits (date, rating, notes) and upcoming plans that include the place (v1.38.0; replaced the `visited` date; a plan day counts as ahead by the date at the place since v1.39.0), the Instagram post in the notes, up to 3 "people also search" places not in the library — only listings with ≥ 4.0 and ≥ 20 reviews (a 1-review, 1★ listing showed up in the first live check). |
| `read_reviews` | read | Stored Google reviews (~50 per place) filtered by words (`about`, any match, folded), min rating; sorted by relevance or date; ≤ 20 quotes cut to 450 chars around the hit. Without `about`, also the review themes. |
| `search_google_maps` | read, paid | Google Maps search (DataForSEO SERP, live) around a point: by name or by kind. ≤ 20 results with address, category, Google rating and review count, distance, website, `maps_url`, `google_cid`, and `saved_place_id` when the place is already in the library (matched on cid / place id). No price level — the live response leaves it empty. 18.11.2026. |
| `get_visits` | read | The user's logged visits, newest first: date, place (name, area, Maps link), this visit's rating and notes, the plan it fulfilled. Filters: places, date range, area (city / district / country, folded), minimum rating; ≤ 100. Says so when nothing is logged. |
| `get_plans` | read | The user's plans ([[../01-domain/plans]]). Without `plan_id`: a list — by default upcoming and not-yet-scheduled plans; `phase` (upcoming / unscheduled / past / cancelled / all), `name` (folded; without `phase` it searches every phase, so a past or cancelled trip is found), `from` / `to` (any day of the plan in range; plans that aren't cancelled); each with dates and start weekday, day and stop counts, done / skipped counts, the first 8 stops by name with time or part of the day, and the plan's link; plus counts per phase. A plan is upcoming until its last day is over **where it takes place**: the date in the time zone of its last stop at a located place (UTC without one; 289 of the owner's 291 places carry a zone, 18.11.2026). With `plan_id`: the plan in full — every day with `day_id`, date, weekday, notes; every stop with `stop_id`, `place_id` and place (name, category, area, Maps link) or text `title`, `start_time` or `day_part`, notes, `cost_estimate` per person and currency, status and its visit — the same names the write tools take. `with_routes`: each day's walking / driving / cycling time and distance and the legs between stops (Mapbox Directions, one request per day with ≥ 2 located stops). |
| `get_lists` | read | The user's lists ([[../01-domain/lists]]). Without arguments: every list with its description, place count, last change and link (`<appUrl>/lists/<id>`). With `list_id`, or a `name` that matches one list (folded): the list in full — its places in order with area, category, Google rating, the user's visit status, Maps link and the user's **note for that list**, and when each was added. v1.40.0. |
| `create_plan` | write | A plan in one step through `create_plan` ([[../01-domain/plans]]): name, start date (left out = not scheduled), party size, notes, days in order with stops in order — a saved place or a text title, an exact local time or a part of the day, notes, cost. The input is `planCreateSchema` without colour and source list. `created_via = assistant`. Returns the plan as saved with its link. |
| `update_plan` | write | `set` (name, notes, party size, start date — every day moves with it, null = unscheduled — status cancelled / planned) and `ops` (`planOpSchema`: add / remove / swap / set day, add / update / move / remove / reorder stops) through `apply_plan_changes`, all or nothing. A day is named by number (read when its op runs) or by `day_id`. A stop at a saved place is done only by logging its visit (the database refuses it here), and a stop with a visit keeps its status until the visit is deleted (`delete_visit`). `title` changes only a text stop. No delete: Claude cancels. Returns the plan as saved with its link. |
| `save_list` | write, destructive | A list in one step through `save_list` ([[../02-backend/schema/list_places]]): without `list_id` a new one (`set.name` required, `created_via = assistant`); `set` (name, description) and ordered `ops` — `add_place` (optional note and position; a place already on it keeps its position, and its note unless a new one with words in it is given), `remove_place`, `set_note` (null clears), `move_place`, `reorder` — all or nothing; only the user's own places. The input is the list module's own strict schema (`listChangesSchema` without colour). No delete. Returns the list as saved with its link and what changed (`added`, `already_on_list`, `removed`, `not_on_list`). v1.40.0. |
| `log_visit` | write | "I went": place, date (default today at the place), rating, notes in the user's words → `log_visit` ([[../01-domain/visits]]): one visit per place per day (the same day again updates it, keeping what is left out), marks the place visited, keeps its rating current, ticks off a planned stop that day. `plan_stop_id` (v1.39.0) names the stop instead: it is ticked off whatever its day, and its day is the default date. `visit_id` corrects a visit (null clears rating / notes). `created_via = assistant`. |
| `delete_visit` | write, destructive | Removes a visit for good — only when the user asks (they didn't go, or it was logged by mistake; Ozan's decision, 18.11.2026) → `delete_visit` ([[../01-domain/visits]]): a stop it ticked off is planned again, the place's rating is worked out again from the visits left, the place keeps its visited status (Claude can change that with `update_places` once the user confirms). Returns the deleted visit, the reopened stop and the place's status and rating now. |
| `update_places` | write | 1–25 places: visit status without a visit (stamps `visited_at` / `booked_at` like `PATCH /api/places/[id]`), an overall rating 1–5 or null, a note about the place appended to its notes (no date prefix since v1.38.0 — visit notes go to `log_visit`), tags to add (created if missing) or remove. Its description sends "I went…" to `log_visit`. |

Filters take **names**, not ids (`resolveNames`): exact folded match, then a unique partial match ("Rooftops" → "Rooftop"); otherwise a `ToolInputError` listing the closest names, which goes back to the model as an error result. The data modules' own refusals (`InputError` / `NotFoundError` from `src/lib/db/errors.ts` — "a visit can't be in the future", "visit not found") go back to the model the same way.

### Plans: links and saving

- **Links.** Plan results carry `url` = `<appUrl>/plans/<id>`. `appUrl` is part of the tool context (`AssistantContext`); the MCP server sets it from the address the client reached it at (`getPublicOrigin` from `mcp-handler`, the same rule as the OAuth resource metadata — parsed once in `verifyAssistantToken`, http(s) only, else the request's own origin), so a link opens the deployment the connector talks to — production, a preview or localhost. Signed out, the link goes through `/login?next=…` and back to the plan (session middleware, v1.39.0).
- **Strict inputs.** Every tool refuses keys it doesn't know (`defineTool` makes the top-level object strict; the JSON Schema says `additionalProperties: false`), and the plan schemas are strict all the way down. A misnamed field — `date` for `visited_on`, `time` for `start_time` — is an error the model sees, not a value silently dropped. A stop is a place or a text, not both.
- **Saving.** The server instructions ask Claude to lay a new plan out and save it once the user agrees; `update_plan` does what the user asked, and changes Claude suggests itself need the user's OK first. After a save Claude gives the link. Plans are cancelled, never deleted, through the assistant.
- **After a write** the tools read the plan back; if that read fails the result still says the plan was saved (with its link), so a retry doesn't save it twice. An unexpected error in a write tool tells Claude the change may have been saved and to check (`get_plans`, `get_visits`, `get_places`) before trying again; read tools still say "try again".
- **Costs** are per person; a saved place's stop without a cost gets the US-dollar default for its price level — only when its currency is USD or not given (a stop in pounds gets none, rather than "25 GBP" from the dollar table).
- **One schema.** The tools' inputs are the plan module's own zod schemas (`src/lib/plans/schema.ts`), whose `.describe()` texts are what the model reads — the API routes validate with the same definitions.

### Matching and payload

- Text matching is on folded text (`src/lib/text/fold.ts`: Turkish lower-casing, no diacritics, no punctuation). Postgres ILIKE in this database folds ASCII case only — a city search for "Istanbul" matched 0 places and "İstanbul" 39 (measured 17.11.2026). With folding both find the same places and "Kadikoy" finds "Kadıköy".
- Rows are a light projection (`loadLibrary`): `google_data` averages ~69 KB per place (55 KB of it reviews; ~20 MB for 291 places), so tools select only the JSON paths they need. Search reads ~3 KB per place.
- Measured on the owner's 291 places: searches 0.4–0.7 s, details 0.2–0.4 s, reviews ~0.1 s.

## Costs

- claude.ai / Claude Code usage runs on the user's Claude plan; the tools spend nothing on the Claude API.
- `rank_places`: one Gemini call per use (existing AI-search SKU and budget).
- `search_google_maps`: one DataForSEO Maps search per call — $0.002 (`dataforseo_maps_search`), from the system DataForSEO balance; measured latency 2.6–12.4 s.
- `near.area`: one Mapbox Geocoding request (`mapbox_geocoding`, 100k free per month, then $0.75 per 1,000).
- `get_plans` with `with_routes`: one Mapbox Directions request per day with two or more located stops (`mapbox_directions`, 100k free per month, then $2 per 1,000).

## Limits and known issues

- `rank_places` took 41 s (50 profiles), 64 s and 28 s (30 profiles) from the check script and 36 s through the connector — Gemini latency varies, the pool size barely matters. `/api/mcp` has `maxDuration = 120`; Claude Code waited 36 s, claude.ai's own limit is untested.
- The shared `queryPlaces` (places page, in-app assistant) still has the ILIKE folding gap and selects all of `google_data`. Not changed here; see the plan's open items.
- `ASSISTANT_OWNER_EMAILS` must be set in each environment, or every connection is refused.
- Tool definitions are sent to the model with every conversation: about 38,700 characters for the 15 tools (measured 18.11.2026; `save_list` 4,600, `get_lists` 1,000), `update_plan` the largest at 9,000 plus a 1,100-character description (one schema branch per op). 5,600 characters across all tools are the uuid and date patterns zod writes next to `format`.

## Setup

1. Supabase → Authentication → OAuth Server: server enabled (on, 17.11.2026), **Allow dynamic client registration** (turned on 17.11.2026 — it only takes effect after Save), Authorization Path `/oauth/consent`. Site URL (Authentication → URL Configuration) must be the production URL — the consent page is reached through it.
2. Vercel env: `ASSISTANT_OWNER_EMAILS` in Production (and Preview if wanted).
3. After the merge: claude.ai → Settings → Connectors → Add custom connector → `https://<production>/api/mcp`. Claude Code: `claude mcp add --transport http map-organiser https://<production>/api/mcp`.

## Testing

`npm run check:assistant` (`scripts/assistant-check/run.ts`) runs every tool against the live database with the service-role key — read checks on the owner's library; the paid calls (geocoding, AI ranking) and one write on the admin test account, the write undone afterwards — plus the plan and visit modules' checks (`scripts/assistant-check/plans.ts`, `visits.ts` — the visit checks also run `log_visit`, `get_visits`, `get_places`, the overview and `update_places`) and the plan tools' checks (`plan-tools.ts`: every tool's input converts to the JSON Schema clients see and refuses unknown keys; misnamed fields refused; a plan's phase follows its time zone; create, list, filters (a past and a cancelled plan found by name), detail with a route, a batch with a swap and a day number read after it, the dollar default and none for a stop in pounds, the all-or-nothing refusal of "done" at a saved place, a stop with a visit keeping its status, `log_visit` with `plan_stop_id`, `delete_visit` reopening that stop, cancel / restore / unschedule; everything removed afterwards). The list checks (`lists.ts`, `-- lists`, v1.40.0): strict schemas, `save_list` creating a list with notes, `get_lists` by id and by name, one call with a note replaced, a front insert, a move, a cleared note and an absent place reported; a foreign place refusing the whole call; blank notes; the optimistic change the list page shows matching the server's; `get_places` with list notes; the place page's `setPlaceLists` touching only changed lists; bulk add; delete — on places that are on none of the account's own lists, and those lists compared item by item before and after. The unit checks for `safeNextPath` (including dot-segment paths) and the redirect allowlist run with every suite. `npm run check:assistant -- plans` / `-- visits` / `-- plan-tools` run one suite, with no paid call and unit checks for `safeNextPath` and the redirect allowlist. The OAuth round trip and real-token RLS were covered by the production end-to-end check of 17.11.2026 (read tools only).

## Failure modes

| Symptom | Cause |
|---|---|
| claude.ai can't register | Dynamic client registration off (Supabase answers 403 `oauth_dynamic_client_registration_disabled`). |
| Consent page says "This account can't connect apps" | Signed-in email not in `ASSISTANT_OWNER_EMAILS`. |
| Consent page says "Unknown app" | The client's redirect URI isn't Claude's callback or loopback. |
| Every tool call 403 | Token belongs to a non-owner account. |
| `rank_places` slow / notice "allowance used up" | Gemini latency / `rank_backstop` budget. |
| Tool error "Unrecognized key: …" | The model sent a field the tool doesn't have; the message names it, the model retries with the right one. |
