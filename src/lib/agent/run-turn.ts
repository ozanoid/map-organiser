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
import type { ToolOutcome } from "@/lib/assistant/run-tool";
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
import type { Conversation, ConversationStore, Door, NewToolRun, ToolRunDecision } from "@/lib/agent/store";
import { agentToolDefinitions, checkToolCall, executeToolCall, needsApproval } from "@/lib/agent/tools";
import { log } from "@/lib/telemetry/logger";

/**
 * The agent loop — one user turn of a conversation: the user's message (or
 * their answer to an approval card) in, Claude's reply out, with every tool
 * round in between. Doors (the app panel today) call this and turn the
 * events into what they show.
 *
 *   - One turn at a time per conversation (the store's turn lease).
 *   - History is append-only (see history.ts); each turn reads the stored
 *     conversation and appends to it.
 *   - Every tool call gets a run record — its decision, then its result —
 *     before it runs. A call is never run twice, and a result that didn't
 *     reach the conversation (a crash, a failed write) is used from the
 *     record instead of running the tool again.
 *   - A call to a tool that saves something stops the turn: the assistant
 *     message is stored with its calls pending, and the turn resumes when
 *     the user's decision arrives (TurnInput "approval"). Read calls made in
 *     the same message wait with it.
 *   - Every model call is written to the spend ledger; the monthly cap is
 *     checked before a turn starts.
 *
 * Plan: docs/_plans/phase-2-assistant.md.
 */

/** Longer than a turn can run (a route has 800 s), so a lease left by a
 *  crashed turn frees itself. */
const TURN_LEASE_MS = 15 * 60 * 1000;

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
  /** A tool call was answered — run, declined, not run or refused. */
  toolResult?(result: { id: string; name: string; text: string; isError: boolean }): void;
}

export type TurnStatus =
  | "done"
  | "awaiting_approval" // a call that saves something waits for the user's card
  | "refused" // the model (and any fallback) declined; nothing was stored for it
  | "max_tokens" // the reply was cut off at MAX_TOKENS
  | "step_limit"; // MAX_STEPS tool rounds; the model was asked to answer with what it had

export interface PendingCall extends ToolCall {
  /** True for a valid call that saves something: the user decides on a
   *  card. False for reads (they run with the decision) and for calls
   *  already answered as invalid. */
  needsApproval: boolean;
}

export interface TurnResult {
  status: TurnStatus;
  steps: number;
  costUsd: number;
  /** When awaiting approval: every call in the paused message. */
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
  /** Runs a tool call; the shared tools by default. The offline checks
   *  (scripts/agent-check) pass a stand-in, so an approved write in a check
   *  touches nothing. */
  executeTool?: typeof executeToolCall;
  now?: () => Date;
  signal?: AbortSignal;
}

const NOT_RUN_NEW_MESSAGE = "Not run: the user sent a new message instead of answering the approval card.";
const DECLINED = "The user declined this on the approval card; nothing was saved.";
const STEP_LIMIT =
  "Not run: this turn reached its limit of tool rounds. Answer the user now with what you have, and offer to continue.";
const CUT_OFF = "Not run: your message was cut off at the length limit before this call was complete.";
const INTERRUPTED =
  "This call was interrupted before its result was recorded; it may or may not have completed. Check the current state (get_plans, get_lists, get_visits or get_places) before trying again.";

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
            if (!(await deps.store.takeTurn(conversationId, TURN_LEASE_MS))) throw new AgentError("turn_in_progress");
            try {
              const result = await turn(deps, conversationId, input, events, (text) => agent.update({ output: text }));
              agent.update({ metadata: { status: result.status, steps: result.steps, costUsd: result.costUsd } });
              return result;
            } finally {
              await deps.store.releaseTurn(conversationId).catch((e: unknown) =>
                log.warn("agent.release_turn_failed", {
                  conversationId,
                  error: e instanceof Error ? e.message : String(e),
                })
              );
            }
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

  // The turn opens with a user message. Calls still waiting are answered
  // first: with "not run" when the user wrote instead of deciding, with
  // their results when the decision is the input.
  if (input.kind === "message") {
    await append("user", [
      ...(await settleCalls(deps, conversationId, pending, { kind: "superseded" }, events)),
      contextBlock(now(), input.timeZone),
      { type: "text", text: input.text },
    ]);
  } else {
    await append(
      "user",
      await settleCalls(deps, conversationId, pending, { kind: "decided", decisions: input.decisions }, events)
    );
  }

  const tools = JSON.parse(conversation.tools) as BetaToolUnion[];
  let costUsd = 0;
  // After MAX_STEPS tool rounds the calls are answered "not run — answer
  // with what you have", and the model gets one last call to do so.
  let wrappingUp = false;

  for (let step = 1; ; step++) {
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

    const { message, ms, requestId, partialCostUsd } = await callModel(deps, params, events, step, conversationId);
    const cost = costOfMessage(message, params.model);
    costUsd += partialCostUsd + cost.costUsd;
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
    emit(events.step, { step, model: message.model, stopReason: message.stop_reason, content, cost, ms });
    const text = textOf(content);
    if (text) emit(setOutput, text);
    const finished = (status: TurnStatus, pendingCalls: PendingCall[] = []): TurnResult => ({
      status,
      steps: step,
      costUsd,
      pending: pendingCalls,
    });

    switch (message.stop_reason) {
      case "refusal":
        // Declined by the model's safety classifiers, fallback included. A
        // partial answer is discarded, not stored.
        log.warn("agent.refusal", {
          conversationId,
          category: message.stop_details?.category ?? null,
          model: message.model,
        });
        return finished("refused");

      case "pause_turn":
        // A long server-tool turn (web search) paused: send it back as is
        // and the API carries on.
        if (content.length) await append("assistant", content);
        if (wrappingUp) return finished("step_limit");
        continue;

      case "tool_use": {
        await append("assistant", content);
        const calls = toolCallsIn(content);
        if (calls.length === 0) return finished(wrappingUp ? "step_limit" : "done");

        if (!wrappingUp) {
          const checked = calls.map((call) => ({ call, check: checkToolCall(call.name, call.input) }));
          if (checked.some(({ call, check }) => check.ok && needsApproval(call.name))) {
            // The card opens for writes with a valid input only. Invalid calls
            // are answered now; the rest wait for the user's decision.
            const invalid = checked.flatMap(({ call, check }) => (check.ok ? [] : [{ call, message: check.message }]));
            await deps.store.startToolRuns(
              conversationId,
              invalid.map(({ call, message: why }) => ({
                toolUseId: call.id,
                name: call.name,
                decision: "invalid" as const,
                outcome: { text: why, isError: true },
              }))
            );
            for (const { call, message: why } of invalid) {
              emit(events.toolResult, { id: call.id, name: call.name, text: why, isError: true });
            }
            return finished(
              "awaiting_approval",
              checked.map(({ call, check }) => ({ ...call, needsApproval: check.ok && needsApproval(call.name) }))
            );
          }
        }

        if (wrappingUp || step >= MAX_STEPS) {
          await append("user", await settleCalls(deps, conversationId, calls, { kind: "limit" }, events));
          if (wrappingUp) return finished("step_limit");
          wrappingUp = true;
          continue;
        }
        await append("user", await settleCalls(deps, conversationId, calls, { kind: "auto" }, events));
        continue;
      }

      case "max_tokens": {
        // Cut off. A call in the cut-off message may be incomplete: answer it
        // as not run, so the history stays valid for the next message.
        if (content.length) await append("assistant", content);
        const calls = toolCallsIn(content);
        if (calls.length) await append("user", await settleCalls(deps, conversationId, calls, { kind: "cut_off" }, events));
        return finished("max_tokens");
      }

      default:
        // end_turn, stop_sequence — and any stop reason added later.
        if (message.stop_reason !== "end_turn") {
          log.warn("agent.unexpected_stop", { conversationId, stopReason: message.stop_reason });
        }
        if (content.length) await append("assistant", content);
        return finished(wrappingUp ? "step_limit" : "done");
    }
  }
}

/** How the calls of one assistant message get their answers. */
type SettleMode =
  | { kind: "auto" } // a tool round of reads: run them
  | { kind: "decided"; decisions: Record<string, boolean> } // the user's answer to the card
  | { kind: "superseded" } // the user wrote a new message instead
  | { kind: "limit" } // the turn hit its step limit
  | { kind: "cut_off" }; // the message was cut off at max_tokens

/**
 * Answers every call of an assistant message, results in the calls' order.
 *
 * A call already recorded keeps its recorded result — the run happened, even
 * if its result never reached the conversation. A call recorded as started
 * but never finished was interrupted (a crash): its outcome is unknown, and
 * the model is told to check before trying again. Every other call is
 * recorded with its decision before anything runs, in one write; a second
 * request answering the same calls stops there (conflict). Approved writes
 * and reads then run — reads alone in parallel, with a write among them one
 * by one in the model's order — and each result is recorded.
 */
async function settleCalls(
  deps: AgentDeps,
  conversationId: string,
  calls: ToolCall[],
  mode: SettleMode,
  events: TurnEvents
): Promise<BetaToolResultBlockParam[]> {
  if (calls.length === 0) return [];
  const recorded = new Map(
    (await deps.store.toolRuns(conversationId, calls.map((call) => call.id))).map((run) => [run.toolUseId, run])
  );
  const outcomes = new Map<string, ToolOutcome>();
  const fresh: NewToolRun[] = [];
  const toRun: ToolCall[] = [];
  const interrupted: ToolCall[] = [];

  for (const call of calls) {
    const run = recorded.get(call.id);
    if (run?.status === "done" && run.outcome) {
      outcomes.set(call.id, run.outcome);
      continue;
    }
    if (run) {
      interrupted.push(call);
      continue;
    }
    const check = checkToolCall(call.name, call.input);
    let decision: ToolRunDecision;
    let outcome: ToolOutcome | undefined;
    if (!check.ok) {
      decision = "invalid";
      outcome = { text: check.message, isError: true };
    } else if (mode.kind === "superseded" || mode.kind === "limit" || mode.kind === "cut_off") {
      decision = "not_run";
      outcome = {
        text: mode.kind === "superseded" ? NOT_RUN_NEW_MESSAGE : mode.kind === "limit" ? STEP_LIMIT : CUT_OFF,
        isError: true,
      };
    } else if (needsApproval(call.name)) {
      if (mode.kind === "decided" && mode.decisions[call.id] === true) {
        decision = "approved";
      } else {
        decision = "declined";
        outcome = { text: DECLINED, isError: true };
      }
    } else {
      decision = "auto";
    }
    fresh.push({ toolUseId: call.id, name: call.name, decision, outcome });
    if (outcome) outcomes.set(call.id, outcome);
    else toRun.push(call);
  }

  // Recorded before anything runs: a second answer to the same calls stops here.
  await deps.store.startToolRuns(conversationId, fresh);
  for (const call of interrupted) {
    const outcome = { text: INTERRUPTED, isError: true };
    await deps.store.finishToolRun(conversationId, call.id, outcome);
    outcomes.set(call.id, outcome);
  }

  const runOne = async (call: ToolCall) => {
    const span = startObservation(call.name, { input: call.input }, { asType: "tool" });
    const outcome = await (deps.executeTool ?? executeToolCall)(deps.toolCtx, call.name, call.input);
    span.update({ output: outcome.text.slice(0, 4000), level: outcome.isError ? "WARNING" : "DEFAULT" }).end();
    await deps.store.finishToolRun(conversationId, call.id, outcome);
    outcomes.set(call.id, outcome);
  };
  if (toRun.some((call) => needsApproval(call.name))) {
    for (const call of toRun) await runOne(call);
  } else {
    await Promise.all(toRun.map(runOne));
  }

  return calls.map((call) => {
    const outcome = outcomes.get(call.id)!;
    emit(events.toolResult, { id: call.id, name: call.name, ...outcome });
    return toolResult(call.id, outcome.text, outcome.isError);
  });
}

/**
 * One model call, streamed. A stream that breaks off without an API error
 * (a dropped connection, a tool input that can't be parsed) is aborted —
 * the server would otherwise go on generating, billed — and re-run once.
 * The tokens an attempt used are billed, so they are recorded from what had
 * arrived (input in full; output only as far as the API had reported it).
 */
async function callModel(
  deps: AgentDeps,
  params: BetaMessageStreamParams,
  events: TurnEvents,
  step: number,
  conversationId: string
): Promise<{ message: BetaMessage; ms: number; requestId: string | null; partialCostUsd: number }> {
  const started = Date.now();
  let partialCostUsd = 0;
  for (let attempt = 1; ; attempt++) {
    const generation = startObservation(
      "claude",
      { model: params.model, modelParameters: { max_tokens: params.max_tokens, effort: params.output_config?.effort ?? "" } },
      { asType: "generation" }
    );
    const stream = deps.client.beta.messages.stream(params, { signal: deps.signal });
    stream.on("text", (delta) => emit(events.text, delta));
    try {
      const message = await stream.finalMessage();
      const cost = costOfMessage(message, params.model);
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
      return { message, ms: Date.now() - started, requestId: stream.request_id ?? null, partialCostUsd };
    } catch (err) {
      stream.abort();
      const partial = stream.currentMessage;
      if (partial) {
        const cost = costOfMessage(partial, params.model);
        partialCostUsd += cost.costUsd;
        await recordSpend(deps, conversationId, partial.model, stream.request_id ?? null, cost);
      }
      generation.update({ level: "ERROR", statusMessage: err instanceof Error ? err.message : String(err) }).end();
      if (err instanceof Anthropic.APIError || err instanceof AgentError) throw fromAnthropicError(err);
      if (attempt >= 2) {
        throw new AgentError("connection", err instanceof Error ? err.message : String(err), { cause: err });
      }
      log.warn("agent.stream_retry", {
        conversationId,
        step,
        error: err instanceof Error ? err.message : String(err),
      });
      emit(events.stepRetried, step);
    }
  }
}

/** Calls a door's event handler. A handler that throws is logged and the
 *  turn goes on: a display problem must not stop — or re-bill — the turn. */
function emit<A extends unknown[]>(handler: ((...args: A) => void) | undefined, ...args: A): void {
  if (!handler) return;
  try {
    handler(...args);
  } catch (e) {
    log.warn("agent.event_handler_failed", { error: e instanceof Error ? e.message : String(e) });
  }
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
