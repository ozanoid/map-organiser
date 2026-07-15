---
title: User routes
type: route-group
domain: backend
version: 1.3.0
last_updated: 15.07.2026
status: stable
sources:
  - src/app/api/user/api-keys/route.ts
  - src/app/api/user/usage/route.ts
  - src/app/api/user/ai-settings/route.ts
  - src/app/api/user/ai-suggestions/route.ts
  - src/app/api/user/ai-suggestions/[id]/accept/route.ts
  - src/app/api/user/ai-suggestions/[id]/reject/route.ts
  - src/app/api/user/backfill-profiles/route.ts
related:
  - "[[_README]]"
  - "[[../schema/profiles]]"
  - "[[../schema/api_usage]]"
  - "[[../schema/ai_suggestions_queue]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
  - "[[../../05-flows/full-profile-flow]]"
---

# User routes

Two endpoints under `/api/user/*` — both about the **caller's own** profile.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/user/api-keys` | Read masked API key state + `googlePlacesEnabled` flag. |
| `PUT` | `/api/user/api-keys` | Update / clear encrypted API keys + flag. |
| `GET` | `/api/user/usage` | Monthly API usage rollup + estimated cost. |
| `GET` | `/api/user/ai-settings` | Read the master AI toggle + background-refresh opt-in + server-side availability flag. |
| `PUT` | `/api/user/ai-settings` | Flip `profiles.ai_features_enabled` and/or `profiles.cron_refresh_enabled`. |
| `GET` | `/api/user/ai-suggestions` | List pending AI proposals (Phase 5 moderation queue), pre-grouped by `(type, slug, parent)`. |
| `POST` | `/api/user/ai-suggestions/[id]/accept` | Create the proposed tag / sub-category and apply it to every queued place. |
| `POST` | `/api/user/ai-suggestions/[id]/reject` | Mark proposal (and siblings) as `rejected`. Vocabulary untouched. |
| `GET` | `/api/user/backfill-profiles` | Eligibility report: how many places need an AI profile + estimated cost. |
| `POST` | `/api/user/backfill-profiles` | Dispatch up to 25 fire-and-forget enrich calls for profile-less places. Client iterates until done. |

All require auth.

---

## Per-route detail

### `GET /api/user/api-keys`

- **Source:** `src/app/api/user/api-keys/route.ts`
- **DB:** `profiles` SELECT.
- **External:** `decryptApiKey` + `maskApiKey` to produce display strings.
- **Response:**

```ts
{
  isAdmin: boolean,
  googleApiKey: string | null,     // masked, e.g. "AIza...QwEr"
  mapboxToken: string | null,      // masked
  hasGoogleKey: boolean,           // unmasked existence flag
  hasMapboxToken: boolean,
  googlePlacesEnabled: boolean,
}
```

- **Notes:** Never returns the raw decrypted key. The mask shows only first and last characters.

### `PUT /api/user/api-keys`

- **Source:** `src/app/api/user/api-keys/route.ts`
- **Body:** `{ googleApiKey?: string|null, mapboxToken?: string|null, googlePlacesEnabled?: boolean }`. Sending `null` clears the column; omitting leaves it untouched.
- **DB:** `profiles` UPDATE.
- **External:** `encryptApiKey` for each non-null key.
- **Response:** `{ success: true }`. `400` if no keys/flags were provided, `401`, `500`.
- **Notes:** **DataForSEO credentials are not currently exposed** by this route, even though `profiles` has `dataforseo_login_enc` and `dataforseo_password_enc` columns. DataForSEO is configured via env vars only today. Future work may surface per-user credentials here.

### `GET /api/user/usage`

- **Source:** `src/app/api/user/usage/route.ts`
- **DB:** via `getMonthlyUsage` helper which reads `api_usage`.
- **Response:**

```ts
{
  month: "YYYY-MM",
  usage: Array<{ sku: string, count: number, cost: number }>,
  totalEstimatedCost: number,
}
```

- **Notes:** Estimated cost = `(count / 1000) * cost_per_1k` per row; summed for the total. Month string is current month.

### `GET /api/user/ai-settings`

- **Source:** `src/app/api/user/ai-settings/route.ts`
- **DB:** `profiles` SELECT (`ai_features_enabled, cron_refresh_enabled`).
- **Response:** `{ enabled: boolean, available: boolean, cronRefreshEnabled: boolean }`. `available` reflects the presence of `GOOGLE_GENERATIVE_AI_API_KEY` on the server; `cronRefreshEnabled` is the opt-in for the whole periodic refresh sweep (default false — see [[../../06-ops/runbooks/periodic-refresh]]).

### `PUT /api/user/ai-settings`

- **Body:** `{ enabled?: boolean, cronRefreshEnabled?: boolean }` (Zod-validated; at least one required).
- **DB:** `profiles` UPDATE.
- **Response:** `{ success: true, enabled }`.
- **Notes:** Phase 1 master toggle. When `false`, every other AI endpoint short-circuits and the UI hides AI affordances.

### `GET /api/user/ai-suggestions`

- **Source:** `src/app/api/user/ai-suggestions/route.ts`
- **DB:** `ai_suggestions_queue` SELECT scoped to `user_id` + `status='pending'`, joined with `places(name)` and `categories(name)` for UI context.
- **Pre-aggregation:** rows with the same `(type, lower(proposed_value), parent_category_id)` collapse into a single entry carrying `occurrences`, `ids[]`, and the most-recent `created_at`. Sorted by `occurrences DESC` so frequently-proposed concepts surface first.
- **Response:** `{ suggestions: AiSuggestion[] }` where each `AiSuggestion` includes `type`, `proposed_value`, `parent_category_id`, `parent_category_name`, `confidence`, `occurrences`, `sample_place_name`, `ids`.

### `POST /api/user/ai-suggestions/[id]/accept`

- **DB:** Looks up the source row; collects all sibling pending rows (same user + type + normalized value + parent). Then:
  - **tag**: reuses an existing tag with the same name if present (avoids dupes when the user manually created the same tag meanwhile); else INSERT into `tags`. Attaches to every queued place via `place_tags` (skips pre-existing `(place_id, tag_id)`).
  - **subcategory**: reuses an existing slug under the same parent if present (flips `is_pending`→false); else INSERT into `subcategories` with `is_default=false`, `is_pending=false`, `approved_at=now()`. Updates `places.subcategory_id` for every queued place.
- All sibling queue rows transition to `status='accepted'` with `resolved_at`.
- **Response:** `{ success: true, accepted_count, affected_places }`.
- **Idempotency:** safe to call twice; second call returns `409 Already accepted`.

### `POST /api/user/ai-suggestions/[id]/reject`

- **DB:** Marks the source row and all siblings as `status='rejected'`. No entity created, no places mutated.
- **Response:** `{ success: true, rejected_count }`.

## Cross-route concerns

- **Encryption is symmetric.** `encryptApiKey` and `decryptApiKey` use the same `ENCRYPTION_SECRET` — rotating it without re-encrypting renders all stored keys unreadable. See [[../../06-ops/encryption]] when written.
- **No DELETE endpoint.** Clearing a key is done via `PUT` with `null`. A dedicated `DELETE` would be redundant but more discoverable.

## Open questions

- **DataForSEO credential surface.** The `profiles.dataforseo_*_enc` columns are present but unused by this API. Decide: expose them here (multi-tenant DataForSEO billing) or drop the columns (single-tenant via env).
- **Admin endpoints.** `isAdmin` is returned but no admin routes exist. If admin features are planned, they'd live here or under `/api/admin/*`.
