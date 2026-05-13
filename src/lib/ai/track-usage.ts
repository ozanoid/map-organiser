import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * AI SKU registry. Pricing in USD per 1k calls (approximate, May 2026).
 *
 * Gemini Flash latest (gemini-2.5-flash family):
 *   - $0.075 / 1M input tokens
 *   - $0.30 / 1M output tokens
 * Typical AI calls in this app:
 *   - parse_query:   ~500 input + ~150 output  ≈ $0.0001/call → $0.10 / 1k
 *   - rank_results:  ~25k input + ~1k output   ≈ $0.0021/call → $2.10 / 1k
 *   - place_profile: ~5k input + ~2k output    ≈ $0.0010/call → $1.00 / 1k
 *   - embedding:     free tier (text-embedding-004)
 *
 * Values are stored in api_usage.cost_per_1k and consumed by CostTracker UI.
 */
export const AI_SKU_CONFIG = {
  ai_parse_query: {
    name: "AI Parse Query",
    costPer1k: 0.1,
    freeMonthly: 0,
  },
  ai_rank_results: {
    name: "AI Rank Results",
    costPer1k: 2.1,
    freeMonthly: 0,
  },
  ai_place_profile: {
    name: "AI Place Profile",
    costPer1k: 1.0,
    freeMonthly: 0,
  },
  ai_embedding: {
    name: "AI Embedding",
    costPer1k: 0,
    freeMonthly: 0,
  },
} as const;

export type AiSku = keyof typeof AI_SKU_CONFIG;

/**
 * Increment the per-user/per-SKU/per-day counter in api_usage.
 * Mirrors src/lib/google/track-usage.ts but for AI calls.
 *
 * Failures are swallowed (logged, not thrown) so a tracking outage
 * never breaks a user-facing request.
 */
export async function trackAiUsage(
  userId: string,
  sku: AiSku
): Promise<void> {
  try {
    const supabase = await createClient();
    const config = AI_SKU_CONFIG[sku];
    await supabase.rpc("increment_api_usage", {
      p_user_id: userId,
      p_sku: sku,
      p_cost: config.costPer1k,
    });
  } catch (e) {
    console.error("[AI Usage Tracking] Error:", e);
  }
}
