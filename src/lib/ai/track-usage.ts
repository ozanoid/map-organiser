import "server-only";

/**
 * AI SKU registry. Pricing in USD per 1k calls (approximate).
 *
 * The Gemini features' usage counters — all of them history since v1.54.0:
 * every AI call is a Claude call now, priced into the agent's ledger
 * (assistant_spend, src/lib/agent/spend.ts) under one monthly cap. Nothing
 * writes these SKUs any more (trackAiUsage, checkAiBudget and the per-user
 * budgets went with the last Gemini route); they stay so the cost tracker
 * can show the months that have rows (`retired`).
 *
 * Model: gemini-3-flash-preview (since 15.07.2026). Verified rates
 * (ai.google.dev pricing, standard tier):
 *   - $0.50 / 1M input tokens (text)
 *   - $3.00 / 1M output tokens
 * Typical AI calls in this app:
 *   - parse_query:   ~500 input + ~150 output   ≈ $0.0007/call → $0.70 / 1k
 *   - rank_results:  ~30k input + ~1.5k output  ≈ $0.020/call  → $20.00 / 1k
 *   - place_profile: ~10k input + ~1.5k output  ≈ $0.0095/call → $9.50 / 1k
 *   - embedding:     unused placeholder
 *
 * Values are stored in api_usage.cost_per_1k and consumed by CostTracker UI.
 */
export const AI_SKU_CONFIG = {
  ai_parse_query: {
    name: "AI Parse Query",
    costPer1k: 0.7,
    freeMonthly: 0,
    retired: true,
  },
  ai_rank_results: {
    name: "AI Rank Results",
    costPer1k: 20.0,
    freeMonthly: 0,
    retired: true,
  },
  // Gemini profiles until v1.51.0 — nothing writes it now. `retired`: the
  // cost tracker shows it only in a month that still has usage.
  ai_place_profile: {
    name: "AI Place Profile",
    costPer1k: 9.5,
    freeMonthly: 0,
    retired: true,
  },
  ai_embedding: {
    name: "AI Embedding",
    costPer1k: 0,
    freeMonthly: 0,
    retired: true,
  },
  // v1.19.0–v1.51.0: the compare page's Gemini comparison — the assistant
  // answers it since v1.52.0, nothing writes it now.
  ai_compare: {
    name: "AI Compare",
    costPer1k: 9.5,
    freeMonthly: 0,
    retired: true,
  },
  // v1.21.0 (S3 AI-02): one unit = one chat TURN (user message →
  // final assistant text), regardless of how many tool/LLM steps the
  // agent loop takes — mirrors the search precedent. costPer1k is a
  // fixed average-turn estimate (~2-3 Flash steps, ~8k input + ~1.2k
  // output ≈ $0.015/turn); increment_api_usage freezes cost_per_1k at
  // the first daily insert, so per-turn variable cost can't be recorded.
  // The Gemini chat, removed in v1.48.0.
  ai_chat: {
    name: "AI Chat",
    costPer1k: 15.0,
    freeMonthly: 0,
    retired: true,
  },
  // v1.22.0–v1.52.0: one unit = one AI Plan generation on the plan page
  // (Gemini, ≈ $0.012). The assistant plans since v1.53.0; nothing writes it.
  ai_trip_plan: {
    name: "AI Plan",
    costPer1k: 12.0,
    freeMonthly: 0,
    retired: true,
  },
  // Instagram import until v1.51.0 (Gemini) — nothing writes it now. One unit
  // was one post read (~1.2k in / ~0.3k out tokens, low thinking ≈ $0.0015).
  ai_instagram_read: {
    name: "AI Instagram Read",
    costPer1k: 1.5,
    freeMonthly: 0,
    retired: true,
  },
} as const;

export type AiSku = keyof typeof AI_SKU_CONFIG;
