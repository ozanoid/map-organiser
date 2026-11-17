import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals, images, and the public files a signed-out
    // visitor must still load: the service worker, the PWA manifest and the
    // offline page the service worker precaches. Sending those through the
    // session check redirected them to /login. Also skipped: the MCP
    // endpoint (/api/mcp authenticates its own bearer tokens and must answer
    // 401, not a redirect) and the .well-known metadata documents.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|api/mcp$|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
