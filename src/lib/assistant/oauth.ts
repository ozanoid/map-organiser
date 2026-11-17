/**
 * The MCP endpoint's OAuth surface. Supabase Auth is the authorization
 * server (OAuth 2.1 server, dynamic client registration); this app is the
 * protected resource and hosts the consent page.
 */

export const MCP_PATH = "/api/mcp";

/** RFC 9728 metadata for a resource with a path lives at the path-inserted URL. */
export const MCP_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/** Issuer of the Supabase OAuth server — must equal its RFC 8414 `issuer`. */
export function supabaseAuthIssuer(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
}

const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the consent page may send an authorization code. Dynamic client
 * registration lets any app register any redirect URI, so approving an
 * unknown one would hand a token for the user's data to whoever registered
 * it. Allowed: Claude's connector callback, and loopback URLs that local
 * clients such as Claude Code listen on (RFC 8252).
 */
export function isAllowedOAuthRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:" && CLAUDE_HOSTS.has(u.hostname) && u.pathname === "/api/mcp/auth_callback") return true;
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}
