---
title: Settings components
type: component
domain: frontend
version: 1.3.0
last_updated: 15.07.2026
status: stable
sources:
  - src/components/settings/api-keys-manager.tsx
  - src/components/settings/cost-tracker.tsx
  - src/components/settings/ai-settings.tsx
  - src/components/settings/ai-suggestions-queue.tsx
  - src/components/settings/backfill-profiles-panel.tsx
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/user]]"
  - "[[../../02-backend/schema/ai_suggestions_queue]]"
  - "[[../../01-domain/users-and-profiles]]"
  - "[[../../06-ops/encryption]]"
  - "[[../../05-flows/full-profile-flow]]"
  - "[[../hooks/use-ai-suggestions]]"
  - "[[../../06-ops/runbooks/profile-backfill]]"
---

# Settings components

Five components powering the Settings page tabs. All `"use client"`.

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
- **State:** `{ enabled: boolean, available: boolean, cronRefreshEnabled: boolean } | null` + `loading` + `saving`.
- **Renders:** Master toggle (rounded switch, accessible `role="switch"`/`aria-checked`). Always below it (independent of the AI master — the data half isn't AI): the **"Background data refresh" toggle** (15.07.2026 — opt-in for the whole periodic sweep, default off; see [[../../06-ops/runbooks/periodic-refresh]]). Then, when **enabled + available**: `BackfillProfilesPanel` and `AiSuggestionsQueue`. When **not available** (server-side env missing): amber banner mentioning `GOOGLE_GENERATIVE_AI_API_KEY`.
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

## `BackfillProfilesPanel`

- **File:** `src/components/settings/backfill-profiles-panel.tsx` (Phase 6 follow-up, v1.7.x)
- **Props:** none.
- **Hooks:** [[../hooks/use-backfill-profiles|`useBackfillEligibility`/`useStartBackfill`]].
- **Why it exists:** Pre-Phase-4 places have no `place_profile` (the AI summary + features payload). Phase 6 NL search soft-features filter and rerank both lean on profile content, so collections with low coverage feel weaker. This panel lets the user opt into bulk generation for their existing places.
- **Renders:** an emerald-tinted card that summarizes coverage and a `Generate (N)` button. Three counts:
  - `has_reviews_no_profile` — Gemini Flash only (~\$0.001 each).
  - `has_cid_no_reviews` — DataForSEO `step=reviews` then chained `step=profile` (~\$0.002 each).
  - `no_cid_no_profile` — cannot be enriched (no Google Place ID). Shown as muted "skipped" line.
  - Cost estimate footer with the total in USD.
- **Behavior:**
  - Click `Generate` → `POST /api/user/backfill-profiles` (limit 25 per call). The route fires `step=profile` or `step=reviews` for each, fire-and-forget. UI receives `{ queued, has_more, remaining_after }`.
  - When `has_more = true`, the panel enters **auto-iterate mode**: it re-POSTs every 12 s until the eligible count hits zero, while polling eligibility every 5 s. Safety ceiling: 50 iterations (covers up to 1250 places).
  - Stop button cancels the auto-iterate loop. Already-queued background jobs continue.
  - Hides automatically when `ai_features_enabled = false` or when there's nothing left to enrich.
- **Used by:** `AiSettings` (rendered between the master toggle and the moderation queue).
- **Companion runbook:** [[../../06-ops/runbooks/profile-backfill]] for ops / re-runs / cost notes.

## Notes

- `ApiKeysManager` + `CostTracker` fetch on mount with no React Query. They could move to dedicated hooks for cache + revalidation, but the load is light and re-renders happen on save anyway.
- `AiSettings` uses raw `fetch` (not React Query) because the toggle state is rarely consumed elsewhere. `AiSuggestionsQueue` uses React Query (via `useAiSuggestions`) because the badge count and queue list need to refetch on mutation.
- **DataForSEO credentials are not exposed in `ApiKeysManager`** even though `profiles` has columns for them. Today DataForSEO is server-env-only. If we ever surface per-user DataForSEO billing, extend this component first.
