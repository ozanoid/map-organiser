---
title: Settings components
type: component
domain: frontend
version: 1.1.0
last_updated: 18.05.2026
status: stable
sources:
  - src/components/settings/api-keys-manager.tsx
  - src/components/settings/cost-tracker.tsx
  - src/components/settings/ai-settings.tsx
  - src/components/settings/ai-suggestions-queue.tsx
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/user]]"
  - "[[../../02-backend/schema/ai_suggestions_queue]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
  - "[[../../05-flows/full-profile-flow]]"
  - "[[../hooks/use-ai-suggestions]]"
---

# Settings components

Four components powering the Settings page tabs. All `"use client"`.

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

## `AiSettings`

- **File:** `src/components/settings/ai-settings.tsx` (Phase 1, extended in Phase 5)
- **Props:** none.
- **Hooks:** `useState`, `useEffect`. Optimistic-update + rollback-on-error pattern.
- **API calls:** `GET` and `PUT` `/api/user/ai-settings`.
- **State:** `{ enabled: boolean, available: boolean } | null` + `loading` + `saving`.
- **Renders:** Master toggle (rounded switch, accessible `role="switch"`/`aria-checked`). Below the toggle when **enabled + available**: composes `AiSuggestionsQueue`. When **not available** (server-side env missing): amber banner mentioning `GOOGLE_GENERATIVE_AI_API_KEY`. When disabled: queue UI hidden.
- **Used by:** `/settings` page (AI tab).

## `AiSuggestionsQueue`

- **File:** `src/components/settings/ai-suggestions-queue.tsx` (Phase 5; extended in Phase 5.5 with the `category_change` group)
- **Props:** none.
- **Hooks:** [[../hooks/use-ai-suggestions|`useAiSuggestions`/`useAcceptAiSuggestion`/`useRejectAiSuggestion`]].
- **Renders:**
  - Header line: `Pending suggestions` + total badge.
  - Up to three grouped sections, each rendered only when its `items.length > 0`:
    - **Tags** (Tag icon).
    - **Sub-categories** (FolderTree icon).
    - **Category changes** (ArrowRight icon — Phase 5.5).
  - Each row shows: proposed value (or `Move to <name>` for category_change), an optional **"moves <place> from X → Y"** amber annotation when the proposal implies a parent move, the sample place name, occurrence count, confidence percent, and Accept (emerald primary) + Reject (× ghost) buttons. Per-row loading spinners.
  - Toast feedback on success/failure (sonner).
- **Aggregation key:** matches `GET /api/user/ai-suggestions` server-side aggregation — same `(type, lower(value), parent_category_id, target_category_name)` collapses into one entry.
- **Used by:** `AiSettings` (and rendered inside the AI tab below the master toggle).

## Notes

- `ApiKeysManager` + `CostTracker` fetch on mount with no React Query. They could move to dedicated hooks for cache + revalidation, but the load is light and re-renders happen on save anyway.
- `AiSettings` uses raw `fetch` (not React Query) because the toggle state is rarely consumed elsewhere. `AiSuggestionsQueue` uses React Query (via `useAiSuggestions`) because the badge count and queue list need to refetch on mutation.
- **DataForSEO credentials are not exposed in `ApiKeysManager`** even though `profiles` has columns for them. Today DataForSEO is server-env-only. If we ever surface per-user DataForSEO billing, extend this component first.
