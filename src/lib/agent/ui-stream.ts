import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { UIMessageStreamWriter } from "ai";
import type { AssistantContext } from "@/lib/assistant/library";
import { describeWrites } from "@/lib/agent/describe-writes";
import { AgentError, isTransient } from "@/lib/agent/errors";
import type { StoredMessage, ToolCall } from "@/lib/agent/history";
import type { TurnEvents, TurnResult } from "@/lib/agent/run-turn";
import { checkToolCall, needsApproval } from "@/lib/agent/tools";
import { searchResults, uiToolOutput } from "@/lib/agent/ui";
import type { AssistantUIMessage, ToolMetadata } from "@/lib/agent/ui-types";
import { log } from "@/lib/telemetry/logger";

/**
 * A live turn, written to the app's panel in the AI SDK's UI message stream:
 * text as it streams, a step boundary per model call, a part per tool call
 * and its result, a card (with its preview) for each call waiting for the
 * user, and the turn's outcome as a `data-turn` part.
 *
 * Writing never fails the turn: the stream's writer swallows writes after
 * the browser has gone, and the loop ignores handlers that throw.
 */
export function turnStream(
  writer: UIMessageStreamWriter<AssistantUIMessage>,
  opts: {
    /** Tool calls already in the message this response continues (the
     *  calls an approval answers); results for any other earlier call are
     *  not this message's to show. */
    continuing: string[];
    toolCtx: AssistantContext;
    /** The conversation, growing as the turn appends — for the card
     *  previews (names from earlier Google Maps searches). */
    history: readonly StoredMessage[];
  }
) {
  const shown = new Set(opts.continuing);
  /** Writes held back from the step: they appear with their card. */
  const held = new Map<string, ToolCall>();
  let textId: string | null = null;
  /** The model's content block the open text part belongs to. */
  let textBlock = -1;
  let stepOpen = false;
  let n = 0;

  const openStep = () => {
    if (!stepOpen) {
      writer.write({ type: "start-step" });
      stepOpen = true;
    }
  };
  const closeText = () => {
    if (textId) {
      writer.write({ type: "text-end", id: textId });
      textId = null;
    }
  };
  const closeStep = () => {
    closeText();
    if (stepOpen) {
      writer.write({ type: "finish-step" });
      stepOpen = false;
    }
  };
  const showCall = (call: ToolCall, preview?: ToolMetadata["preview"]) => {
    const toolMetadata: ToolMetadata | undefined = needsApproval(call.name)
      ? { write: true, ...(preview ? { preview } : {}) }
      : undefined;
    writer.write({
      type: "tool-input-available",
      toolCallId: call.id,
      toolName: call.name,
      input: call.input,
      dynamic: true,
      ...(toolMetadata ? { toolMetadata } : {}),
    });
    shown.add(call.id);
    held.delete(call.id);
  };

  const events: TurnEvents = {
    text(delta, block) {
      openStep();
      // Each text block of the model's message is a part of its own, as in
      // the stored conversation (text before and after a web search).
      if (textId && block !== textBlock) closeText();
      if (!textId) {
        textId = `t${++n}`;
        textBlock = block;
        writer.write({ type: "text-start", id: textId });
      }
      writer.write({ type: "text-delta", id: textId, delta });
    },
    stepRetried() {
      // The re-run starts a new text part; the broken one stays (rare).
      closeText();
    },
    step(info) {
      openStep();
      closeText();
      const searched = new Map<string, unknown>();
      for (const b of info.content) if (b.type === "web_search_tool_result") searched.set(b.tool_use_id, b.content);
      for (const b of info.content as BetaContentBlockParam[]) {
        if (b.type === "server_tool_use" && b.name === "web_search") {
          writer.write({
            type: "tool-input-available",
            toolCallId: b.id,
            toolName: "web_search",
            input: b.input,
            providerExecuted: true,
            dynamic: true,
          });
          writer.write({
            type: "tool-output-available",
            toolCallId: b.id,
            output: searchResults(searched.get(b.id)),
            providerExecuted: true,
            dynamic: true,
          });
        } else if (b.type === "tool_use") {
          const call = { id: b.id, name: b.name, input: b.input };
          if (needsApproval(b.name) && checkToolCall(b.name, b.input).ok) held.set(b.id, call);
          else showCall(call);
        }
      }
      // A step whose calls run now stays open until their results; one that
      // stops (an answer, a card) is closed by finish().
    },
    toolResult(r) {
      const call = held.get(r.id);
      if (call) showCall(call);
      if (!shown.has(r.id)) return; // an earlier message's call, answered "not run"
      if (r.decision === "declined" || r.decision === "not_run") {
        // Not a failure: the user said no, wrote instead, or a limit hit.
        writer.write({ type: "tool-output-denied", toolCallId: r.id });
      } else if (r.isError) {
        writer.write({ type: "tool-output-error", toolCallId: r.id, errorText: r.text, dynamic: true });
      } else {
        writer.write({ type: "tool-output-available", toolCallId: r.id, output: uiToolOutput(r.name, r.text), dynamic: true });
      }
      // The results close the step that made the calls.
      closeStep();
    },
  };

  return {
    events,

    /** After the turn: the cards it stopped for, then its outcome. */
    async finish(result: TurnResult) {
      closeText();
      if (result.status === "awaiting_approval") {
        const writes = result.pending.filter((p) => p.needsApproval);
        let previews = {};
        try {
          previews = await describeWrites(opts.toolCtx, writes, opts.history, { waiting: new Set(writes.map((w) => w.id)) });
        } catch (e) {
          // A card without its preview still asks yes or no.
          log.warn("agent.preview_failed", { error: e instanceof Error ? e.message : String(e) });
        }
        for (const call of writes) {
          showCall(call, (previews as Record<string, ToolMetadata["preview"]>)[call.id]);
          writer.write({ type: "tool-approval-request", approvalId: call.id, toolCallId: call.id });
        }
      }
      closeStep();
      writer.write({ type: "data-turn", id: "turn", data: { status: result.status, version: result.messageCount } });
    },

    /** The turn broke off: its reason, for the panel. `version`: how far
     *  the conversation got. Try again is offered for a passing failure;
     *  the panel then reloads the conversation, which says for sure. */
    fail(e: unknown, version: number) {
      closeStep();
      const error =
        e instanceof AgentError ? e : new AgentError("upstream", e instanceof Error ? e.message : String(e), { cause: e });
      if (!(e instanceof AgentError)) log.error("agent.turn_failed", e, {});
      writer.write({
        type: "data-turn",
        id: "turn",
        data: { status: "error", code: error.code, message: error.userMessage, retry: isTransient(error.code), version },
      });
    },
  };
}
