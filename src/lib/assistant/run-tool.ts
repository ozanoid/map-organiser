import "server-only";
import { ToolInputError, type AssistantContext } from "@/lib/assistant/library";
import type { AssistantTool } from "@/lib/assistant/tools/types";
import { InputError, NotFoundError } from "@/lib/db/errors";
import { log } from "@/lib/telemetry/logger";

/**
 * Running one assistant tool for a user — the part every door shares: the
 * MCP server (claude.ai) and the platform's own agent (src/lib/agent). What
 * the model reads back is the same whichever door it came through.
 */

export interface ToolOutcome {
  /** What the model reads: the tool's JSON output, or the error. */
  text: string;
  isError: boolean;
}

/**
 * Validates a tool call's input against the tool's schema — the check the
 * MCP SDK makes before a call reaches us, with the same wording. Inputs the
 * agent receives are streamed and parsed leniently, so a cut-off input shows
 * up here rather than as a malformed call.
 */
export function parseToolInput(
  tool: AssistantTool,
  input: unknown
): { ok: true; data: unknown } | { ok: false; message: string } {
  const result = tool.inputSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((issue) => (issue.path.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message))
    .join(", ");
  return { ok: false, message: `Input validation error: Invalid arguments for tool ${tool.name}: ${issues}` };
}

/** Runs a tool with input that already passed its schema. */
export async function runAssistantTool(
  tool: AssistantTool,
  ctx: AssistantContext,
  input: unknown,
  door: "mcp" | "agent"
): Promise<ToolOutcome> {
  const started = Date.now();
  try {
    const out = await tool.run(ctx, input as never);
    log.info("assistant.tool", { tool: tool.name, userId: ctx.userId, door, ms: Date.now() - started });
    return { text: JSON.stringify(out), isError: false };
  } catch (e) {
    // A request the model can correct: a bad name, a rule a write
    // function refused ("a visit can't be in the future").
    if (e instanceof ToolInputError || e instanceof InputError || e instanceof NotFoundError) {
      return { text: e.message, isError: true };
    }
    log.warn("assistant.tool_failed", {
      tool: tool.name,
      userId: ctx.userId,
      door,
      error: e instanceof Error ? e.message : String(e),
    });
    // A write may have landed before the error (a lost response):
    // retrying blindly could save it twice.
    return {
      text: tool.annotations.readOnlyHint
        ? "Map Organiser hit an error running this tool. Try again, or narrow the request."
        : "Map Organiser hit an error running this tool; the change may or may not have been saved. Check the current state (get_plans, get_visits or get_places) before trying again.",
      isError: true,
    };
  }
}
