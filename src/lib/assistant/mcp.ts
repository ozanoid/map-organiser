import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";
import { createMcpHandler } from "mcp-handler";
import type { AssistantContext } from "@/lib/assistant/library";
import { ASSISTANT_INSTRUCTIONS } from "@/lib/assistant/instructions";
import { runAssistantTool } from "@/lib/assistant/run-tool";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

/**
 * The Map Organiser MCP server: the assistant tools over Streamable HTTP,
 * stateless. Mounted at /api/mcp behind withMcpAuth (src/app/api/mcp).
 */

function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function contextFrom(auth: AuthInfo | undefined): AssistantContext | null {
  const userId = auth?.extra?.userId;
  const appUrl = auth?.extra?.appUrl;
  if (!auth || typeof userId !== "string" || typeof appUrl !== "string") return null;
  return { supabase: userClient(auth.token), userId, appUrl };
}

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

export const assistantMcpHandler = createMcpHandler(
  (server) => {
    for (const tool of ASSISTANT_TOOLS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args: unknown, extra) => {
          const ctx = contextFrom(extra.http?.authInfo);
          if (!ctx) return textResult("Not signed in to Map Organiser.", true);
          // The SDK has validated args against inputSchema already.
          const outcome = await runAssistantTool(tool, ctx, args, "mcp");
          return textResult(outcome.text, outcome.isError);
        }
      );
    }
  },
  {
    serverInfo: { name: "map-organiser", version: "1.0.0" },
    instructions: ASSISTANT_INSTRUCTIONS,
  }
);
