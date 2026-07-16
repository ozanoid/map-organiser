import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * AI SKU registry. Pricing in USD per 1k calls (approximate).
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
  },
  ai_rank_results: {
    name: "AI Rank Results",
    costPer1k: 20.0,
    freeMonthly: 0,
  },
  ai_place_profile: {
    name: "AI Place Profile",
    costPer1k: 9.5,
    freeMonthly: 0,
  },
  ai_embedding: {
    name: "AI Embedding",
    costPer1k: 0,
    freeMonthly: 0,
  },
  // v1.19.0 (S2 F-04): side-by-side AI comparison. Input = 2-4 stored
  // place_profiles (~2-6K tokens) + a compact rubric — cost profile is
  // close to ai_place_profile's.
  ai_compare: {
    name: "AI Compare",
    costPer1k: 9.5,
    freeMonthly: 0,
  },
  // v1.21.0 (S3 AI-02): one unit = one chat TURN (user message →
  // final assistant text), regardless of how many tool/LLM steps the
  // agent loop takes — mirrors the search precedent. costPer1k is a
  // fixed average-turn estimate (~2-3 Flash steps, ~8k input + ~1.2k
  // output ≈ $0.015/turn); increment_api_usage freezes cost_per_1k at
  // the first daily insert, so per-turn variable cost can't be recorded.
  ai_chat: {
    name: "AI Chat",
    costPer1k: 15.0,
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
  sku: AiSku,
  client?: SupabaseClient
): Promise<void> {
  try {
    const supabase = client ?? (await createClient());
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
 * Per-user MONTHLY AI budgets — two separate buckets (15.07.2026;
 * replaced the single per-call cap after the Gemini 3 price verification
 * showed searches dominate cost).
 *
 * - SEARCH: 500 searches/month. One search burns ONE budget unit no
 *   matter how many LLM calls it makes — counted via the ai_parse_query
 *   SKU (every search runs exactly one parse; rank re-fires from broaden
 *   toggles are free). Ceiling ≈ 500 × ~$0.021 ≈ $10.5/month.
 * - PROFILE: 1000 place-profile generations/month — covers the add-place
 *   chain, manual refresh chain, backfill, and the cron sweep together.
 *   Ceiling = 1000 × ~$9.5/1k ≈ $9.5/month. A full ~470-place backfill
 *   fits inside a single month.
 * - RANK BACKSTOP: rank_results is already budgeted through the search
 *   bucket at parse time; its own 3× ceiling exists ONLY so a client-side
 *   rerank-loop bug can't bypass the parse gate and run up cost.
 */
export const AI_MONTHLY_SEARCH_CAP = 500;
export const AI_MONTHLY_PROFILE_CAP = 1000;
export const AI_MONTHLY_RANK_BACKSTOP = AI_MONTHLY_SEARCH_CAP * 3;
/** v1.19.0 — hardcoded like its siblings (caps are code constants here,
 *  not env vars; keep the convention). One unit per compare request. */
export const AI_MONTHLY_COMPARE_CAP = 200;
/** v1.21.0 (S3 AI-02) — one unit per chat TURN (charged in the route's
 *  onFinish; an approval-continuation POST does NOT burn a second unit).
 *  The stopWhen step ceiling in the chat route bounds per-turn fan-out. */
export const AI_MONTHLY_CHAT_CAP = 200;

export type AiBudgetKind =
  | "search"
  | "profile"
  | "rank_backstop"
  | "compare"
  | "chat";

const BUDGETS: Record<AiBudgetKind, { sku: AiSku; cap: number }> = {
  search: { sku: "ai_parse_query", cap: AI_MONTHLY_SEARCH_CAP },
  profile: { sku: "ai_place_profile", cap: AI_MONTHLY_PROFILE_CAP },
  rank_backstop: { sku: "ai_rank_results", cap: AI_MONTHLY_RANK_BACKSTOP },
  compare: { sku: "ai_compare", cap: AI_MONTHLY_COMPARE_CAP },
  chat: { sku: "ai_chat", cap: AI_MONTHLY_CHAT_CAP },
};

export interface AiCapStatus {
  /** True once this month's AI call count has reached the cap. */
  exceeded: boolean;
  /** This calendar month's total AI calls for the user across all AI SKUs. */
  used: number;
  /** The cap that `used` is measured against. */
  cap: number;
}

/**
 * Check one of the user's monthly AI budgets (calendar month, UTC —
 * resets naturally on the 1st).
 *
 * Reads the per-(user, sku, day) counters in api_usage — the same rows
 * trackAiUsage() / increment_api_usage write — summing only the SKU that
 * backs the requested budget (see BUDGETS).
 *
 * Fails OPEN: if the check itself errors (api_usage unreachable), returns
 * exceeded=false. The budget is a spend guard, not a hard billing gate —
 * a transient DB blip must never 429 a legitimate request.
 */
export async function checkAiBudget(
  kind: AiBudgetKind,
  userId: string,
  client?: SupabaseClient
): Promise<AiCapStatus> {
  const budget = BUDGETS[kind];
  try {
    const supabase = client ?? (await createClient());
    // api_usage.created_at is a DATE (UTC) — month window via >= YYYY-MM-01.
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1
    ).padStart(2, "0")}-01`;
    const { data, error } = await supabase
      .from("api_usage")
      .select("count")
      .eq("user_id", userId)
      .gte("created_at", monthStart)
      .eq("sku", budget.sku);
    if (error) throw error;
    const used = (data ?? []).reduce(
      (sum, row) => sum + (row.count ?? 0),
      0
    );
    return {
      exceeded: used >= budget.cap,
      used,
      cap: budget.cap,
    };
  } catch (e) {
    console.error(`[AI Budget:${kind}] check failed — failing open:`, e);
    return { exceeded: false, used: 0, cap: budget.cap };
  }
}
