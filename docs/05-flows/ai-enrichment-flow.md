---
title: AI Enrichment Flow
type: flow
domain: places
version: 1.0.0
last_updated: 20.05.2026
status: stable
sources:
  - src/app/api/places/[id]/enrich/route.ts
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
| 4 · Reviews | up to 50 reviews via DataForSEO `cid` lookup | `enrich?step=reviews` · `bulk-enrich-reviews` | — |
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
  [[full-profile-flow]] for the chain + the auto-apply matrix.
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
are gated by a per-user daily cap: `checkAiDailyCap` in
`src/lib/ai/track-usage.ts`, `AI_DAILY_CALL_CAP = 3000` AI calls per user
per day. Over the cap, the route returns **429** instead of calling Gemini.

- It is **runaway-bug insurance**, not a billing gate — it sits ~3× above a
  realistic heavy day (one full backfill of a large library ≈ 800-1000
  calls) and far below a runaway loop (10k+ calls).
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
| Under daily cost cap | not needed | required (else 429) |

## Failure modes

- **`ai_features_enabled = false`** → no lite profile, no full profile. The
  place still works; it just carries no AI data.
- **No reviews** → `step=profile` returns 400 `no_reviews`. Places saved
  without a `cid` cannot fetch reviews at all — see the grandfather-account
  limitation in [[../06-ops/runbooks/profile-backfill]].
- **Daily cap exceeded** → 429; covered above.
- **LLM throws / invalid JSON** → `step=profile` 500; `place_profile`
  stays `lite` or absent. Re-runnable — idempotent, see [[full-profile-flow]].
- **Thin profile** → a place with very few reviews (≤5) still profiles, but
  weakly. Deferred issue — see [[../_plans/backfill-grandfather-reenrich]].

## Related code

- `src/app/api/places/[id]/enrich/route.ts` — the cascade (`step=info|reviews|profile`).
- `src/lib/ai/track-usage.ts` — `trackAiUsage`, `checkAiDailyCap`, `AI_DAILY_CALL_CAP`.
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
