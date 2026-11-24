import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The spend ledger: one assistant_spend row per Claude API call, in dollars
 * at the price of the day. The monthly cap is the sum of this month's rows,
 * across every user — the budget is the platform's.
 *
 * Written with the service role only (users can read their own rows).
 */

/** The platform-wide monthly budget for Claude API calls, in US dollars.
 *  The Anthropic Console's organisation limit is the second, outer line. */
export const MONTHLY_CAP_USD = 100;

/** What a Claude call was for: the assistant's turns, the paid evals, a
 *  place profile, an Instagram post's reading (decision 6.4: one ledger). */
export type SpendPurpose = "chat" | "eval" | "profile" | "instagram";

export interface SpendEntry {
  userId: string;
  conversationId: string | null;
  purpose: SpendPurpose;
  model: string;
  requestId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  costUsd: number;
}

export interface SpendLedger {
  record(entry: SpendEntry): Promise<void>;
  /** Dollars spent since the start of the current month (UTC). */
  monthToDate(now?: Date): Promise<number>;
}

const PAGE = 1000;

export function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export const SPEND_PURPOSES: SpendPurpose[] = ["chat", "profile", "instagram", "eval"];

/** This month's spend per purpose, in US dollars (Settings → usage). */
export async function monthSpendByPurpose(
  admin: SupabaseClient,
  now = new Date()
): Promise<Record<SpendPurpose, number>> {
  const out = Object.fromEntries(SPEND_PURPOSES.map((p) => [p, 0])) as Record<SpendPurpose, number>;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("assistant_spend")
      .select("purpose, cost_usd")
      .gte("created_at", monthStartUtc(now))
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) {
      const purpose = row.purpose as SpendPurpose;
      if (purpose in out) out[purpose] += Number(row.cost_usd);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

export function supabaseSpendLedger(admin: SupabaseClient): SpendLedger {
  return {
    async record(e) {
      const { error } = await admin.from("assistant_spend").insert({
        user_id: e.userId,
        conversation_id: e.conversationId,
        purpose: e.purpose,
        model: e.model,
        request_id: e.requestId,
        input_tokens: e.inputTokens,
        output_tokens: e.outputTokens,
        cache_write_tokens: e.cacheWriteTokens,
        cache_read_tokens: e.cacheReadTokens,
        web_searches: e.webSearches,
        // numeric(12,6): round so the stored amount is the computed one
        cost_usd: Math.round(e.costUsd * 1e6) / 1e6,
      });
      if (error) throw error;
    },

    async monthToDate(now = new Date()) {
      // Summed here: a few hundred rows a month. Paged so the sum is whole
      // whatever the API's row limit.
      let total = 0;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("assistant_spend")
          .select("cost_usd")
          .gte("created_at", monthStartUtc(now))
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data) total += Number(row.cost_usd);
        if (data.length < PAGE) break;
      }
      return total;
    },
  };
}
