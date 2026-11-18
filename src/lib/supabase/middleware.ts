import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-next";

export async function updateSession(request: NextRequest) {
  // Sign-ups are closed (the app has a single owner): old /signup links land
  // on the login page. Checked before the Supabase client is built — the
  // redirect needs no session work.
  if (request.nextUrl.pathname.startsWith("/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login
  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/auth/callback") ||
    request.nextUrl.pathname.startsWith("/shared/") ||
    request.nextUrl.pathname.startsWith("/api/shared/") ||
    // OAuth consent page: it sends signed-out visitors to /login with a
    // `next` that brings them back to the same authorization request.
    request.nextUrl.pathname.startsWith("/oauth/") ||
    // Cron runs with no cookie (Vercel sends CRON_SECRET as a bearer);
    // the route authenticates itself, so skip the session-redirect here.
    // Without this the cron 307-redirects to /login and never executes.
    request.nextUrl.pathname.startsWith("/api/cron/");

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Come back to this page after signing in — a plan link from Claude, the
    // iOS Shortcut's /map?add=… The login page and the auth callback follow
    // a same-site `next` (safeNextPath). Not for API calls: a fetch has no
    // page to come back to.
    if (!request.nextUrl.pathname.startsWith("/api/")) {
      url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    }
    return NextResponse.redirect(url);
  }

  // Signed in already: leave the login page for `next`, or the map.
  if (user && isAuthRoute) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next ?? "/map", request.url));
  }

  return supabaseResponse;
}
