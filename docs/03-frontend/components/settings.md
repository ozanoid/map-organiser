---
title: Settings components
type: component
domain: frontend
version: 1.0.0
last_updated: 12.05.2026
status: stable
sources:
  - src/components/settings/api-keys-manager.tsx
  - src/components/settings/cost-tracker.tsx
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/user]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
---

# Settings components

Two components for the Settings → API tab. Both `"use client"`.

## `ApiKeysManager`

- **File:** `src/components/settings/api-keys-manager.tsx`
- **Props:** none.
- **Hooks:** `useState`, `useEffect`.
- **API calls:**
  - `GET /api/user/api-keys` (fetch state).
  - `PUT /api/user/api-keys` (save / clear / toggle `googlePlacesEnabled`).
- **State:**
  - `data` (fetched key state — masked previews + has-key flags).
  - `loading` (initial fetch).
  - `googleKey`, `mapboxKey` (input buffers).
  - `showGoogle`, `showMapbox` (Eye/EyeOff toggles).
  - `savingGoogle`, `savingMapbox` (per-section save state).
- **Renders:**
  - Admin badge if user is admin (system keys in use).
  - Google API key input + masked placeholder if a key exists.
  - Mapbox token input + masked placeholder.
  - `googlePlacesEnabled` toggle.
  - Help links to Google Cloud Console and Mapbox Account.
  - Footer note: AES-256-GCM encryption.
- **Toast feedback** on save success/failure (sonner).
- **Used by:** `/settings` page (API tab).

## `CostTracker`

- **File:** `src/components/settings/cost-tracker.tsx`
- **Props:** none.
- **Hooks:** `useState`, `useEffect`.
- **API calls:** `GET /api/user/usage` (fetch monthly usage).
- **State:** `data`, `loading`.
- **Renders:**
  - Per-SKU usage rows — name, count, free limit, progress bar (emerald < 80 %, amber 80–100 %, red > 100 %).
  - Estimated cost per row.
  - Total estimated cost at the bottom (green if $0, red if charged).
  - Skeleton loader with 5 placeholder rows.
- **Used by:** `/settings` page (API tab, below `ApiKeysManager`).

## Notes

- Both components fetch on mount with no React Query. They could move to dedicated hooks (`useApiKeys`, `useUsage`) for cache + revalidation, but the load is light and re-renders happen on save anyway.
- **DataForSEO credentials are not exposed in `ApiKeysManager`** even though `profiles` has columns for them. Today DataForSEO is server-env-only. If we ever surface per-user DataForSEO billing, extend this component first.
