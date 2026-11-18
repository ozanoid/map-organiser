import type { z } from "zod";
import type { AssistantContext } from "@/lib/assistant/library";

/**
 * One assistant tool, independent of the transport. The MCP server
 * (src/lib/assistant/mcp.ts) registers these today; the in-app assistant
 * moves onto the same definitions in Phase 2 of the personal-assistant plan.
 *
 * `run` returns plain JSON. Throw ToolInputError for problems the model can
 * fix (an unknown tag, a bad date); anything else is a server error.
 */
export interface AssistantTool<Schema extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  run(ctx: AssistantContext, input: z.infer<Schema>): Promise<unknown>;
}

/**
 * Every tool's input is strict at the top: a key the tool doesn't know is an
 * error the model sees, not dropped. Otherwise a misnamed field — `date` for
 * log_visit's `visited_on`, `time` for `start_time` — turns into a call that
 * quietly does something else (a visit logged today). The JSON Schema
 * clients see says so too (additionalProperties: false).
 */
export function defineTool<Schema extends z.ZodObject>(tool: AssistantTool<Schema>): AssistantTool<Schema> {
  return { ...tool, inputSchema: tool.inputSchema.strict() as unknown as Schema };
}
