/**
 * The models the platform's Claude agent runs on, and the per-request limits.
 * Plan: docs/_plans/phase-2-assistant.md.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentModel {
  id: string;
  /** Set explicitly: the models' own defaults differ (Opus 5.5 medium,
   *  Sonnet 5.5 high). Effort is fixed per model, not per request — a change
   *  invalidates the prompt cache of every open conversation. */
  effort: Effort;
}

export const AGENT_MODELS = {
  "claude-opus-5-5": { id: "claude-opus-5-5", effort: "medium" },
  "claude-sonnet-5-5": { id: "claude-sonnet-5-5", effort: "high" },
} as const satisfies Record<string, AgentModel>;

export type AgentModelId = keyof typeof AGENT_MODELS;

/** The model new conversations start on — Sonnet 5.5 at effort high, Ozan's
 *  choice after the eval of 23.11.2026 (docs/_plans/phase-2-assistant.md).
 *  A conversation keeps the model it started with. */
export const DEFAULT_AGENT_MODEL: AgentModelId = "claude-sonnet-5-5";

export function isAgentModel(id: string): id is AgentModelId {
  return Object.hasOwn(AGENT_MODELS, id);
}

/** A Claude model and effort for one-shot structured work (structured.ts). */
export interface ClaudeChoice {
  model: "claude-haiku-5-5" | "claude-sonnet-5-5";
  effort: Effort;
}

/**
 * Who writes place profiles and reads Instagram posts — Ozan's choice after
 * the 6.2 measurement (24.11.2026, docs/_plans/phase-2-assistant.md):
 * profiles by Sonnet 5.5 at medium (97% of quotes word for word in the
 * reviews, ~15 s, ~$0.047 a profile), Instagram reads by Haiku 5.5 at high
 * (0 wrong places on the 35-post set, ~$0.0008 a read).
 */
export const PROFILE_WRITER: ClaudeChoice = { model: "claude-sonnet-5-5", effort: "medium" };
export const INSTAGRAM_READER: ClaudeChoice = { model: "claude-haiku-5-5", effort: "high" };

/** What one profile by PROFILE_WRITER costs on average, in US dollars — the
 *  6.2 measurement (10 places, $0.0466 each). The estimate shown before a
 *  backfill; the ledger records what every call really cost. Measure again
 *  when PROFILE_WRITER changes. */
export const PROFILE_WRITER_AVG_USD = 0.047;

/** Output cap per model call — thinking, text and tool input together. A
 *  call that needs more is cut off (stop reason max_tokens). */
export const MAX_TOKENS = 16_000;

/** Model calls per user turn. Each tool round is one call. */
export const MAX_STEPS = 10;

/** Server-side refusal fallback: a request the model's safety classifiers
 *  decline is re-run on the model Anthropic recommends for that category,
 *  inside the same call (Opus 5.5 → Opus 5 / Opus 4.8; Sonnet 5.5 → Sonnet 5). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
