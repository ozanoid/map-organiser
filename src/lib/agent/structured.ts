import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { startObservation } from "@langfuse/tracing";
import type { z } from "zod";
import { anthropicClient } from "@/lib/agent/client";
import type { Effort } from "@/lib/agent/models";
import { costOfMessage, type CallCost } from "@/lib/agent/pricing";
import type { SpendLedger, SpendPurpose } from "@/lib/agent/spend";
import { log } from "@/lib/telemetry/logger";

/**
 * One Claude call outside the agent loop that answers in a fixed JSON shape
 * (structured outputs) — a place profile, an Instagram post's reading.
 * Priced and written to the same ledger as every other Claude call (Phase 2,
 * decision 6.4), so it counts toward the one monthly cap.
 *
 * Gemini does this work until the 6.2 measurement picks the Claude model
 * (docs/_plans/phase-2-assistant.md); the measurement runs through here.
 */

/** A Claude model and effort for a structured task. */
export interface ClaudeChoice {
  model: "claude-haiku-5-5" | "claude-sonnet-5-5";
  effort: Effort;
}

/** Whose call it is and why — the ledger row. */
export interface SpendContext {
  ledger: SpendLedger;
  userId: string;
  purpose: SpendPurpose;
}

/** The call answered, but not with a usable object. It was still billed
 *  (and recorded). */
export class StructuredCallError extends Error {
  constructor(
    readonly reason: "refusal" | "max_tokens" | "unparsed",
    message: string
  ) {
    super(message);
  }
}

export interface StructuredResult<T> {
  output: T;
  cost: CallCost;
  /** Of the output tokens, the ones spent thinking. */
  thinkingTokens: number;
  ms: number;
}

export async function structuredClaude<S extends z.ZodType>(
  call: {
    choice: ClaudeChoice;
    /** The same for every call of a kind: cached. */
    system: string;
    prompt: string;
    schema: S;
    /** Thinking and the answer together. Up to ~21K stays a plain request
     *  (the SDK wants streaming for anything that may run past 10 minutes). */
    maxTokens: number;
    /** Names the call in logs and traces, e.g. "instagram.read". */
    label: string;
    metadata?: Record<string, string | number | boolean>;
  },
  spend: SpendContext
): Promise<StructuredResult<z.infer<S>>> {
  const { model, effort } = call.choice;
  const generation = startObservation(
    call.label,
    { model, modelParameters: { max_tokens: call.maxTokens, effort } },
    { asType: "generation" }
  );
  const started = Date.now();
  let message;
  try {
    message = await anthropicClient().messages.parse({
      model,
      max_tokens: call.maxTokens,
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.prompt }],
      output_config: { effort, format: zodOutputFormat(call.schema) },
    });
  } catch (e) {
    generation.update({ level: "ERROR", statusMessage: e instanceof Error ? e.message : String(e) }).end();
    throw e;
  }
  const ms = Date.now() - started;

  // Billed whatever the answer: recorded first. A failed write is logged,
  // not thrown — the work goes on, and the log shows what the ledger missed.
  const cost = costOfMessage(message as unknown as Pick<BetaMessage, "model" | "usage">, model);
  await spend.ledger
    .record({
      userId: spend.userId,
      conversationId: null,
      purpose: spend.purpose,
      model: message.model,
      requestId: message._request_id ?? null,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      cacheReadTokens: cost.cacheReadTokens,
      webSearches: 0,
      costUsd: cost.costUsd,
    })
    .catch((e: unknown) =>
      log.error("claude.spend_record_failed", e, { label: call.label, model, costUsd: cost.costUsd })
    );

  const thinkingTokens = message.usage.output_tokens_details?.thinking_tokens ?? 0;
  log.info("claude.structured", {
    label: call.label,
    model: message.model,
    effort,
    stopReason: message.stop_reason,
    inputTokens: cost.inputTokens,
    cacheReadTokens: cost.cacheReadTokens,
    cacheWriteTokens: cost.cacheWriteTokens,
    outputTokens: cost.outputTokens,
    thinkingTokens,
    costUsd: Number(cost.costUsd.toFixed(6)),
    ms,
    ...call.metadata,
  });
  generation
    .update({
      model: message.model,
      usageDetails: {
        input: cost.inputTokens,
        output: cost.outputTokens,
        cache_read_input_tokens: cost.cacheReadTokens,
        cache_creation_input_tokens: cost.cacheWriteTokens,
      },
      costDetails: { total: cost.costUsd },
      metadata: { stopReason: message.stop_reason, thinkingTokens, ...call.metadata },
    })
    .end();

  if (message.stop_reason === "refusal") {
    throw new StructuredCallError("refusal", `${call.label}: declined by the safety classifiers`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new StructuredCallError("max_tokens", `${call.label}: cut off at ${call.maxTokens} tokens`);
  }
  if (message.parsed_output == null) {
    throw new StructuredCallError("unparsed", `${call.label}: the answer didn't match the schema`);
  }
  return { output: message.parsed_output as z.infer<S>, cost, thinkingTokens, ms };
}
