---
title: useAiSuggestions
type: hook
domain: frontend
version: 1.0.0
last_updated: 14.05.2026
status: stable
sources:
  - src/lib/hooks/use-ai-suggestions.ts
related:
  - "[[_README]]"
  - "[[../../02-backend/api-routes/user]]"
  - "[[../../02-backend/schema/ai_suggestions_queue]]"
  - "[[../../05-flows/full-profile-flow]]"
---

# `useAiSuggestions` and family

Three exports for the Phase 5 moderation queue UI.

## Signatures

```ts
function useAiSuggestions(): UseQueryResult<AiSuggestion[], Error>
function useAcceptAiSuggestion(): UseMutationResult<unknown, Error, string>
function useRejectAiSuggestion(): UseMutationResult<unknown, Error, string>

interface AiSuggestion {
  key: string;
  type: "tag" | "subcategory";
  proposed_value: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  confidence: number;
  occurrences: number;
  latest_at: string;
  sample_place_name: string | null;
  ids: string[];
}
```

## Behavior

| Hook | Source | Invalidates |
|---|---|---|
| `useAiSuggestions` | `GET /api/user/ai-suggestions`. Server pre-aggregates by `(type, lower(value), parent)`. `staleTime: 30s`. Query key `["ai-suggestions"]`. | — |
| `useAcceptAiSuggestion` | `POST /api/user/ai-suggestions/[id]/accept`. Creates entity + applies to places. | `["ai-suggestions"]`, `["tags"]`, `["subcategories"]`, `["places"]` |
| `useRejectAiSuggestion` | `POST /api/user/ai-suggestions/[id]/reject`. | `["ai-suggestions"]` |

## Query key

`["ai-suggestions"]` — single cache slot. Also consumed by `AiTabTrigger` in `src/app/(app)/settings/page.tsx` to render the pending-count badge on the AI tab.

## Consumers

- `src/components/settings/ai-suggestions-queue.tsx` — the moderation UI inside the Settings → AI tab.
- `src/app/(app)/settings/page.tsx#AiTabTrigger` — pending count badge.

## Edge cases

- **30s staleTime** keeps the badge reasonably fresh without polling. Profile generation typically takes longer than a moderation review session, so manual refetch (route change / tab focus) is sufficient.
- **`ids[]` per row**: the GET aggregates siblings, but accept/reject only receives a single ID. The route handlers re-discover siblings server-side via the dedup key, so passing any one ID accepts/rejects the whole group atomically.
- **Cross-cache invalidation on accept**: tag accept creates a `tags` row + `place_tags` joins → invalidate `["tags"]` and `["places"]`. Sub-category accept creates a `subcategories` row + updates `places.subcategory_id` → invalidate `["subcategories"]` and `["places"]`.
- **No optimistic updates**: the accept path mutates multiple tables (entity + joins). A failure mid-flight would leave UI ahead of DB — round-trip is safer.
