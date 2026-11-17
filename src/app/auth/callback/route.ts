import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

function decoded(v: string | undefined): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` must stay on this site (safeNextPath) — "https://evil" or
  // "@evil.com" were followed before 17.11.2026.
  const fromCookie = (await cookies()).get(AUTH_NEXT_COOKIE)?.value;
  const next =
    safeNextPath(searchParams.get("next")) ?? safeNextPath(decoded(fromCookie)) ?? "/map";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(`${origin}${next}`);
      if (fromCookie) res.cookies.delete(AUTH_NEXT_COOKIE);
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
