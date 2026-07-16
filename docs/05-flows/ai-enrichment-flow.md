---
title: AI Enrichment Flow
type: flow
domain: places
version: 1.5.0
last_updated: 16.07.2026
status: stable
sources:
  - src/app/api/places/[id]/enrich/route.ts
  - src/lib/ai/generate-profile.ts
  - src/lib/places/refresh-google-data.ts
  - src/lib/dataforseo/transform.ts
  - src/lib/ai/track-usage.ts
related:
  - "[[lite-profile-flow]]"
  - "[[full-profile-flow]]"
  - "[[manual-place-create-flow]]"
  - "[[place-import-flow]]"
  - "[[ai-search-flow]]"
  - "[[../06-ops/runbooks/profile-backfill]]"
  - "[[../04-integrations/gemini]]"
  - "[[../04-integrations/dataforseo]]"
---

# AI Enrichment Flow

> **Bug fix (v1.15.1, 15.07.2026):** `.map(compactReview)` was passing the array INDEX as `compactReview`'s `maxChars` param — review *i* was truncated to *i* characters, so every full profile generated since Phase 4 (19.05.2026) was built from near-empty review text (all 451 profiles affected; the LLM leaned on place_topics/attributes/lite-prior and fabricated the rest, including evidence quotes). Fixed to `.map((r) => compactReview(r))`; all affected profiles need regeneration — see v4 PART 4 #8.

> **Telemetry (v1.16.0):** `generatePlaceProfile` carries `experimental_telemetry` (span `ai.generate-profile`, userId+placeId metadata); the enrich route stamps Langfuse trace fields (`place-profile`) and flushes via `after(flushLangfuse)`. See [[observability-flow]].

> The map of how a saved place accretes AI data. Every place starts as a
> bare row; enrichment layers extended data, reviews, and AI profiles onto
> `google_data` over time. This doc is the **overview** — each layer has
> its own detailed flow doc, linked below.

## The enrichment ladder

A place's `google_data` is built up in layers. Each layer is a
precondition for the next:

| Layer | What it adds | Written by | `place_profile.completeness` |
|---|---|---|---|
| 1 · Base | name, address, coords, `google_place_id` | initial fetch (`parse-link` / `import-parse`) | — |
| 2 · Extended | hours, photos, `cid`, attributes, topics, `rating_distribution` | `enrich?step=info` · `import-batch` biz-info | — |
| 3 · Lite profile | rule-based category signals + features, **no LLM** | `buildLiteProfile` (in `parse-link`) | `lite` |
| 4 · Reviews | reviews via DataForSEO `cid` lookup — each fetch ≤50, **merged** into a corpus of up to 200 (`mergeReviews`) | `enrich?step=reviews` · `bulk-enrich-reviews` · `refresh-google-data` | — |
| 5 · Full profile | Gemini `place_profile`: tldr / pros / cons / theme_insights / refined features / suggested tags | `enrich?step=profile` | `full` |

Layers **3** and **5** are the AI layers. Layer 3 is rule-based — free and
instant. Layer 5 is the LLM call, and it needs layer 4 (reviews feed the
prompt). The full `place_profile` is the pivot data layer every downstream
AI feature reads — see [[ai-search-flow]].

## The cascade — `enrich?step=…`

`POST /api/places/[id]/enrich?step=info|reviews|profile` is the shared
enrichment engine. The three steps run in sequence:

```
step=info     DataForSEO biz-info + photo + extended data   (~3-4 s, awaited)
   │
   ▼
step=reviews  reviews via cid, depth 50                      (~30 s, fire-and-forget)
   │  on success, if ai_features_enabled →
   ▼
step=profile  Gemini Flash → full place_profile              (~5 s)
              auto-apply tags/sub-cats + moderation queue
```

- `step=reviews` **chains** into `step=profile` on success — see
  [[full-profile-flow]] for the chain + the auto-apply matrix. Since
  15.07.2026 `refresh-google-data` chains the same way, so a manual review
  refresh also regenerates the profile.
- `step=info` and `step=reviews` are DataForSEO calls. Only `step=profile`
  is an LLM call.
- DataForSEO-sourced places already carry extended data + `cid` from save
  time, so they skip `step=info` and go straight to `step=reviews`.

## Entry points — who runs which steps

The cascade is the same everywhere; **what differs is how much of it runs
automatically.** This asymmetry is the thing to know:

| Entry point | Lite (3) | Reviews (4) | Full profile (5) | Detail |
|---|---|---|---|---|
| **Manual create** — paste a Maps URL | ✅ inline in `parse-link` | ✅ `step=reviews` auto | ✅ chained auto | [[manual-place-create-flow]] |
| **Bulk import** — Takeout file | ❌ `import-batch` skips lite | ✅ `bulk-enrich-reviews` (background) | ❌ **not automatic** | [[place-import-flow]] |
| **Backfill** — Settings → AI / import done screen | — | ✅ if missing | ✅ that's the point | [[../06-ops/runbooks/profile-backfill]] |
| **Refresh cron** — daily, stalest ≤14 places of OPT-IN users (`cron_refresh_enabled`, default off) | — | ✅ newest, merged (relevant in Jan/Jul → backbone rebuild) | ✅ only past >15 new reviews | [[../06-ops/runbooks/periodic-refresh]] |

**The gap:** a bulk-imported place gets reviews but **no full profile** —
`bulk-enrich-reviews` does not chain to `step=profile` (unlike the manual
`step=reviews`). The AI profile backfill closes it: the shared
`BackfillProfilesPanel` runs `step=profile` for those places, and as of
v1.10.2 it is surfaced right on the import done screen — see
[[place-import-flow]] step 9.

A manually-created place, by contrast, ends fully enriched on its own:
lite profile at save time, full profile in the background minutes later.

## Cost cap

`step=profile` — and the AI-search routes `parse-query` / `rank-results` —
are gated by TWO per-user monthly budgets (`checkAiBudget` in
`src/lib/ai/track-usage.ts`; calendar month UTC, resets on the 1st;
introduced 15.07.2026 after the Gemini 3 price verification — searches
dominate cost):

- **SEARCH — `AI_MONTHLY_SEARCH_CAP = 500` searches.** One search burns
  ONE budget unit regardless of LLM call count: the unit is charged at
  `parse-query` (every search runs exactly one parse); `rank-results`
  rides free — its own 3× ceiling (`AI_MONTHLY_RANK_BACKSTOP`) exists
  only to stop a client-side rerank-loop bug. Ceiling ≈ $10.5/month.
- **COMPARE — `AI_MONTHLY_COMPARE_CAP = 200` runs** (v1.19.0, S2 F-04).
  One unit per `/api/ai/compare` request (SKU `ai_compare`); deliberate-click
  only from the compare page, never auto-fired.
- **CHAT — `AI_MONTHLY_CHAT_CAP = 200` turns** (v1.21.0, S3 AI-02, SKU
  `ai_chat`). One unit per user TURN charged in the chat route's
  `onFinish` — an approval-continuation POST is free; `stopWhen:
  stepCountIs(6)` bounds in-turn LLM fan-out. See
  [[ai-chat-flow]].
- **PROFILE — `AI_MONTHLY_PROFILE_CAP = 1000` generations.** Covers the
  add-place chain, manual refresh chain, backfill, and the cron sweep
  together. Ceiling ≈ $9.5/month. A full ~470-place backfill fits within
  a single month alongside normal usage.

Both fail open (a tracking outage must never 429 a legitimate request).
- It **fails open**: if the cap check itself errors, the request proceeds.
  A tracking-table outage must never 429 a legitimate request.
- `step=info` / `step=reviews` are **not** capped — they are DataForSEO,
  not AI. The cap sums only the AI SKUs in `api_usage`.
- **Visibility**: AI search surfaces the 429 as a toast (the route's error
  message is the toast text). A capped `step=profile` dispatched
  fire-and-forget by the backfill is swallowed silently — but one backfill
  panel session tops out at ~1250 calls, well under the cap, so this is a
  rare edge.

## Gating — preconditions for the AI layers

Both AI layers are gated. A place skips them silently when a gate fails:

| Gate | Layer 3 (lite) | Layer 5 (full) |
|---|---|---|
| `profiles.ai_features_enabled` | required | required |
| `GOOGLE_GENERATIVE_AI_API_KEY` set | not needed (no LLM) | required (else 503) |
| Reviews present | not needed | required (else 400 `no_reviews`) |
| Under the monthly profile budget | not needed | required (else 429) |

## Failure modes

- **`ai_features_enabled = false`** → no lite profile, no full profile. The
  place still works; it just carries no AI data.
- **No reviews** → `step=profile` returns 400 `no_reviews`. Places saved
  without a `cid` cannot fetch reviews at all — see the grandfather-account
  limitation in [[../06-ops/runbooks/profile-backfill]].
- **Monthly budget exceeded** → 429; covered above.
- **LLM throws / invalid JSON** → `step=profile` 500; `place_profile`
  stays `lite` or absent. Re-runnable — idempotent, see [[full-profile-flow]].
- **Thin profile** → a place with very few reviews (≤5) still profiles, but
  weakly. Deferred issue — see [[../_plans/backfill-grandfather-reenrich]].

## Related code

- `src/app/api/places/[id]/enrich/route.ts` — the cascade (`step=info|reviews|profile`).
- `src/lib/ai/track-usage.ts` — `trackAiUsage`, `checkAiBudget`, `AI_MONTHLY_SEARCH_CAP` / `AI_MONTHLY_PROFILE_CAP` / `AI_MONTHLY_COMPARE_CAP`.
- `src/lib/ai/extract/lite-profile.ts` — `buildLiteProfile` (layer 3). See [[lite-profile-flow]].
- `src/lib/ai/prompts/place-profile-full.ts`, `src/lib/ai/apply-suggestions.ts` — layer 5. See [[full-profile-flow]].
- `src/app/api/places/import-batch/route.ts`, `src/app/api/places/bulk-enrich-reviews/route.ts` — bulk import path.
- `src/app/api/user/backfill-profiles/route.ts` — backfill dispatcher.

## Related docs

- [[lite-profile-flow]] — layer 3 detail (rule-based extraction).
- [[full-profile-flow]] — layer 5 detail (Gemini call, auto-apply, moderation).
- [[manual-place-create-flow]] — the auto-cascade entry point.
- [[place-import-flow]] — the bulk entry point + the backfill panel.
- [[ai-search-flow]] — consumes the `place_profile` this flow produces.
- [[../06-ops/runbooks/profile-backfill]] — the backfill, ops view.
