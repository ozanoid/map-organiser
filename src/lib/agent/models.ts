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

/** The model new conversations start on. Provisional until the eval picks
 *  one; a conversation keeps the model it started with. */
export const DEFAULT_AGENT_MODEL: AgentModelId = "claude-opus-5-5";

export function isAgentModel(id: string): id is AgentModelId {
  return Object.hasOwn(AGENT_MODELS, id);
}

/** Output cap per model call — thinking, text and tool input together. A
 *  call that needs more is cut off (stop reason max_tokens). */
export const MAX_TOKENS = 16_000;

/** Model calls per user turn. Each tool round is one call. */
export const MAX_STEPS = 10;

/** Server-side refusal fallback: a request the model's safety classifiers
 *  decline is re-run on the model Anthropic recommends for that category,
 *  inside the same call (Opus 5.5 → Opus 5 / Opus 4.8; Sonnet 5.5 → Sonnet 5). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
