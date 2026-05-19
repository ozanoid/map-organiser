---
title: Search components
type: component
domain: frontend
version: 1.1.0
last_updated: 19.05.2026
status: stable
sources:
  - src/components/search/ai-search-input.tsx
  - src/lib/hooks/use-ai-search.ts
  - src/lib/stores/ai-search-store.ts
related:
  - "[[_README]]"
  - "[[filters]]"
  - "[[map]]"
  - "[[places]]"
  - "[[../../02-backend/api-routes/ai]]"
  - "[[../../05-flows/ai-search-flow]]"
  - "[[../state-management#ai-search-store]]"
---

# Search components

Folder shipped in Phase 6 to host the AI-01 NL filtering UI. Currently
holds one component, but the folder is the canonical home for future
search-related primitives (saved queries, query history, voice input).

## `AiSearchInput`

> `src/components/search/ai-search-input.tsx`

The natural-language search box mounted at the top of the FilterPanel.

### Props

None. It reads everything it needs from hooks/stores:

- `useAiSearch()` — mutation that POSTs to `/api/ai/parse-query`
- `useAiSearchStore()` — transient session state (lastQuery, rerankStatus, clarification)
- `/api/user/ai-settings` (one-shot fetch on mount) — to know whether to render at all

### Render conditions

The component **renders nothing** when:

- `/api/user/ai-settings` hasn't responded yet (avoids flash)
- `enabled = false` (user has the master toggle off)
- `available = false` (`GOOGLE_GENERATIVE_AI_API_KEY` missing on the deployment)

When all three pass, the input mounts with the Sparkles icon on the left
and an `X` clear button or loading spinner on the right depending on
state.

### Behaviour

1. User types and presses Enter / submit.
2. Validate ≤ 200 chars (toast if exceeded).
3. `useAiSearch.mutate(query)` POSTs to `/api/ai/parse-query`.
4. On success — applied filters cascade through `useFilters.setFilters`,
   triggering a `usePlaces` refetch; semantic state lands in the store.
5. The rerank orchestrator (mounted in `MapContent`) takes over and
   POSTs to `/api/ai/rank-results` once the new place list settles.
6. Below the input: subtitle line shows `"AI search: <query>"` plus the
   rerank status (`· ranked` / `· AI ranking unavailable`).
7. If the LLM set `needs_clarification`, an amber chip with the
   follow-up question appears below the subtitle.
8. The `X` button clears the draft, resets the AI search store, and
   leaves the URL filters alone (so the user can fine-tune).

### Hint chips (Phase 6 v1.7.1)

When the LLM identifies a curated tag/list/sub-cat that's semantically
related to the query but chose NOT to hard-filter (preserving discovery),
those associations come back in `parseQuery.boosts.*`. The component
renders them below the input as small clickable chips:

```
💡 You have curated items that may match. Narrow further?
   [tag · Date Spot]  [sub-cat · Fine Dining]  [list · London Trip]
```

Each chip resolves its ID to the user-friendly name via `useTags` /
`useLists` / `useSubcategories`. Click → `setFilters({ tag_ids: [id] })`
(or the equivalent for list/sub-cat). This converts the soft boost
into an explicit hard filter on user demand — opt-in narrowing without
the LLM making that call automatically.

## State shape — `useAiSearchStore` (Zustand)

| Field | Type | Notes |
|---|---|---|
| `semanticIntent` | `string \| null` | The LLM's English restatement; passed to rank-results. |
| `needsRerank` | `boolean` | Set by parse-query output. |
| `rankings` | `Map<placeId, { score, why }> \| null` | Populated by rank-results. |
| `rerankStatus` | `"idle" \| "pending" \| "ready" \| "failed"` | UI-visible. |
| `clarification` | `string \| null` | LLM follow-up question. |
| `lastQuery` | `string \| null` | Display label. |
| `boosts` | `{ matching_tag_ids, matching_list_ids, matching_subcategory_ids }` | Semantic associations from `parse-query.boosts.*`. Drives hint chips + rank-results boost lookup. NOT applied as hard filter. |

Cleared by user-initiated "Clear" in the FilterPanel and on every new
NL search submission.

## Cross-component consumers

| Consumer | Reads | Behaviour when AI search active |
|---|---|---|
| [[map\|MapContent]] | `rankings` | Sorts `visiblePlaceIds` by score desc; fades < 0.3 rows. |
| [[places\|PlaceCard]] | `rankings.get(place.id)` | Shows LLM `why` line in italic emerald instead of address. Fades when < 0.3. |
| [[filters\|FilterPanel]] | (no read, only `reset` on clear) | "Clear" wipes both URL filters and the AI search store atomically. |

## See also

- [[../../02-backend/api-routes/ai]] — the two routes powering this
- [[../../05-flows/ai-search-flow]] — full E2E flow
- [[../hooks/_README#use-ai-search]] — orchestrator hook documentation
