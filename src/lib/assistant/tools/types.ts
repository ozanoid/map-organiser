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

export function defineTool<Schema extends z.ZodObject>(tool: AssistantTool<Schema>): AssistantTool<Schema> {
  return tool;
}
