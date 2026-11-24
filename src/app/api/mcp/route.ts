import { withMcpAuth } from "mcp-handler";
import { assistantMcpHandler } from "@/lib/assistant/mcp";
import { MCP_RESOURCE_METADATA_PATH } from "@/lib/assistant/oauth";
import { verifyAssistantToken } from "@/lib/assistant/verify-token";

/**
 * The Map Organiser MCP endpoint (Streamable HTTP, stateless). Every request
 * needs a Supabase access token; without one the client gets a 401 whose
 * WWW-Authenticate header points at the protected resource metadata, and
 * from there at Supabase's OAuth server. The session proxy skips this path
 * (src/proxy.ts matcher).
 */
const handler = withMcpAuth(assistantMcpHandler, verifyAssistantToken, {
  required: true,
  resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
});

export { handler as GET, handler as POST, handler as DELETE };

// add_places with an Instagram post waits up to 45 s for the post to be
// read; the other tools answer in seconds. (rank_places waited 41–64 s on
// a Gemini call until 24.11.2026; it no longer calls a model.)
export const maxDuration = 120;
