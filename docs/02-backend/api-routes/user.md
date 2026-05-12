---
title: User routes
type: route-group
domain: backend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/app/api/user/api-keys/route.ts
  - src/app/api/user/usage/route.ts
related:
  - "[[_README]]"
  - "[[../schema/profiles]]"
  - "[[../schema/api_usage]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
---

# User routes

Two endpoints under `/api/user/*` — both about the **caller's own** profile.

## At a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/user/api-keys` | Read masked API key state + `googlePlacesEnabled` flag. |
| `PUT` | `/api/user/api-keys` | Update / clear encrypted API keys + flag. |
| `GET` | `/api/user/usage` | Monthly API usage rollup + estimated cost. |

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

## Cross-route concerns

- **Encryption is symmetric.** `encryptApiKey` and `decryptApiKey` use the same `ENCRYPTION_SECRET` — rotating it without re-encrypting renders all stored keys unreadable. See [[../../06-ops/encryption]] when written.
- **No DELETE endpoint.** Clearing a key is done via `PUT` with `null`. A dedicated `DELETE` would be redundant but more discoverable.

## Open questions

- **DataForSEO credential surface.** The `profiles.dataforseo_*_enc` columns are present but unused by this API. Decide: expose them here (multi-tenant DataForSEO billing) or drop the columns (single-tenant via env).
- **Admin endpoints.** `isAdmin` is returned but no admin routes exist. If admin features are planned, they'd live here or under `/api/admin/*`.
