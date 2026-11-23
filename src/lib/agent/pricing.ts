import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

/**
 * What a Claude API call cost, in US dollars, from the usage the API reports.
 *
 * Prices are per million tokens (MTok), checked on Anthropic's pricing page
 * on 23.11.2026. Each spend row stores the dollar amount computed at the
 * time, so a later price change here doesn't rewrite history.
 *
 * Listed: the models the agent runs on and the models a refusal can fall
 * back to. A model not listed is charged at the highest listed price of
 * each kind (and logged by the caller) — the budget errs high, never low.
 */

interface Price {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  // Refusal fallbacks
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
};

/** Web search: $10 per 1,000 searches; a failed search isn't billed. */
export const WEB_SEARCH_USD = 0.01;

const HIGHEST: Price = {
  input: Math.max(...Object.values(PRICES).map((p) => p.input)),
  cacheWrite5m: Math.max(...Object.values(PRICES).map((p) => p.cacheWrite5m)),
  cacheWrite1h: Math.max(...Object.values(PRICES).map((p) => p.cacheWrite1h)),
  cacheRead: Math.max(...Object.values(PRICES).map((p) => p.cacheRead)),
  output: Math.max(...Object.values(PRICES).map((p) => p.output)),
};

/** The price of a model id; dated ids ("claude-opus-5-20261001") match
 *  their base, the longest base winning ("claude-opus-5-5" over "claude-opus-5"). */
function priceOf(model: string): Price | null {
  let best: string | null = null;
  for (const key of Object.keys(PRICES)) {
    if ((model === key || model.startsWith(`${key}-`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : null;
}

export function isPriced(model: string): boolean {
  return priceOf(model) !== null;
}

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
}

export interface CallCost {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  /** Models that ran and aren't in the price list (charged at the highest). */
  unpricedModels: string[];
}

/**
 * The cost of one call. `usage.iterations`, when present, is the per-attempt
 * billing record — a server tool loop's sampling rounds, and with a refusal
 * fallback both the declined attempt and the fallback's, each at its own
 * model's price; the top-level usage covers only the attempt that produced
 * the message. Without iterations the top-level usage is the whole call.
 */
export function costOfMessage(message: Pick<BetaMessage, "model" | "usage">): CallCost {
  const usage = message.usage;
  const entries: { model: string; tokens: TokenCounts }[] = usage.iterations?.length
    ? usage.iterations.map((entry) => ({
        model: ("model" in entry && entry.model) || message.model,
        tokens: entry,
      }))
    : [{ model: message.model, tokens: usage }];

  const out: CallCost = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    unpricedModels: [],
  };
  for (const { model, tokens } of entries) {
    const price = priceOf(model);
    if (!price && !out.unpricedModels.includes(model)) out.unpricedModels.push(model);
    const p = price ?? HIGHEST;
    const write1h = tokens.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const write5m = tokens.cache_creation
      ? tokens.cache_creation.ephemeral_5m_input_tokens
      : (tokens.cache_creation_input_tokens ?? 0);
    const read = tokens.cache_read_input_tokens ?? 0;
    out.costUsd +=
      (tokens.input_tokens * p.input +
        write5m * p.cacheWrite5m +
        write1h * p.cacheWrite1h +
        read * p.cacheRead +
        tokens.output_tokens * p.output) /
      1_000_000;
    out.inputTokens += tokens.input_tokens;
    out.outputTokens += tokens.output_tokens;
    out.cacheWriteTokens += write5m + write1h;
    out.cacheReadTokens += read;
  }
  out.costUsd += out.webSearches * WEB_SEARCH_USD;
  return out;
}
