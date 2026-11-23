import "server-only";
import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AssistantContext } from "@/lib/assistant/library";
import { parseToolInput, runAssistantTool, type ToolOutcome } from "@/lib/assistant/run-tool";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

/**
 * The shared assistant tools (src/lib/assistant/tools) as the Claude agent
 * sees them, plus Anthropic's web search. The same code claude.ai reaches
 * over MCP runs here in-process, as the signed-in user.
 */

const BY_NAME = new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));

/** Web searches per model call (one API request; a turn can make several). */
export const WEB_SEARCH_MAX_USES = 3;

/**
 * The tools array a new conversation starts with. It is stored with the
 * conversation and sent unchanged for its whole life: Claude's thinking is
 * bound to the tools it saw.
 *
 * The JSON Schema is the one MCP clients get (draft 2020-12, input side).
 * Inputs stream as the model writes them (eager_input_streaming); the
 * server then doesn't validate them, so every call is checked against the
 * same zod schema before it runs (executeToolCall).
 */
export function agentToolDefinitions(): BetaToolUnion[] {
  const tools: BetaToolUnion[] = ASSISTANT_TOOLS.map((tool) => {
    const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-2020-12", io: "input" }) as Record<
      string,
      unknown
    >;
    delete schema.$schema; // the dialect marker; the API takes the schema itself
    return {
      name: tool.name,
      description: tool.description,
      input_schema: { ...schema, type: "object" },
      eager_input_streaming: true,
    };
  });
  tools.push({ type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES });
  return tools;
}

/**
 * A tool that writes needs the user's OK in the app before it runs — the
 * one rule, read from the tool's own annotation (today: add_places,
 * create_plan, update_plan, save_list, log_visit, delete_visit,
 * update_places). Decided by the current code, not by the tools a
 * conversation started with.
 */
export function needsApproval(name: string): boolean {
  return BY_NAME.get(name)?.annotations.readOnlyHint === false;
}

/** Runs one tool call the model made. Never throws: a bad input or a
 *  failure comes back as an error result the model reads. */
export async function executeToolCall(ctx: AssistantContext, name: string, input: unknown): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) return { text: `There is no tool named ${name}.`, isError: true };
  const parsed = parseToolInput(tool, input);
  if (!parsed.ok) return { text: parsed.message, isError: true };
  return runAssistantTool(tool, ctx, parsed.data, "agent");
}
