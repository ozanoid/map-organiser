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

/**
 * Per-user daily ceiling on AI calls — runaway-bug insurance.
 *
 * Sits well above any legitimate heavy day (one full backfill of a large
 * library + a bulk import + a day of searches is ~800-1000 calls) and far
 * below a runaway loop (10k+ calls). One constant — tune here if real
 * usage ever approaches it. At ~$1/1k for profiles, a runaway is capped
 * at roughly $3-6 of spend before the gate trips.
 */
export const AI_DAILY_CALL_CAP = 3000;

const AI_SKUS = Object.keys(AI_SKU_CONFIG) as AiSku[];

export interface AiCapStatus {
  /** True once today's AI call count has reached the cap. */
  exceeded: boolean;
  /** Today's total AI calls for the user across all AI SKUs. */
  used: number;
  /** The cap that `used` is measured against. */
  cap: number;
}

/**
 * Check a user's AI calls for today (UTC) against AI_DAILY_CALL_CAP.
 *
 * Reads the per-(user, sku, day) counters in api_usage — the same rows
 * trackAiUsage() / increment_api_usage write — and sums the AI SKUs only
 * (DataForSEO / Google SKUs are excluded).
 *
 * Fails OPEN: if the check itself errors (api_usage unreachable), returns
 * exceeded=false. The cap is insurance against a runaway bug, not a hard
 * billing gate — a transient DB blip must never 429 a legitimate request.
 */
export async function checkAiDailyCap(userId: string): Promise<AiCapStatus> {
  try {
    const supabase = await createClient();
    // api_usage.created_at is a DATE written as CURRENT_DATE (UTC) by
    // increment_api_usage; this UTC day string matches it exactly.
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("api_usage")
      .select("count")
      .eq("user_id", userId)
      .eq("created_at", today)
      .in("sku", AI_SKUS);
    if (error) throw error;
    const used = (data ?? []).reduce(
      (sum, row) => sum + (row.count ?? 0),
      0
    );
    return {
      exceeded: used >= AI_DAILY_CALL_CAP,
      used,
      cap: AI_DAILY_CALL_CAP,
    };
  } catch (e) {
    console.error("[AI Cap] check failed — failing open:", e);
    return { exceeded: false, used: 0, cap: AI_DAILY_CALL_CAP };
  }
}
