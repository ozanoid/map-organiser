import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshPlaceGoogleData } from "@/lib/places/refresh-google-data";

/**
 * POST /api/places/[id]/refresh-google-data
 *
 * Manual "Refresh Google data": full DataForSEO re-lookup + newest-sorted
 * review merge. Core logic lives in src/lib/places/refresh-google-data.ts
 * (shared with the refresh cron); this route is the cookie-authed shell.
 *
 * Answers the updated place. `502` when the DataForSEO lookup failed (nothing
 * written). When only the reviews fetch failed, the place carries
 * `_reviews_failed: true` (v1.46.1) — the business info is fresh, the stored
 * reviews stayed — so the page can say so instead of a plain "refreshed".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshPlaceGoogleData(supabase, {
    placeId: id,
    userId: user.id,
    reviewSort: "newest",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Refresh failed" },
      { status: result.status ?? 500 }
    );
  }

  // Refreshed reviews should refresh the AI summary too — chain into
  // step=profile (fire-and-forget), mirroring enrich?step=reviews.
  if (result.totalReviews > 0) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("ai_features_enabled")
      .eq("id", user.id)
      .single();
    if (profileRow?.ai_features_enabled) {
      const origin = request.nextUrl.origin;
      const cookieHeader = request.headers.get("cookie") ?? "";
      void fetch(`${origin}/api/places/${id}/enrich?step=profile`, {
        method: "POST",
        headers: { cookie: cookieHeader, "Content-Type": "application/json" },
      }).catch((e) => {
        console.warn(
          `[refresh-google-data] profile chain failed for ${id}:`,
          e
        );
      });
    }
  }

  return NextResponse.json(
    result.reviewsFailed
      ? { ...(result.updated as Record<string, unknown>), _reviews_failed: true }
      : result.updated
  );
}
