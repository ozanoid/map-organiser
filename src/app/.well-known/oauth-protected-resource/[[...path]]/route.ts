import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { MCP_PATH, supabaseAuthIssuer } from "@/lib/assistant/oauth";

/**
 * RFC 9728 Protected Resource Metadata for the MCP endpoint. Served at both
 * /.well-known/oauth-protected-resource and the path-inserted
 * /.well-known/oauth-protected-resource/api/mcp (the one /api/mcp's 401
 * challenge names). The app has one protected resource, so `resource` is
 * always the MCP URL, and the authorization server is Supabase Auth.
 */
export function GET(req: Request) {
  return protectedResourceHandler({
    authServerUrls: [supabaseAuthIssuer()],
    resourceUrl: `${getPublicOrigin(req)}${MCP_PATH}`,
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
