---
title: "Phase 6 — AI-01 NL Filtering (plan)"
type: plan
domain: ai
version: 0.2.0
last_updated: 18.05.2026
status: draft
related:
  - "[[../_archive/feature-suggestions_v3#AI-01]]"
  - "[[../04-integrations/gemini]]"
  - "[[../05-flows/full-profile-flow]]"
  - "[[../01-domain/places]]"
  - "[[../02-backend/schema/profiles]]"
---

# Phase 6 — AI-01 Natural-Language Filtering (plan)

> **Scope.** Forward-looking plan for the next AI feature after Phase 5.5. Lives in `_plans/` until merged; then the relevant content moves into `02-backend/api-routes/`, `03-frontend/components/`, `05-flows/` and this file gets archived.

## Goal

Let the user filter their place collection with **natural language** instead of clicking through cascading filters.

Example queries:
- `"coffee shops in Shoreditch for remote work with good wifi"`
- `"cozy dinner spots I haven't been to"`
- `"places I saved last week in Berlin"`
- `"vegan brunch with outdoor seating"`

## Non-goals (Phase 6)

- Conversational / multi-turn agent (AI-02, separate phase)
- Action verbs ("add these to my favorites") — read-only filtering only
- Cross-user search / public discovery
- Saved queries / query history — single-shot only
- Voice input

## Architecture: three-layer matching

Already prepared in Phase 1: the `ParseQuerySchema` returns **three** layers of signal, not two. This is sharper than the initial sketch:

```
            ┌──────────────────────────┐
            │ POST /api/ai/parse-query │
            │  (Gemini Flash + Zod)    │
            └──────────────┬───────────┘
                           ▼
       ┌─────────────────────────────────────────────┐
       │ { hard: { category_ids, subcategory_ids,   │
       │           tag_ids, city, visit_status,     │
       │           rating_min, … },                 │
       │   soft_features: { atmosphere, dietary,    │
       │           occasions, seating, cuisine_… }, │
       │   semantic_intent: "<clean english>",       │
       │   requires_semantic_ranking: bool,         │
       │   needs_clarification: string | null }      │
       └─────────────────────────────────────────────┘
                           │
       ┌───────────────────┼─────────────────────┐
       ▼                   ▼                     ▼
   Layer 1            Layer 2                Layer 3
   HARD               SOFT                   SEMANTIC
   (SQL filter)       (server-side           (LLM rerank
                       JSONB match           on profile.
                       against profile.       searchable_
                       features)              summary)
```

### Layer 1 — Hard filters → existing `/api/places` query

The `hard` block maps **1:1** to the existing query-string filters that `/api/places` accepts (`category`, `subcategory`, `tags`, `status`, `rating`, etc.). The frontend just calls `setFilters(parseResult.hard)` from `useFilters` and existing infrastructure does the rest.

### Layer 2 — Soft features → JSONB match against `place_profile.features.*`

The `soft_features` block (atmosphere, dietary, occasions, seating, cuisine_types) maps **1:1** to `place_profile.features.*` shape (Phase 4). Match is done **server-side** in `/api/places` (extended) by intersecting `place_profile.features.<key>` arrays with the requested terms — **no LLM call**, just SQL/JSONB filter. Free.

For places without a `place_profile` (pre-Phase-4 saved places), soft_features matching is skipped — those places either pass through to Layer 3 or are excluded depending on intent.

### Layer 3 — Semantic rerank → `/api/ai/rank-results`

The LLM trigger is `parseResult.requires_semantic_ranking === true`. The LLM itself decides this in the prompt:

- Setting `true` when the query has genuine fuzzy semantics that didn't fit into hard or soft (`"good for working alone"`, `"low-key atmosphere"`, `"date-night spot"`).
- Setting `false` for purely structural queries (`"all my cafes"`, `"places I haven't visited"`).

When `true`: candidates (from Layer 1 + 2) are sent to `/api/ai/rank-results` along with their `place_profile.searchable_summary` text. The LLM scores and reorders.

**Key insight:** because the LLM is deciding `requires_semantic_ranking` based on the query itself (not result count), we never silently drop semantic intent on small result sets — the bug we caught in planning.

## Components

### `POST /api/ai/parse-query`

**Input:**
```ts
{
  query: string;          // raw user input, ≤ 200 chars
}
```
User context (categories, sub-cats, tags, lists, cities, countries) is built server-side via `buildUserContext` — never trusted from the client.

**Output:** see `src/lib/ai/schemas/parse-query.ts` (already shipped in Phase 1).

**Prompt constraints:**
- LLM may only return IDs from the user's context. Server-side validation strips unknown IDs (defense in depth).
- Output language: English (canonical) regardless of input language. Mixed TR/EN inputs handled.
- Date phrases (`"last week"`, `"in May"`) resolve to ISO ranges via `created_after`. Year defaults to current year if absent.
- `requires_semantic_ranking` is set by the LLM itself based on whether the query contains unstructured intent beyond hard + soft.
- `needs_clarification` is set only when the query is genuinely ambiguous (e.g. `"good places"` with no context).

**SKU:** `ai_parse_query` — already registered, $0.0001/call.

### `POST /api/ai/rank-results`

**Input:**
```ts
{
  semantic_intent: string;
  candidates: { id: string; searchable_summary: string; name: string }[];
}
```

**Output:**
```ts
{
  ranked: { id: string; score: number; why: string }[];
}
```

**Pre-call rules (client-side):**
- Candidates capped at **TOP_N = 50**. If filter returns more, pre-sort by `updated_at DESC` and take first 50; the rest go into a "More results" tail without rerank.
- Candidates with empty `searchable_summary` still included; LLM falls back to `name`.
- Cost guard server-side: reject if `candidates.length > 200` to prevent runaway.

**SKU:** `ai_rank_results` — already registered, ~$0.002/call.

### `AISearchInput` component (`src/components/search/ai-search-input.tsx`)

- Placement: above the existing filter chip strip in the map sidebar.
- Placeholder: `"Try: cozy cafes for remote work"`.
- Submit (Enter or button) → `useAiParseQuery` → on success:
  - `setFilters({ ...parseResult.hard })` (Layer 1 applies)
  - Cache soft_features + semantic_intent in component state for downstream use
  - If `requires_semantic_ranking`: fire `useAiRankResults` against the filtered candidates
  - If `needs_clarification`: render the LLM's follow-up question as a chip
- Below the input: chips for what was applied (`Cafe`, `Shoreditch`, `cozy atmosphere`), each individually removable.
- Hidden entirely when `profiles.ai_features_enabled = false`.
- Loading state: subtle spinner on the input + skeleton on the list during rerank.

### List card extension

Each `PlaceCard` gains an optional `aiRankReason?: string` prop. When set, render as a small italic muted line under the place name. Cards under the `< 0.3` score collapse under a `"Less relevant"` accordion.

## Data flow (end to end)

```
User types: "cozy cafes in Shoreditch for remote work"
  │
  ▼
1. POST /api/ai/parse-query → returns:
     hard: { category_ids: [cafeId], city: "Shoreditch" }
     soft_features: { atmosphere: ["cozy"], occasions: ["working", "remote work"] }
     semantic_intent: "cafes with cozy atmosphere, good for remote working"
     requires_semantic_ranking: true
  │
  ▼
2. Client applies hard filters via useFilters.setFilters({ ... })
     /api/places refetched, server now ALSO intersects soft_features against
     place_profile.features.atmosphere and .occasions.
  │
  ▼
3. /api/places returns 12 matching cafes (hard ∩ soft).
  │
  ▼
4. requires_semantic_ranking = true → POST /api/ai/rank-results
     { semantic_intent, candidates: [12 cafes with their searchable_summary] }
  │
  ▼
5. Returns:
     [
       { id: p1, score: 0.92, why: "Specialty coffee, wifi, freelancer-friendly" },
       { id: p3, score: 0.85, why: "Quiet workspace, communal tables" },
       …
       { id: p4, score: 0.12, why: "Takeaway-focused, no seating" }
     ]
  │
  ▼
6. List re-orders. Cards < 0.3 → "Less relevant" accordion.
```

## Edge cases

| Case | Handling |
|---|---|
| `ai_features_enabled = false` | `AISearchInput` not rendered. Routes 403. |
| LLM returns invalid filter IDs | Server-side strips, logs. Applied filters reflect the strip. |
| `parse-query` fails (5xx/timeout) | Toast: "Couldn't understand that." Fall back to plain `q=<query>` text search. |
| Zero candidates after Layer 1+2 | Empty state: "No matches. Drop filters?" with one-tap remove buttons. Rerank not called. |
| `rank-results` fails | Show candidates in default order with banner: "AI ranking unavailable." |
| > 50 candidates | Top 50 by recency → rerank. Rest under "More results" without scores. |
| All candidates lack `place_profile` | Rerank still called (LLM uses `name` only). Banner: "Limited AI ranking." |
| Query in mixed TR/EN | Prompt handles canonical mapping. |
| `needs_clarification` set | Chip with question → user refines and re-submits. |

## Cost

| Operation | Tokens | Cost | When |
|---|---|---|---|
| `ai_parse_query` | ~500 in + ~150 out | ~$0.0001 | Every submitted query |
| `ai_rank_results` | ~25k in + ~1k out (50 cand.) | ~$0.0021 | Only when `requires_semantic_ranking = true` |

User with 20 queries/day, half rerank → ~$0.022/day → ~$0.66/mo. Same order as Phase 4.

## Implementation slices (single PR)

Per user request, **single branch + single PR** for the whole phase. Commit slices for review clarity:

### Slice A — parse-query (backend)
- `src/lib/ai/prompts/parse-query.ts` (new)
- `src/app/api/ai/parse-query/route.ts` (new)
- `src/lib/ai/extract/parse-date-phrases.ts` (new, optional pre-LLM date hint)

### Slice B — soft-features matching in `/api/places`
- Extend `/api/places` GET to accept `soft_features` JSON body (or repeated `feat=key:value` params)
- Server-side JSONB intersect against `place_profile.features.*`
- Add to filter shape in `useFilters`

### Slice C — rank-results (backend)
- `src/lib/ai/prompts/rank-results.ts` (new)
- `src/lib/ai/schemas/rank-results.ts` (new)
- `src/app/api/ai/rank-results/route.ts` (new)
- Cost-guard at 200 candidates

### Slice D — frontend
- `src/components/search/ai-search-input.tsx`
- `src/lib/hooks/use-ai-parse-query.ts`
- `src/lib/hooks/use-ai-rank-results.ts`
- Filter chip strip ("applied" indicators)
- `PlaceCard` `aiRankReason` prop + "Less relevant" accordion
- `ai_features_enabled` gating

### Slice E — vault sync
- New `02-backend/api-routes/ai.md`
- New `03-frontend/components/search.md`
- New `05-flows/ai-search-flow.md`
- Update existing related docs

## Open questions

- **Date range scope.** Hard schema currently only has `created_after`. Should we add `created_before` + apply `visited_at` when the query implies "I visited X"? Decide per-query via LLM judgment in the prompt.
- **Location resolution.** `hard.city` is a string match. Queries like `"Shoreditch"` (neighbourhood, not city) won't match `places.city = "London"`. Options: (a) keep simple, treat unmatched `city` as a soft hint passed to rerank; (b) add Mapbox geocoding to bbox → lat/lng filter. Lean toward (a) for Phase 6, (b) for a follow-up.
- **TOP_N = 50.** Empirical. Test with real collection sizes.
- **Score threshold 0.3.** Likely needs tuning post-launch.
- **Cache parse-query.** Same query within 5 min shouldn't re-call. React Query handles this naturally with `queryKey: ["ai", "parse-query", query]`.

## Acceptance criteria

- [ ] `"cozy cafes in Shoreditch for remote work"` → ranked list in < 3s, with applied filter chips.
- [ ] `"all my cafes"` skips rerank, feels snappy.
- [ ] Filter chips reflect what AI mapped; individually removable.
- [ ] `ai_features_enabled = false` hides input.
- [ ] Both SKUs visible in cost tracker.
- [ ] Zero-result and rerank-failure paths have clear recovery hints.

---

**Status:** Draft for review. Implementation starts with Slice A.
