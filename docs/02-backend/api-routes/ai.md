---
title: AI routes
type: route-group
domain: backend
version: 1.2.0
last_updated: 20.05.2026
status: stable
sources:
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/lib/ai/schemas/parse-query.ts
  - src/lib/ai/schemas/rank-results.ts
  - src/lib/ai/prompts/parse-query.ts
  - src/lib/ai/prompts/rank-results.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/places]]"
  - "[[../../04-integrations/gemini]]"
  - "[[../../05-flows/ai-search-flow]]"
  - "[[user]]"
---

# AI routes

Routes that call Gemini Flash directly from the request handler (not via
the enrich background chain). Shipped in Phase 6 to support the AI-01
natural-language filtering feature.

A separate route group from `places/[id]/enrich?step=profile` (the Phase
4 chained call) because these are **user-initiated, latency-sensitive,
read-only** calls — they don't write to the DB, they don't fan out
into background jobs.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/ai/parse-query` | Parse a free-form NL query into structured filters + semantic intent |
| `POST` | `/api/ai/rank-results` | LLM-as-judge rerank for queries with fuzzy semantic intent |

## Shared gating

Every route in this group enforces four gates in order:

1. **Auth.** `supabase.auth.getUser()` must return a user. Otherwise 401.
2. **`profiles.ai_features_enabled = true`.** The master toggle. Otherwise 403.
3. **`GOOGLE_GENERATIVE_AI_API_KEY` env var set.** Otherwise 503.
4. **Daily cost cap.** `checkAiDailyCap` (`src/lib/ai/track-usage.ts`) —
   when the user's AI calls today have hit `AI_DAILY_CALL_CAP` (3000), the
   route returns **429** before calling Gemini. Runaway-bug insurance;
   fails open if the check itself errors. See
   [[../../05-flows/ai-enrichment-flow#cost-cap]].

When any gate fails the client falls back gracefully — the frontend
hides the AI search input entirely when the toggle is off, so 403s
shouldn't surface in normal use. A 429 surfaces as a toast on the AI
search input.

## `POST /api/ai/parse-query`

Turn natural-language input into the three-layer match spec.

**Body**
```ts
{ query: string }   // ≤ 200 chars, trimmed
```

**Returns** — `ParseQueryOutput` (see `src/lib/ai/schemas/parse-query.ts`):

| Field | Type | Notes |
|---|---|---|
| `hard.category_ids` | `uuid[]?` | Must be IDs from the user's context. Sanitized server-side. |
| `hard.subcategory_ids` | `uuid[]?` | Same. |
| `hard.tag_ids` | `uuid[]?` | Same. |
| `hard.list_id` | `uuid?` | Same. |
| `hard.city` / `country` | `string?` | Matched 1:1 to `places.city/country`. Neighborhoods stay in `semantic_intent`. |
| `hard.visit_status` | enum? | `want_to_go` / `booked` / `visited` / `favorite` |
| `hard.rating_min` / `google_rating_min` | `number?` | 1-5 |
| `hard.created_after` | ISO date? | Resolved from phrases like "last week", "in May". |
| `hard.search` | `string?` | Free-text fallback matching `name/address/notes`. |
| `soft_features.atmosphere` | `string[]?` | Matched against `place_profile.features.atmosphere`. |
| `soft_features.dietary` | `string[]?` | Same for `.dietary`. |
| `soft_features.occasions` | `string[]?` | Same for `.occasions`. |
| `soft_features.seating` | `string[]?` | Same for `.seating`. |
| `soft_features.cuisine_types` | `string[]?` | Same for `.cuisine_types`. |
| `boosts.matching_tag_ids` | `uuid[]?` | **Soft signal, NOT a filter.** Tags the LLM semantically associates with the query — passed to rank-results for score upweighting. Surfaced as opt-in UI hint chips. |
| `boosts.matching_list_ids` | `uuid[]?` | Same shape, for lists. |
| `boosts.matching_subcategory_ids` | `uuid[]?` | Same shape, for sub-categories the LLM associates but didn't filter. |
| `semantic_intent` | `string` | Clean English restatement. Used by rank-results. |
| `requires_semantic_ranking` | `bool` | **Set by the LLM**, not by candidate count. Always true for "best", "good", "recommend", "find" phrasing. |
| `needs_clarification` | `string \| null` | Short follow-up question when query is genuinely ambiguous. |

**Why `boosts` exists.** Filtering by user-curated tags/lists for a
semantic query like *"best date restaurants"* self-defeats discovery —
the result would only contain places the user has ALREADY tagged
"Date Spot", which is exactly what they're trying to find more of.
Boosts let the LLM signal "this tag is thematically relevant" without
removing un-tagged candidates from the set; rank-results then upweights
matches by +0.15.

**Defense in depth.** Even though the prompt forbids made-up IDs, the
route re-validates ALL `category_ids / subcategory_ids / tag_ids /
list_id / matching_*_ids` against the user's context
(`buildUserContext`) and strips unknowns before returning. Empty
arrays collapse to `undefined`.

**SKU:** `ai_parse_query` — ~$0.0001/call (~500 input + ~150 output
tokens against Gemini Flash). Tracked via `trackAiUsage`.

## `POST /api/ai/rank-results`

LLM-as-judge ranker. Called only when `parse-query` set
`requires_semantic_ranking: true`. Scores each candidate against the
query's semantic intent using its `place_profile.searchable_summary`.

**Body**
```ts
{
  semantic_intent: string;          // from parse-query
  candidates: {
    id: string;                     // uuid
    name: string;
    searchable_summary: string;     // capped at 1500 chars server-side
    subcategory_id?: string | null; // for sub-cat boost (no extra query)
  }[];                              // 1 ≤ length ≤ 200

  // All three optional. Pass-through from parse-query.boosts.*
  boost_tag_ids?: string[];
  boost_list_ids?: string[];
  boost_subcategory_ids?: string[];
}
```

**Returns** — `RankResultsOutput`:

```ts
{
  ranked: { id: string; score: number; why: string }[];
}
```

Score is in `[0, 1]`:

| Range | Meaning |
|---|---|
| 0.90 – 1.00 | Explicit multi-term match in summary |
| 0.70 – 0.89 | Strong match on main intent terms |
| 0.40 – 0.69 | Partial / implied match |
| 0.10 – 0.39 | Weak / only related |
| 0.00 – 0.09 | No signal or mismatched |

When a candidate has an empty `searchable_summary` (pre-Phase-4 places
without profiles), the LLM falls back to `name` and caps the score at
0.40 — insufficient information to be confident.

`why` is a ≤ 120-char rationale shown under the place name in the UI.

**Cost guards.**
- Server: refuses `candidates.length > 200` with 400. Prevents runaway
  cost from a hypothetical "all places" client bug.
- Client: pre-caps at `TOP_N = 50` (recency pre-sort). Anything past
  that goes into a tail rendered without scores.

**Boost post-processing.** After the LLM returns base scores:
- **Sub-cat boost** — checked in-memory against each candidate's
  `subcategory_id`. No Supabase call.
- **Tag boost** — single query against `place_tags WHERE tag_id IN
  (boost_tag_ids) AND place_id IN (candidate_ids)`. RLS scopes by user.
- **List boost** — same pattern against `list_places`.

Boosted candidates get `score = min(1, score + 0.15)`. The delta is
empirical: 0.15 lifts a borderline 0.5 match comfortably past an
un-boosted 0.6, but doesn't override a strong 0.85+ match.

**Defense in depth.** Output `ranked[].id` values not in the input are
stripped before returning.

**SKU:** `ai_rank_results` — ~$0.002/call at 50 candidates (~25K input
+ ~1.5K output tokens).

## Common helpers

| Helper | What |
|---|---|
| `getAiClient()` (`src/lib/ai/client.ts`) | Lazy Gemini Flash client. Returns `null` if env missing. |
| `buildUserContext()` (`src/lib/ai/context-builder.ts`) | Bundles user's tags/categories/sub-cats/lists/cities/countries for prompt injection. |
| `serializeUserContext()` | Token-efficient string format consumed by both prompt builders. |
| `trackAiUsage(userId, sku)` | UPSERTs `api_usage` for cost accounting. Failures are swallowed. |

## See also

- [[../../05-flows/ai-search-flow]] — end-to-end NL search flow
- [[../../04-integrations/gemini]] — provider details (direct, not Gateway)
- [[user#PUT-ai-settings]] — the master toggle these routes check
- [[../../01-domain/places#google_data.place_profile-shape]] — the `searchable_summary` field rank-results consumes
