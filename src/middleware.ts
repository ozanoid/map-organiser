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
    // session check redirected them to /login.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
