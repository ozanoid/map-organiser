---
title: API Routes
type: overview
domain: backend
version: 1.12.0
last_updated: 24.11.2026
status: stable
sources:
  - src/app/api/
  - src/app/auth/callback/route.ts
related:
  - "[[../_README]]"
  - "[[../supabase-clients]]"
  - "[[../auth]]"
  - "[[../rls-policies]]"
---

# API Routes

All Next.js route handlers grouped by area. Each linked doc is the canonical reference for that group — HTTP methods, paths, auth gates, body/query schemas, DB tables touched, external calls, response shape, side effects, and per-route notes.

## Groups

| Group | Path prefix | Auth | Doc |
|---|---|---|---|
| Places | `/api/places/*` | Required | [[places]] |
| Plans | `/api/plans/*` | Required | [[plans]] |
| Visits | `/api/visits/*` | Required | [[visits]] |
| Lists | `/api/lists/*` | Required | [[lists]] |
| Subcategories | `/api/subcategories/*` (Phase 2) | Required | [[subcategories]] |
| Shared | `/api/shared/*` | **Mixed** — GET `/[slug]` public via service role | [[shared]] |
| Stats | `/api/stats` | Required | [[stats]] |
| User | `/api/user/*` — includes `ai-settings` (Phase 1) and `ai-suggestions/*` (Phase 5 moderation queue: list, accept, reject) | Required | [[user]] |
| AI | `/api/ai/*` — `parse-query`, `rank-results` (Phase 6 NL filtering), `compare` (v1.19.0), `day-plan` (AI Plan — v1.22.0 as `trip-plan`; the group's only writing route). `chat` was removed in v1.48.0 | Required | [[ai]] |
| Assistant | `/api/assistant/chat` (one turn of the Claude agent, streaming), `/api/assistant/conversation` (latest conversation, New chat) — v1.48.0 | Required | [[assistant]] |
| Search | `/api/search/*` (Mapbox geocoder proxy) | Required | [[search]] |
| Instagram | `/api/instagram/import` (POST — start an import from a post URL, work runs in `after()`) + `/api/instagram/import/[id]` (GET — the dialog's progress view) — v1.28.0; `/api/instagram/import/[id]/pick` (POST — add the place picked for a skipped venue) — v1.28.1 | Required | [[instagram]] |
| Cron | `/api/cron/refresh-places` (15.07.2026) — daily periodic-refresh sweep; `/api/cron/drain-imports` (v1.26.0) — every minute, drains the import queue for Takeout and Instagram jobs | **`CRON_SECRET` bearer** (service-role) | [[../../06-ops/runbooks/periodic-refresh]], [[places]] |
| Claude connector | `/api/mcp` (GET/POST/DELETE — MCP Streamable HTTP, stateless; 17.11.2026) | **Bearer** — Supabase OAuth access token, owner accounts only (`withMcpAuth`); skips the session proxy | [[../../04-integrations/claude-mcp]] |
| Share target | `/api/share-target` | **None** (PWA inbound) | [[share-target]] |
| Auth callback | `/auth/callback` | **None** (OAuth handshake) | [[auth-callback]] |

> Two AI route locations on purpose: **user-initiated, latency-sensitive** calls (Phase 6 NL filtering) live in their own `/api/ai/*` group. The **background** profile-generation call is a branch on the existing places enrich route at `POST /api/places/[id]/enrich?step=profile`. Master toggle + moderation queue stay under `/api/user/*` because they key off the cookie-authenticated user.

## Counts

- 45 route handler files (43 × `src/app/api/**/route.ts` + `src/app/auth/callback/route.ts` + `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`; 17.11.2026 added `/api/mcp` and the metadata route) — Phase 6 added `/api/ai/parse-query` + `/api/ai/rank-results`; 15.07.2026 added `/api/cron/refresh-places`; v1.21.0 added `/api/ai/chat` (assistant); v1.22.0 added `/api/ai/trip-plan` + `PATCH /api/trips/[id]/days/[dayId]`; v1.26.0 swapped `import-parse` / `import-batch` / `bulk-enrich-reviews` for `import-jobs`, `import-jobs/[id]` and `cron/drain-imports` (net zero); v1.28.0 added `/api/instagram/import` + `/api/instagram/import/[id]`; v1.28.1 added `/api/instagram/import/[id]/pick`; v1.37.0 replaced the 7 `/api/trips/**` files with 4 under `/api/plans/**` and renamed `/api/ai/trip-plan` to `/api/ai/day-plan`; v1.38.0 added `/api/visits` + `/api/visits/[id]`. (NF-05 similar-adds reuse `POST /api/places` via the AddPlaceDialog preview — no dedicated route.)
- ~59 HTTP method exports across them

## Cross-route conventions

These hold for every route. See [[../_agent/conventions#api-routes]] for the full list.

1. **Auth gate at the top** (except the three explicitly public routes):

   ```ts
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
   ```

2. **RLS does access control**, not the route. Don't add `.eq("user_id", user.id)` — it's redundant. **Exception:** the service-role paths (listed in [[../supabase-clients]] — the public share read, both cron routes, the import-queue writes, the Instagram import's `after()` job and its pick route, plus the libs they call) BYPASS RLS, so they MUST filter by `user_id` explicitly on every query. Never assume RLS on a service-role client.
3. **Validate inputs.** Either Zod (preferred for complex bodies) or explicit destructuring with checks.
4. **Status codes**:
   - `200` — success (including `Response.redirect`).
   - `400` — bad input.
   - `401` — unauthenticated.
   - `404` — not found / no ownership.
   - `409` — duplicate (e.g. `google_place_id` collision).
   - `500` — unhandled error.
5. **Cost-tracked external calls go through `trackUsage`** (`src/lib/google/track-usage.ts`) → `increment_api_usage` RPC. Apply to every Google Places, DataForSEO, HikerAPI (v1.28.0, `hikerapi_request`) and (since v1.22.0) Mapbox Directions call (`mapbox_directions` — both `getRoute` call sites). For AI calls, use `trackAiUsage` (`src/lib/ai/track-usage.ts`) which writes the same table under `ai_*` SKUs.
6. **Service-role client** (`createServiceClient()`) only where no session can do the job: the public share read (`/api/shared/[slug]`, and the original-content reads in `.../save`), both cron routes (cross-user, no cookie), the `import_job_items` insert in `POST /api/places/import-jobs` (the table has no INSERT policy), the Instagram import's background job in `POST /api/instagram/import` (runs after the response; writes items), and `POST /api/instagram/import/[id]/pick` (moves an item the session client has just read; the table has no UPDATE policy). Every other route uses the cookie-scoped `createClient()`. Service-role paths must filter by `user_id` (see #2). Canonical list: [[../supabase-clients]].
7. **PostGIS coords are always parsed.** Every route that returns a place coercion `location` to `{ lat, lng }` via `src/lib/geo.ts#parsePostgisPoint` before serializing.

## Common helpers

These are reused across many routes:

| Helper | File | Purpose |
|---|---|---|
| `parsePostgisPoint` | `src/lib/geo.ts` | EWKB/WKT/GeoJSON → `{lat, lng}`. |
| `createClient` (server) | `src/lib/supabase/server.ts` | Cookie-scoped Supabase. |
| `createServiceClient` | `src/lib/supabase/server.ts` | RLS bypass — only on the paths in convention #6. |
| `trackUsage` | `src/lib/google/track-usage.ts` | Wraps `increment_api_usage` RPC. |
| `getUserApiKeys` | `src/lib/google/get-user-api-keys.ts` | The user's Mapbox token (the app's for admins); no Google key since v1.42.0. |
| `parseMapsUrl` | `src/lib/google/parse-maps-url.ts` | Google Maps URL → place data. |
| `fetchBusinessInfoLive` / `fetchReviews` | `src/lib/dataforseo/*.ts` | DataForSEO API wrappers. |
| `transformBusinessInfoToPlaceData` | `src/lib/dataforseo/transform.ts` | DataForSEO → app shape. |
| `downloadAndStorePhotoFromUrl` | `src/lib/dataforseo/photo.ts` | Photo → Supabase Storage. |
| `parseTakeoutGeoJson` / `parseTakeoutCsv` | `src/lib/google/takeout-parser.ts` | File import parsing. |
| `autoPlan` | `src/lib/plans/auto-plan.ts` | K-means + ordering, over anything with a location and a category. |
| `getRoute` | `src/lib/plans/directions.ts` | Mapbox Directions wrapper — takes the day's `RoutingProfile`. |
| `defaultCostEstimate` | `src/lib/plans/cost-defaults.ts` | price_level → per-person USD default for a new stop (`createPlan`, `changePlan`) — only for a stop in USD or without a currency. |
| `createPlan` / `changePlan` / `getPlan` … | `src/lib/plans/write.ts`, `read.ts` | The plan model's shared module — routes and (from slice 3) assistant tools call the same functions. See [[plans]]. |
| `logVisit` / `editVisit` / `deleteVisit` / `listVisits` | `src/lib/visits/write.ts`, `read.ts` | The visit model's shared module — routes and the `log_visit` / `get_visits` tools. See [[visits]]. |
| `requestContext` / `unauthorized` / `errorResponse` | `src/lib/api/http.ts` | The signed-in caller as a `UserContext`, and the data modules' errors (`InputError` → 400, `NotFoundError` → 404, else 500) as responses. |
| `isOpenOnDate` | `src/lib/places/open-now.ts` | Day-granular open flag from `work_timetable` (v1.22.0; AI Plan candidate projection). |
| `encryptApiKey` / `decryptApiKey` / `maskApiKey` | encryption helpers | API key crypto. |
| `nanoid(10)` | `nanoid` package | Slug generation. |
| `getAiClient` / `FLASH_MODEL` / `MODEL_VERSION` | `src/lib/ai/client.ts` | Gemini AI SDK v6 factory. Returns null when key is missing — route should short-circuit. |
| `buildUserContext` | `src/lib/ai/context-builder.ts` | Bundles user's tags/categories/subcategories/lists/cities for any LLM prompt. |
| `buildPlaceProfilePrompt` | `src/lib/ai/prompts/place-profile-full.ts` | System + user prompt for the full place_profile call. |
| `applyProfileSuggestions` | `src/lib/ai/apply-suggestions.ts` | 4-band auto-apply policy for LLM output. |
| `buildLiteProfile` | `src/lib/ai/extract/lite-profile.ts` | LLM-less rule-based profile inline in `parse-link`. |
| `dedupProposals` / `isFuzzyMatch` | `src/lib/ai/dedup.ts`, `normalize.ts` | Post-LLM and accept-time fuzzy match. |
| `trackAiUsage` / `checkAiBudget` | `src/lib/ai/track-usage.ts` | Per-SKU AI counter + monthly budget gates (search 500 / profile 1000 / compare 200 / chat 200 / trip_plan 50 / instagram 300). |
| `findExisting` / `importPlace` | `src/lib/import/process-place.ts` | Duplicate check by place_id / CID without an API call; per-place import used by the drain (`ImportDefaults.source` sets `places.source`). |
| `kickDrain` | `src/lib/import/kick-drain.ts` | Non-awaited `GET /api/cron/drain-imports` with the `CRON_SECRET` bearer — fired by the Takeout create route and the Instagram job (v1.28.0, moved out of the import-jobs route), and by the Instagram pick route (v1.28.1). |
| `analyzeInstagramPost` / `runInstagramImportJob` | `src/lib/instagram/analyze.ts`, `import-job.ts` | Instagram post → venues → Google places (writes nothing) / the job that turns that into `import_job_items` (v1.28.0). See [[instagram]]. |
| `googleMapsLookup` | `src/lib/instagram/places.ts` | The Instagram import's place lookup (v1.42.0, replaced Google Text Search): Google Maps search and area lookups through DataForSEO (`dataforseo_maps_search`), city centres from Mapbox. |
| `generatePlaceProfile` | `src/lib/ai/generate-profile.ts` | Full place_profile generation + auto-apply. Service-client-safe (used by enrich route + cron). |
| `refreshPlaceGoogleData` | `src/lib/places/refresh-google-data.ts` | Full DataForSEO re-lookup + review merge. Service-client-safe (used by refresh route + cron). |
| `mergeReviews` / `countNewReviews` | `src/lib/dataforseo/transform.ts` | Two-tier review corpus (relevance backbone + newest pool). |

## When you add a new route

Follow [[../../_agent/common-tasks#add-a-new-api-route]]. The short version:

1. Create `src/app/api/<area>/.../route.ts`.
2. Zod-validate the body.
3. Auth-gate.
4. Use cookie-scoped client (or service-role only if absolutely necessary — and document why).
5. Track external API calls via `trackUsage`.
6. Update the matching group doc in `02-backend/api-routes/`.
7. If a new entity is touched, update its domain doc and schema doc.
8. CHANGELOG.

## Open questions

- **Background work patterns.** Long work is queued, not fired from the client. Bulk import writes `import_job_items` and lets `/api/cron/drain-imports` advance them — claim a slice, work to a soft deadline, leave the rest for the next run (the same shape as `cron/refresh-places`). The Instagram import adds a second shape in front of the queue: one bounded unit of work (read one post) run in Next's `after()` under the route's `maxDuration`, which then writes items into the same queue. `migrate-photos` is still a synchronous fire-and-forget; move it to the same pattern if it starts brushing the function timeout.
- **No central error handler.** Each route catches and shapes errors in its own way. A shared `apiError(error, status)` helper could standardize the response shape.
