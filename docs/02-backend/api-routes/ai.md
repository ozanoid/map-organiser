---
title: AI routes
type: route-group
domain: backend
version: 1.6.0
last_updated: 16.07.2026
status: stable
sources:
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/lib/ai/schemas/parse-query.ts
  - src/lib/ai/schemas/rank-results.ts
  - src/lib/ai/prompts/parse-query.ts
  - src/lib/ai/prompts/rank-results.ts
  - src/app/api/ai/compare/route.ts
  - src/lib/ai/schemas/compare.ts
  - src/lib/ai/prompts/compare.ts
  - src/app/api/ai/chat/route.ts
  - src/lib/ai/chat-tools.ts
  - src/lib/ai/prompts/chat.ts
related:
  - "[[_README]]"
  - "[[../../01-domain/places]]"
  - "[[../../04-integrations/gemini]]"
  - "[[../../05-flows/ai-search-flow]]"
  - "[[user]]"
---

# AI routes

> **Telemetry (v1.16.0):** both routes wrap their `generateText` call in Langfuse `propagateAttributes` (trace `ai-search`, userId, tags) and flush the Langfuse span batch via `after(flushLangfuse)`. See [[../../05-flows/observability-flow]].

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
| `POST` | `/api/ai/compare` | S2 F-04 (v1.19.0): per-theme winners + occasion picks for 2-4 places from stored profiles |
| `POST` | `/api/ai/chat` | S3 AI-02 (v1.21.0): assistant agent loop — streamText + 7 tools, streaming UIMessage response |

## Shared gating

Every route in this group enforces four gates in order:

1. **Auth.** `supabase.auth.getUser()` must return a user. Otherwise 401.
2. **`profiles.ai_features_enabled = true`.** The master toggle. Otherwise 403.
3. **`GOOGLE_GENERATIVE_AI_API_KEY` env var set.** Otherwise 503.
4. **Monthly budget (kind varies per route: `search` for parse-query, `rank_backstop` for rank-results, `compare` for compare, `chat` for chat).** `checkAiBudget("search")`
   (`src/lib/ai/track-usage.ts`) — 500 searches per calendar month, ONE
   budget unit per search: charged at `parse-query` (every search runs
   exactly one parse). `rank-results` is not budgeted separately — it
   rides on the admitted search; its own gate is a 3× runaway backstop
   (`AI_MONTHLY_RANK_BACKSTOP`) against client-side rerank loops. 429
   before Gemini when spent; fails open on check errors. See
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
| `hard.search` | `string?` | Free-text fallback matching `name/address/notes` + `place_profile.searchable_summary/tldr` (since 15.07.2026). |
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
    searchable_summary: string;     // capped at 3000 chars server-side
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

## `POST /api/ai/compare`

S2 F-04 (v1.19.0). Side-by-side AI comparison of 2-4 saved places.

- **Body:** `{ place_ids: string[] }` — 2-4 UUIDs owned by the user (Zod; dupes collapsed).
- **Gates:** same sequence as the sibling routes (auth → `after(flushLangfuse)` → `ai_features_enabled` → client → **budget `compare`**: SKU `ai_compare`, cap `AI_MONTHLY_COMPARE_CAP = 200`/month → 429).
- **Input to the LLM:** the stored `place_profile`s (pre-digested corpora — ~$0.002/compare), serialized compactly by `buildComparePrompt`; **NOT raw reviews**. Places referenced by INDEX (the v1.8.5 lesson — no UUIDs to the LLM); out-of-range indices dropped after parse.
- **Output:** `{ result: { overall, theme_verdicts[], pick_by_occasion[] }, order: string[], profiledCount }` — `order` echoes prompt-order ids so the client resolves `idx → place` without trusting the LLM.
- **Failure:** LLM error → 502 (budget unit still burned — the call was made).
- **Telemetry:** `propagateAttributes({traceName: "ai-compare"})` + `experimental_telemetry` functionId `ai.compare`; events `ai.compare` / `ai.compare.llm_failed`.
- **Consumer:** `AiCompareCard` on `/places/compare` — deliberate-click only (never auto-fires on page load; each run costs a budget unit).

## `POST /api/ai/chat`

S3 AI-02 v1 (v1.21.0). The assistant agent loop — the group's only STREAMING route (deliberate exception to the "never streamText" rule, amended in [[../../04-integrations/gemini]]).

- **Body:** `{ messages: UIMessage[], sessionId?: string }`. History is client-held (session-only memory — no DB table in v1); the server additionally trims to the last 30 messages.
- **Gates:** same four gates BEFORE the stream starts (auth → `after(flushLangfuse)` → `ai_features_enabled` → client → **budget `chat`**: SKU `ai_chat`, cap `AI_MONTHLY_CHAT_CAP = 200`/month → 429). Mid-stream LLM failures surface as stream error parts, not HTTP statuses.
- **Agent loop:** `streamText` + `stopWhen: stepCountIs(6)` + 7 tools from `src/lib/ai/chat-tools.ts`, all executing under the request's cookie client (RLS = ownership boundary):
  - read-only: `search_places` (shared `queryPlaces()` engine — same JS post-filters as GET /api/places), `get_place_details`, `compare_places` (data-only; the CHAT model verbalises — no nested ai_compare LLM call/unit), `get_stats` (shared `computeUserStats()`).
  - mutating, `needsApproval: true` (v6 built-in approval flow — loop pauses, UI confirm card, `addToolApprovalResponse` resubmits): `add_to_list`, `create_list`, `set_visit_status`.
  - Tool outputs are compact projections (id/name/city/rating/tldr…), never full google_data rows.
- **Budget unit = one user TURN**, charged in `onFinish` only when the last inbound message is a `user` message — an approval-continuation POST (assistant message last) does not burn a second unit. `stopWhen` is the in-turn runaway guard.
- **Response:** `result.toUIMessageStreamResponse()` — UIMessage stream consumed by `useChat`.
- **Telemetry:** `propagateAttributes({traceName: "ai-chat", sessionId})` + functionId `ai.chat`; `sessionId` groups a conversation's turn traces in Langfuse. `export const maxDuration = 120` (multi-step turns; also bounds the flush).
- **Consumer:** `AssistantPanel` (header ✨ launcher) — see [[../../05-flows/ai-chat-flow]].

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
