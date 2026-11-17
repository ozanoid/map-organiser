import { withMcpAuth } from "mcp-handler";
import { assistantMcpHandler } from "@/lib/assistant/mcp";
import { MCP_RESOURCE_METADATA_PATH } from "@/lib/assistant/oauth";
import { verifyAssistantToken } from "@/lib/assistant/verify-token";

/**
 * The Map Organiser MCP endpoint (Streamable HTTP, stateless). Every request
 * needs a Supabase access token; without one the client gets a 401 whose
 * WWW-Authenticate header points at the protected resource metadata, and
 * from there at Supabase's OAuth server. The session middleware skips this
 * path (src/middleware.ts matcher).
 */
const handler = withMcpAuth(assistantMcpHandler, verifyAssistantToken, {
  required: true,
  resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
});

export { handler as GET, handler as POST, handler as DELETE };

// rank_places waits on one Gemini call that took 41–64 s in testing
// (17.11.2026); the other tools answer in under a second. Same ceiling as
// the in-app assistant's /api/ai/chat.
export const maxDuration = 120;
