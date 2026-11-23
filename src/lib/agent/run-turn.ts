import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { propagateAttributes, startActiveObservation, startObservation } from "@langfuse/tracing";
import type { AssistantContext } from "@/lib/assistant/library";
import { AgentError, fromAnthropicError } from "@/lib/agent/errors";
import {
  contextBlock,
  echoable,
  pendingToolCalls,
  textOf,
  toolCallsIn,
  toolResult,
  type StoredMessage,
  type ToolCall,
} from "@/lib/agent/history";
import { AGENT_MODELS, FALLBACK_BETA, MAX_STEPS, MAX_TOKENS, isAgentModel, type Effort } from "@/lib/agent/models";
import { costOfMessage, type CallCost } from "@/lib/agent/pricing";
import { systemPromptFor } from "@/lib/agent/prompt";
import { MONTHLY_CAP_USD, type SpendLedger, type SpendPurpose } from "@/lib/agent/spend";
import type { Conversation, ConversationStore, Door } from "@/lib/agent/store";
import { agentToolDefinitions, executeToolCall, needsApproval } from "@/lib/agent/tools";
import { log } from "@/lib/telemetry/logger";

/**
 * The agent loop — one user turn of a conversation: the user's message (or
 * their answer to an approval card) in, Claude's reply out, with every tool
 * round in between. Doors (the app panel today) call this and turn the
 * events into what they show.
 *
 *   - History is append-only (see history.ts); each turn reads the stored
 *     conversation and appends to it.
 *   - A call to a tool that saves something stops the turn: the assistant
 *     message is stored with its calls pending, and the turn resumes when
 *     the user's decision arrives (TurnInput "approval"). Read calls made in
 *     the same message wait with it.
 *   - Every model call is written to the spend ledger; the monthly cap is
 *     checked before a turn starts.
 *
 * Plan: docs/_plans/phase-2-assistant.md.
 */

export type TurnInput =
  | { kind: "message"; text: string; timeZone: string }
  /** Tool-use id → approved. A write call without a decision is declined. */
  | { kind: "approval"; decisions: Record<string, boolean> };

export interface StepInfo {
  step: number;
  /** The model that produced the message (a refusal fallback can differ). */
  model: string;
  stopReason: string | null;
  /** The assistant content as stored; empty for a refusal (not stored). */
  content: BetaContentBlockParam[];
  cost: CallCost;
  ms: number;
}

export interface TurnEvents {
  /** Assistant text as it streams. */
  text?(delta: string): void;
  /** The model call broke off and is being re-run: drop the text streamed
   *  since the step began. */
  stepRetried?(step: number): void;
  /** A model call finished. */
  step?(info: StepInfo): void;
  /** A tool call finished — run, declined or skipped. */
  toolResult?(result: { id: string; name: string; text: string; isError: boolean }): void;
}

export type TurnStatus =
  | "done"
  | "awaiting_approval" // a call that saves something waits for the user's card
  | "refused" // the model (and any fallback) declined; nothing was stored for it
  | "max_tokens" // the reply was cut off at MAX_TOKENS
  | "step_limit"; // MAX_STEPS model calls without an answer

export interface PendingCall extends ToolCall {
  needsApproval: boolean;
}

export interface TurnResult {
  status: TurnStatus;
  steps: number;
  costUsd: number;
  /** When awaiting approval: every call in the paused message. The ones
   *  with needsApproval need a decision; the rest run along with them. */
  pending: PendingCall[];
}

export interface AgentDeps {
  client: Anthropic;
  store: ConversationStore;
  ledger: SpendLedger;
  /** The tools run as this user. */
  toolCtx: AssistantContext;
  purpose: SpendPurpose;
  /** Overrides the model's effort — for the eval. */
  effort?: Effort;
  now?: () => Date;
  signal?: AbortSignal;
}

const NOT_RUN_NEW_MESSAGE = "Not run: the user sent a new message instead of answering the approval card.";
const DECLINED = "The user declined this on the approval card; nothing was saved.";
const STEP_LIMIT =
  "Not run: this turn reached its limit of tool rounds. Tell the user what you have so far and ask whether to continue.";
const CUT_OFF = "Not run: your message was cut off at the length limit before this call was complete.";

/** Starts a conversation: the system prompt and tools it will keep for life. */
export async function startConversation(
  store: ConversationStore,
  init: { userId: string; door: Door; model: string }
): Promise<Conversation> {
  if (!isAgentModel(init.model)) throw new AgentError("rejected", `not an agent model: ${init.model}`);
  return store.create({
    ...init,
    systemPrompt: systemPromptFor(init.door),
    tools: JSON.stringify(agentToolDefinitions()),
  });
}

export async function runTurn(
  deps: AgentDeps,
  conversationId: string,
  input: TurnInput,
  events: TurnEvents = {}
): Promise<TurnResult> {
  return propagateAttributes(
    {
      traceName: "assistant",
      userId: deps.toolCtx.userId,
      sessionId: conversationId,
      tags: ["assistant", deps.purpose],
    },
    () =>
      startActiveObservation(
        "assistant-turn",
        async (agent) => {
          agent.update({ input: input.kind === "message" ? input.text : { approval: input.decisions } });
          try {
            const result = await turn(deps, conversationId, input, events, (text) => agent.update({ output: text }));
            agent.update({ metadata: { status: result.status, steps: result.steps, costUsd: result.costUsd } });
            return result;
          } catch (e) {
            agent.update({ level: "ERROR", statusMessage: e instanceof Error ? e.message : String(e) });
            throw e;
          }
        },
        { asType: "agent" }
      )
  );
}

async function turn(
  deps: AgentDeps,
  conversationId: string,
  input: TurnInput,
  events: TurnEvents,
  setOutput: (text: string) => void
): Promise<TurnResult> {
  const now = deps.now ?? (() => new Date());
  const { conversation, messages } = await deps.store.load(conversationId);
  if (conversation.userId !== deps.toolCtx.userId) throw new AgentError("not_found");
  if (!isAgentModel(conversation.model)) throw new AgentError("rejected", `not an agent model: ${conversation.model}`);
  const effort = deps.effort ?? AGENT_MODELS[conversation.model].effort;

  const history: StoredMessage[] = [...messages];
  const pending = pendingToolCalls(history);
  if (input.kind === "approval" && pending.length === 0) throw new AgentError("nothing_pending");

  // The budget gates the whole turn, before anything is written or run.
  const spent = await deps.ledger.monthToDate(now());
  if (spent >= MONTHLY_CAP_USD) {
    log.warn("agent.budget_exhausted", { userId: deps.toolCtx.userId, spentUsd: spent });
    throw new AgentError("budget_exhausted");
  }

  const append = async (role: StoredMessage["role"], content: BetaContentBlockParam[]) => {
    const message: StoredMessage = { seq: history.length, role, content };
    await deps.store.append(conversationId, message);
    history.push(message);
  };

  // The turn opens with a user message. A new message answers any calls
  // still waiting with "not run"; an approval answers them with their results.
  if (input.kind === "message") {
    await append("user", [
      ...pending.map((call) => toolResult(call.id, NOT_RUN_NEW_MESSAGE, true)),
      contextBlock(now(), input.timeZone),
      { type: "text", text: input.text },
    ]);
  } else {
    // Two requests answering the same card at once could both run it; the
    // second then fails to append (conflict). The door sends one answer
    // per card.
    await append("user", await runCalls(deps, pending, input.decisions, events));
  }

  const tools = JSON.parse(conversation.tools) as BetaToolUnion[];
  let costUsd = 0;

  for (let step = 1; ; step++) {
    if (step > MAX_STEPS) return { status: "step_limit", steps: MAX_STEPS, costUsd, pending: [] };

    const params: BetaMessageStreamParams = {
      model: conversation.model,
      max_tokens: MAX_TOKENS,
      // The system prompt and tools are a fixed prefix: one breakpoint at its
      // end, and automatic caching for the growing conversation after it.
      system: [{ type: "text", text: conversation.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools,
      messages: history.map((m): BetaMessageParam => ({ role: m.role, content: m.content })),
      cache_control: { type: "ephemeral" },
      output_config: { effort },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    };

    const { message, ms, requestId } = await callModel(deps, params, events, step, conversationId);
    const cost = costOfMessage(message);
    costUsd += cost.costUsd;
    await recordSpend(deps, conversationId, message.model, requestId, cost);

    const refused = message.stop_reason === "refusal";
    const content = refused ? [] : echoable(message.content);
    log.info("agent.step", {
      conversationId,
      userId: deps.toolCtx.userId,
      purpose: deps.purpose,
      step,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      webSearches: cost.webSearches,
      costUsd: Number(cost.costUsd.toFixed(6)),
      ms,
    });
    if (cost.unpricedModels.length) log.warn("agent.unpriced_model", { models: cost.unpricedModels });
    events.step?.({ step, model: message.model, stopReason: message.stop_reason, content, cost, ms });
    const text = textOf(content);
    if (text) setOutput(text);

    switch (message.stop_reason) {
      case "refusal":
        // Declined by the model's safety classifiers, fallback included. A
        // partial answer is discarded, not stored.
        log.warn("agent.refusal", {
          conversationId,
          category: message.stop_details?.category ?? null,
          model: message.model,
        });
        return { status: "refused", steps: step, costUsd, pending: [] };

      case "pause_turn":
        // A long server-tool turn (web search) paused: send it back as is
        // and the API carries on.
        if (content.length) await append("assistant", content);
        continue;

      case "tool_use": {
        await append("assistant", content);
        const calls = toolCallsIn(content);
        if (calls.length === 0) return { status: "done", steps: step, costUsd, pending: [] };
        if (calls.some((call) => needsApproval(call.name))) {
          return {
            status: "awaiting_approval",
            steps: step,
            costUsd,
            pending: calls.map((call) => ({ ...call, needsApproval: needsApproval(call.name) })),
          };
        }
        if (step >= MAX_STEPS) {
          await append(
            "user",
            calls.map((call) => toolResult(call.id, STEP_LIMIT, true))
          );
          return { status: "step_limit", steps: step, costUsd, pending: [] };
        }
        await append("user", await runCalls(deps, calls, {}, events));
        continue;
      }

      case "max_tokens": {
        // Cut off. A call in the cut-off message may be incomplete: answer it
        // as not run, so the history stays valid for the next message.
        if (content.length) await append("assistant", content);
        const calls = toolCallsIn(content);
        if (calls.length) await append("user", calls.map((call) => toolResult(call.id, CUT_OFF, true)));
        return { status: "max_tokens", steps: step, costUsd, pending: [] };
      }

      default:
        // end_turn, stop_sequence — and any stop reason added later.
        if (message.stop_reason !== "end_turn") {
          log.warn("agent.unexpected_stop", { conversationId, stopReason: message.stop_reason });
        }
        if (content.length) await append("assistant", content);
        return { status: "done", steps: step, costUsd, pending: [] };
    }
  }
}

/**
 * One model call, streamed. A stream that breaks off without an API error
 * (a dropped connection, a tool input that can't be parsed) is re-run once;
 * the tokens it used are billed, so they are recorded from what had arrived.
 */
async function callModel(
  deps: AgentDeps,
  params: BetaMessageStreamParams,
  events: TurnEvents,
  step: number,
  conversationId: string
): Promise<{ message: BetaMessage; ms: number; requestId: string | null }> {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const generation = startObservation(
      "claude",
      { model: params.model, modelParameters: { max_tokens: params.max_tokens, effort: params.output_config?.effort ?? "" } },
      { asType: "generation" }
    );
    const stream = deps.client.beta.messages.stream(params, { signal: deps.signal });
    stream.on("text", (delta) => events.text?.(delta));
    try {
      const message = await stream.finalMessage();
      const cost = costOfMessage(message);
      generation
        .update({
          model: message.model,
          output: textOf(echoable(message.content)),
          usageDetails: {
            input: cost.inputTokens,
            output: cost.outputTokens,
            cache_read_input_tokens: cost.cacheReadTokens,
            cache_creation_input_tokens: cost.cacheWriteTokens,
          },
          costDetails: { total: cost.costUsd },
          metadata: { step, stopReason: message.stop_reason, webSearches: cost.webSearches },
        })
        .end();
      return { message, ms: Date.now() - started, requestId: stream.request_id ?? null };
    } catch (err) {
      const partial = stream.currentMessage;
      if (partial) {
        await recordSpend(deps, conversationId, partial.model, stream.request_id ?? null, costOfMessage(partial));
      }
      generation.update({ level: "ERROR", statusMessage: err instanceof Error ? err.message : String(err) }).end();
      if (err instanceof Anthropic.APIError || err instanceof AgentError || attempt >= 2) {
        throw fromAnthropicError(err);
      }
      log.warn("agent.stream_retry", {
        conversationId,
        step,
        error: err instanceof Error ? err.message : String(err),
      });
      events.stepRetried?.(step);
    }
  }
}

/**
 * Runs the calls of one assistant message, results in the same order.
 * A call that saves something runs only if approved; read calls always run.
 * Reads alone run in parallel; with a write among them, one by one in the
 * model's order.
 */
async function runCalls(
  deps: AgentDeps,
  calls: ToolCall[],
  decisions: Record<string, boolean>,
  events: TurnEvents
): Promise<BetaToolResultBlockParam[]> {
  const runOne = async (call: ToolCall) => {
    const span = startObservation(call.name, { input: call.input }, { asType: "tool" });
    const outcome =
      needsApproval(call.name) && decisions[call.id] !== true
        ? { text: DECLINED, isError: true }
        : await executeToolCall(deps.toolCtx, call.name, call.input);
    span.update({ output: outcome.text.slice(0, 4000), level: outcome.isError ? "WARNING" : "DEFAULT" }).end();
    events.toolResult?.({ id: call.id, name: call.name, ...outcome });
    return toolResult(call.id, outcome.text, outcome.isError);
  };

  if (calls.some((call) => needsApproval(call.name))) {
    const results: BetaToolResultBlockParam[] = [];
    for (const call of calls) results.push(await runOne(call));
    return results;
  }
  return Promise.all(calls.map(runOne));
}

/** Writes the call to the ledger. A failed write is logged, not thrown: the
 *  user's turn goes on, and the log shows the spend the ledger missed. */
async function recordSpend(
  deps: AgentDeps,
  conversationId: string,
  model: string,
  requestId: string | null,
  cost: CallCost
) {
  try {
    await deps.ledger.record({
      userId: deps.toolCtx.userId,
      conversationId: deps.store.persistent ? conversationId : null,
      purpose: deps.purpose,
      model,
      requestId,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      cacheReadTokens: cost.cacheReadTokens,
      webSearches: cost.webSearches,
      costUsd: cost.costUsd,
    });
  } catch (e) {
    log.error("agent.spend_write_failed", e, { userId: deps.toolCtx.userId, model, requestId, costUsd: cost.costUsd });
  }
}
