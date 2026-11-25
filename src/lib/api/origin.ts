import "server-only";
import { getPublicOrigin } from "mcp-handler";

/**
 * The app's public origin for a request — what the user reached the server
 * at (production, a preview, or localhost), honouring forwarded headers.
 * Only http(s), else the request's own origin; parsed once, so a link built
 * on it can't throw later, after a tool has written. Tool results use it
 * for links back into the app (plans, lists, places).
 */
export function appOrigin(req: Request): string {
  try {
    const url = new URL(getPublicOrigin(req));
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // a forwarded host that doesn't parse
  }
  return new URL(req.url).origin;
}
