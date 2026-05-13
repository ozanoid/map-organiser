---
title: API Routes
type: overview
domain: backend
version: 1.1.0
last_updated: 13.05.2026
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
| Shared | `/api/shared/*` | **Mixed** — GET `/[slug]` public via service role | [[shared]] |
| Stats | `/api/stats` | Required | [[stats]] |
| User | `/api/user/*` | Required | [[user]] |
| Search | `/api/search/*` | Required | [[search]] |
| Share target | `/api/share-target` | **None** (PWA inbound) | [[share-target]] |
| Auth callback | `/auth/callback` | **None** (OAuth handshake) | [[auth-callback]] |

## Counts

- 26 route handler files (`src/app/api/**/route.ts` + `src/app/auth/callback/route.ts`)
- ~50 HTTP method exports across them

## Cross-route conventions

These hold for every route. See [[../_agent/conventions#api-routes]] for the full list.

1. **Auth gate at the top** (except the three explicitly public routes):

   ```ts
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
   if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
   ```

2. **RLS does access control**, not the route. Don't add `.eq("user_id", user.id)` — it's redundant.
3. **Validate inputs.** Either Zod (preferred for complex bodies) or explicit destructuring with checks.
4. **Status codes**:
   - `200` — success (including `Response.redirect`).
   - `400` — bad input.
   - `401` — unauthenticated.
   - `404` — not found / no ownership.
   - `409` — duplicate (e.g. `google_place_id` collision).
   - `500` — unhandled error.
5. **Cost-tracked external calls go through `trackUsage`** (`src/lib/google/track-usage.ts`) → `increment_api_usage` RPC. Apply to every Google Places and DataForSEO call.
6. **Service-role client** (`createServiceClient()`) is used ONLY in `GET /api/shared/[slug]`. Every other route uses the cookie-scoped `createClient()`.
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
