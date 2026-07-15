---
title: API Routes
type: overview
domain: backend
version: 1.4.0
last_updated: 15.07.2026
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
| Trips | `/api/trips/*` | Required | [[trips]] |
| Lists | `/api/lists/*` | Required | [[lists]] |
| Subcategories | `/api/subcategories/*` (Phase 2) | Required | [[subcategories]] |
| Shared | `/api/shared/*` | **Mixed** — GET `/[slug]` public via service role | [[shared]] |
| Stats | `/api/stats` | Required | [[stats]] |
| User | `/api/user/*` — includes `ai-settings` (Phase 1) and `ai-suggestions/*` (Phase 5 moderation queue: list, accept, reject) | Required | [[user]] |
| AI | `/api/ai/*` (Phase 6) — `parse-query`, `rank-results` for NL filtering | Required | [[ai]] |
| Search | `/api/search/*` (Mapbox geocoder proxy) | Required | [[search]] |
| Cron | `/api/cron/refresh-places` (15.07.2026) — daily periodic-refresh sweep | **`CRON_SECRET` bearer** (service-role) | [[../../06-ops/runbooks/periodic-refresh]] |
| Share target | `/api/share-target` | **None** (PWA inbound) | [[share-target]] |
| Auth callback | `/auth/callback` | **None** (OAuth handshake) | [[auth-callback]] |

> Two AI route locations on purpose: **user-initiated, latency-sensitive** calls (Phase 6 NL filtering) live in their own `/api/ai/*` group. The **background** profile-generation call is a branch on the existing places enrich route at `POST /api/places/[id]/enrich?step=profile`. Master toggle + moderation queue stay under `/api/user/*` because they key off the cookie-authenticated user.

## Counts

- ~37 route handler files (`src/app/api/**/route.ts` + `src/app/auth/callback/route.ts`) — Phase 6 added `/api/ai/parse-query` + `/api/ai/rank-results`; 15.07.2026 added `/api/cron/refresh-places` and `/api/places/add-similar` (v1.18.0, NF-05).
- ~58 HTTP method exports across them

## Cross-route conventions

These hold for every route. See [[../_agent/conventions#api-routes]] for the full list.

1. **Auth gate at the top** (except the three explicitly public routes):

   ```ts
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
   ```

2. **RLS does access control**, not the route. Don't add `.eq("user_id", user.id)` — it's redundant. **Exception:** the service-role paths (`GET /api/shared/[slug]`, `/api/cron/refresh-places` and the libs it calls) BYPASS RLS, so they MUST filter by `user_id` explicitly on every query. Never assume RLS on a service-role client.
3. **Validate inputs.** Either Zod (preferred for complex bodies) or explicit destructuring with checks.
4. **Status codes**:
   - `200` — success (including `Response.redirect`).
   - `400` — bad input.
   - `401` — unauthenticated.
   - `404` — not found / no ownership.
   - `409` — duplicate (e.g. `google_place_id` collision).
   - `500` — unhandled error.
5. **Cost-tracked external calls go through `trackUsage`** (`src/lib/google/track-usage.ts`) → `increment_api_usage` RPC. Apply to every Google Places and DataForSEO call. For AI calls, use `trackAiUsage` (`src/lib/ai/track-usage.ts`) which writes the same table under `ai_*` SKUs.
6. **Service-role client** (`createServiceClient()`) is used in `GET /api/shared/[slug]` and `GET /api/cron/refresh-places` (the periodic sweep runs cross-user, so it can't use a cookie). Every other route uses the cookie-scoped `createClient()`. Service-role paths must filter by `user_id` (see #2).
7. **PostGIS coords are always parsed.** Every route that returns a place coercion `location` to `{ lat, lng }` via `src/lib/geo.ts#parsePostgisPoint` before serializing.

## Common helpers

These are reused across many routes:

| Helper | File | Purpose |
|---|---|---|
| `parsePostgisPoint` | `src/lib/geo.ts` | EWKB/WKT/GeoJSON → `{lat, lng}`. |
| `createClient` (server) | `src/lib/supabase/server.ts` | Cookie-scoped Supabase. |
| `createServiceClient` | `src/lib/supabase/server.ts` | RLS bypass. **Only in `/api/shared/[slug]`.** |
| `trackUsage` | `src/lib/google/track-usage.ts` | Wraps `increment_api_usage` RPC. |
| `getUserApiKeys` | `src/lib/google/get-user-api-keys.ts` | Decrypts profile API keys. |
| `parseMapsUrl` | `src/lib/google/parse-maps-url.ts` | Google Maps URL → place data. |
| `getPlaceDetails` / `searchPlace` | `src/lib/google/places-api.ts` | Google Places API wrappers. |
| `fetchBusinessInfoLive` / `fetchReviews` | `src/lib/dataforseo/*.ts` | DataForSEO API wrappers. |
| `transformBusinessInfoToPlaceData` | `src/lib/dataforseo/transform.ts` | DataForSEO → app shape. |
| `downloadAndStorePhotoFromUrl` | `src/lib/dataforseo/photo.ts` | Photo → Supabase Storage. |
| `parseTakeoutGeoJson` / `parseTakeoutCsv` | `src/lib/google/takeout-parser.ts` | File import parsing. |
| `autoPlanTrip` | `src/lib/trip/auto-plan.ts` | K-means + ordering. |
| `getRoute` | `src/lib/trip/directions.ts` | Mapbox Directions wrapper. |
| `encryptApiKey` / `decryptApiKey` / `maskApiKey` | encryption helpers | API key crypto. |
| `nanoid(10)` | `nanoid` package | Slug generation. |
| `getAiClient` / `FLASH_MODEL` / `MODEL_VERSION` | `src/lib/ai/client.ts` | Gemini AI SDK v6 factory. Returns null when key is missing — route should short-circuit. |
| `buildUserContext` | `src/lib/ai/context-builder.ts` | Bundles user's tags/categories/subcategories/lists/cities for any LLM prompt. |
| `buildPlaceProfilePrompt` | `src/lib/ai/prompts/place-profile-full.ts` | System + user prompt for the full place_profile call. |
| `applyProfileSuggestions` | `src/lib/ai/apply-suggestions.ts` | 4-band auto-apply policy for LLM output. |
| `buildLiteProfile` | `src/lib/ai/extract/lite-profile.ts` | LLM-less rule-based profile inline in `parse-link`. |
| `dedupProposals` / `isFuzzyMatch` | `src/lib/ai/dedup.ts`, `normalize.ts` | Post-LLM and accept-time fuzzy match. |
| `trackAiUsage` / `checkAiBudget` | `src/lib/ai/track-usage.ts` | Per-SKU AI counter + monthly budget gate (search 500 / profile 1000). |
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

- **Background work patterns.** Several routes are fire-and-forget from the client (`bulk-enrich-reviews`, `migrate-photos`, the secondary review-enrichment after import). They run synchronously on Vercel Functions. If they ever exceed the function timeout, consider Supabase Edge Functions or Vercel Queues.
- **No central error handler.** Each route catches and shapes errors in its own way. A shared `apiError(error, status)` helper could standardize the response shape.
