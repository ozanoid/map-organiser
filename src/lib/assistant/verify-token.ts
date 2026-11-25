import "server-only";
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/api/origin";
import { supabaseAuthIssuer } from "@/lib/assistant/oauth";
import { isAssistantOwner } from "@/lib/assistant/owner";

/**
 * Bearer token → AuthInfo for withMcpAuth. Tokens are Supabase access
 * tokens: issued by the OAuth 2.1 server to an MCP client, or an ordinary
 * session token. getClaims verifies the signature locally against the JWKS
 * when the project signs with asymmetric keys, and asks the Auth server
 * otherwise.
 *
 * undefined → 401 with a challenge pointing at the resource metadata, so the
 * client starts (or restarts) the OAuth flow. A valid token for an account
 * that isn't an assistant owner → 403, which ends the flow instead.
 *
 * `extra.appUrl` is the origin the client reached this server at — the same
 * one the OAuth metadata advertises — so links in tool results open the app
 * the user is connected to (production, a preview, or localhost).
 */

export async function verifyAssistantToken(req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await auth.auth.getClaims(bearer);
  if (error || !data?.claims) return undefined;
  const claims = data.claims as Record<string, unknown>;

  if (claims.role !== "authenticated" || typeof claims.sub !== "string") return undefined;
  if (typeof claims.iss === "string" && claims.iss !== supabaseAuthIssuer()) return undefined;

  const email = typeof claims.email === "string" ? claims.email : "";
  if (!isAssistantOwner(email)) {
    throw new OAuthError(OAuthErrorCode.InsufficientScope, "This account can't use the Map Organiser assistant.");
  }

  return {
    token: bearer,
    clientId: typeof claims.client_id === "string" ? claims.client_id : "supabase-session",
    scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
    expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
    extra: { userId: claims.sub, email, appUrl: appOrigin(req) },
  };
}
