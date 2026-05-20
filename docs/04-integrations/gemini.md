---
title: Google Gemini (LLM)
type: integration
domain: integrations
version: 1.2.0
last_updated: 20.05.2026
status: stable
sources:
  - src/lib/ai/client.ts
  - src/lib/ai/prompts/place-profile-full.ts
  - src/lib/ai/schemas/place-profile.ts
  - src/lib/ai/apply-suggestions.ts
  - src/app/api/places/[id]/enrich/route.ts
related:
  - "[[_README]]"
  - "[[../00-overview/tech-stack#ai]]"
  - "[[../02-backend/schema/ai_suggestions_queue]]"
  - "[[../05-flows/full-profile-flow]]"
  - "[[../05-flows/lite-profile-flow]]"
  - "[[../06-ops/env-vars]]"
---

# Google Gemini

The LLM provider behind the AI features added across PRs #30–#35 (Phases 1–5.5). Model: **`gemini-flash-latest`** (Gemini 2.5 Flash family at the time of writing). Accessed through Vercel's AI SDK v6 with the Google provider — **direct provider wiring**, not via the Vercel AI Gateway (deliberate; see "Why direct, not Gateway?" below).

## Account & access

- **Provider:** Google AI Studio (Generative Language API).
- **Auth:** API key. Server-only. Env var: `GOOGLE_GENERATIVE_AI_API_KEY`.
- **Key rotation:** Studio → Keys → revoke + reissue → update Vercel env + local `.env.local`. See [[../06-ops/env-vars]].

## NPM packages

| Package | Version | Role |
|---|---|---|
| `ai` | `^6.0.182` | AI SDK v6 — provider-agnostic call layer. We use `generateText` + `Output.object` for structured JSON; never `streamText`. |
| `@ai-sdk/google` | `^3.0.73` | Google provider plugin. Exports `createGoogleGenerativeAI`. |

## Env vars

| Variable | Scope | Used in |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | **server-only** | `src/lib/ai/client.ts#getAiClient()` (lazy singleton). When missing, every AI route short-circuits with a 503-style fail-soft response and the Settings AI toggle shows the "not configured" banner. |

## Wiring (one place)

```ts
// src/lib/ai/client.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;

export function getAiClient() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  if (!_google) {
    _google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
  return _google;
}

export const FLASH_MODEL = "gemini-flash-latest";
export const MODEL_VERSION = "gemini-flash-latest";
```

Every consumer goes through `getAiClient()` so the env check and singleton creation live in one place. `MODEL_VERSION` is stamped onto `places.google_data.place_profile.model_version` for cache-invalidation reasoning.

## How we call it (canonical pattern)

```ts
import { generateText, Output } from "ai";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { PlaceProfileSchema } from "@/lib/ai/schemas/place-profile";

const client = getAiClient();
if (!client) {
  return NextResponse.json(
    { ok: false, reason: "ai_disabled" },
    { status: 503 }
  );
}

const { output } = await generateText({
  model: client(FLASH_MODEL),
  output: Output.object({ schema: PlaceProfileSchema }),
  system: systemPrompt,
  prompt: userPrompt,
});
// `output` is now typed as `PlaceProfile` via Zod inference.
```

The output is Zod-validated at the SDK boundary, so route code can treat it as a typed object. We then **force-stamp** meta fields the LLM might fabricate (`completeness`, `model_version`, `source_review_count`) before persisting.

## Where it's called

| Caller | Purpose | Frequency | Avg latency | SKU |
|---|---|---|---|---|
| `POST /api/places/[id]/enrich?step=profile` | Full place_profile generation. Triggered by the `step=reviews` fire-and-forget chain (Phase 4) or the manual refresh/generate button in `AiSummaryCard`. | Once per place, plus opt-in refresh | ~4–6 s | `ai_place_profile` |
| `POST /api/ai/parse-query` (Phase 6) | Parse NL search query into structured filters + semantic intent. | Per user-submitted query | ~700 ms – 1.5 s | `ai_parse_query` |
| `POST /api/ai/rank-results` (Phase 6) | LLM-as-judge rerank against `place_profile.searchable_summary` when `requires_semantic_ranking` is set. | Conditional — only when the query has fuzzy intent | ~1–2 s | `ai_rank_results` |

Phase 6 splits AI calls into two groups by behaviour: **background** (`enrich?step=profile` — fire-and-forget, latency-tolerant) and **interactive** (`/api/ai/*` — user is waiting). Both share `getAiClient()` / `FLASH_MODEL` / Output.object pattern; they differ only in error handling and observability expectations.

## Cost & limits

Gemini Flash latest pricing (~mid-2026, verify against current rates):

- Input: **\$0.075 / 1M tokens**
- Output: **\$0.30 / 1M tokens**

Per `step=profile` call:

- Input: ~6–7K tokens (user context + 50 reviews × 400 chars + system prompt) → ~\$0.0005
- Output: ~1–2K tokens (PlaceProfile JSON) → ~\$0.0005
- **Total: ~\$0.001 per place_profile**, or ~\$1 per 1000 — the value used in `AI_SKU_CONFIG.ai_place_profile.costPer1k`.

Free tier: 15 RPM / 1M TPM (verify in AI Studio). Beyond that, paid quota. At our usage scale (a few hundred profiles + occasional regenerations), the monthly cost stays under \$2.

**Per-user daily cap.** `checkAiDailyCap` (`src/lib/ai/track-usage.ts`) caps each user at `AI_DAILY_CALL_CAP` (3000) AI calls/day across all AI SKUs — `enrich?step=profile`, `parse-query`, `rank-results`. Over the cap the route returns **429** before calling Gemini. It is app-level runaway-bug insurance (~3× a realistic heavy day), fails open, and is unrelated to Gemini's own RPM quota. See [[../05-flows/ai-enrichment-flow#cost-cap]].

## Prompt strategy

`buildPlaceProfilePrompt` in `src/lib/ai/prompts/place-profile-full.ts` builds the call:

- **System prompt** bakes the user's full taxonomy inline — every existing category (name), every sub-category slug grouped by parent, every existing tag (ID + name), every list (ID + name), and the user's cities/countries. The LLM is told to **prefer existing IDs** and only propose new vocabulary when nothing fits.
- **User prompt** ships place metadata (name, address, current_category_name, Google types, DataForSEO attributes, place_topics, rating distribution, price level) + up to 50 reviews, each capped at 400 chars.
- The LLM is also instructed to push back if the current category is wrong: that's how Phase 5.5's category-mismatch detection works without an extra schema field.

The output schema is Zod-strict (`PlaceProfileSchema` in `src/lib/ai/schemas/place-profile.ts`) — any field type mismatch trips the SDK before we touch the DB.

## Why direct, not Gateway?

We hard-wire `@ai-sdk/google` rather than routing through the Vercel AI Gateway (`"google/gemini-flash-latest"` string format) for three reasons specific to this app:

1. **Single provider, single key.** We only call Gemini. The Gateway's killer features — model fallbacks, multi-provider routing, observability across providers — don't pay off when there's exactly one provider.
2. **Cost transparency.** The Gateway adds a flat fee on top of provider pricing. At our \$1-2/month scale that's a meaningful percentage.
3. **Existing observability.** We already track per-call cost in `api_usage` under `ai_*` SKUs, which the Cost Tracker UI surfaces. The Gateway dashboard would be a duplicate signal.

If we ever add a second provider (Claude/OpenAI for ranking, vision, etc.), revisit. The migration is a one-line change — replace `client(FLASH_MODEL)` with the Gateway string format and drop `@ai-sdk/google`.

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| Route returns `{ ok: false, reason: "ai_disabled" }` 503 | `GOOGLE_GENERATIVE_AI_API_KEY` not set | Add the env var in Vercel → redeploy. Settings AI tab also shows the "not configured" banner. |
| Route returns 429 | User hit the daily AI cost cap (`AI_DAILY_CALL_CAP`, 3000/day) | Expected — wait for the UTC-midnight reset. An app-level guard, not a Gemini rate limit. |
| Route returns 500 with "LLM generation failed" | Provider 5xx, rate limit, or schema validation failure | Retry from `AiSummaryCard` refresh button. Persistent failure → check Vercel logs for the underlying error. |
| AI Summary card stays in skeleton state | Reviews not yet present OR profile hasn't been generated (pre-Phase-4 place) | If reviews exist, click "Generate" in the skeleton header. If not, wait for `step=reviews` to finish (~30 s on a fresh paste). |
| Profile generated but tags/sub-cats not applied | `ai_features_enabled = false` on the profile, OR LLM proposed entities outside the 4-band threshold | Toggle AI on in Settings → AI; pending proposals queue up. |

## Open questions

- **Model version pinning.** `gemini-flash-latest` is an alias — Google updates it on their schedule. We capture `model_version` on each profile but a major regression would require a new pin (`gemini-2.5-flash-002` etc.) and a backfill.
- **Phase 6 model choice.** NL filtering may benefit from the larger `gemini-pro` for ambiguous queries. Leave the routing decision to that PR.
- **Rate-limit telemetry.** No alerting on 429s yet — they'd just show up as failed `step=profile` runs in Vercel logs.
