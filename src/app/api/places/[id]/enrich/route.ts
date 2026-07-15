import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import { fetchReviews } from "@/lib/dataforseo/reviews";
import {
  transformReviews,
  extractExtendedData,
  mergeReviews,
} from "@/lib/dataforseo/transform";
import type { GoogleReview } from "@/lib/types";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import { trackUsage } from "@/lib/google/track-usage";
import { generatePlaceProfile } from "@/lib/ai/generate-profile";

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

/**
 * POST /api/places/[id]/enrich?step=info|reviews|profile
 *
 * step=info     → biz info + photo + extended data (~3-4s). Client awaits.
 * step=reviews  → reviews via CID (~30s). Client fire-and-forgets. On
 *                 success, fire-and-forgets step=profile (Phase 4) when
 *                 ai_features_enabled.
 * step=profile  → Gemini Flash structured-output call that produces the
 *                 full place_profile (Phase 4). Auto-applies matched_existing
 *                 tags/lists/sub-cats; queues new_proposals for moderation.
 *
 * DataForSEO path (provider=dataforseo): step=reviews only (rest already saved).
 * Google path: client calls step=info first, then step=reviews.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const step = request.nextUrl.searchParams.get("step");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getDataForSEOClient();
  if (!client) {
    return NextResponse.json({ error: "DataForSEO not configured" }, { status: 400 });
  }

  const { data: place } = await supabase
    .from("places")
    .select("google_place_id, google_data, country")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const googleData = (place.google_data as Record<string, unknown>) || {};
  const googlePlaceId = place.google_place_id || "";
  const country = place.country || "United States";

  // ─── step=info: biz info + photo + extended data ───
  if (step === "info") {
    if (!googlePlaceId) {
      return NextResponse.json({ error: "No place ID" }, { status: 400 });
    }

    const keyword = googlePlaceId.startsWith("ChIJ")
      ? `place_id:${googlePlaceId}`
      : `cid:${googlePlaceId}`;

    console.log(`[enrich:info] Starting for ${id}, keyword: ${keyword}`);

    const raw = await fetchBusinessInfoLive(client, { keyword, location_name: country });
    trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});

    if (raw) {
      const extended = extractExtendedData(raw);
      console.log(`[enrich:info] Received, cid: ${raw.cid}, main_image: ${!!raw.main_image}`);

      const { data: cur } = await supabase.from("places").select("google_data").eq("id", id).single();
      const curData = (cur?.google_data as Record<string, unknown>) || {};
      const merged = { ...curData, ...extended };

      if (!curData.photo_storage_url && raw.main_image) {
        const photoUrl = await downloadAndStorePhotoFromUrl(raw.main_image, id, user.id);
        if (photoUrl) merged.photo_storage_url = photoUrl;
        console.log(`[enrich:info] Photo: ${photoUrl ? "saved" : "failed"}`);
      }

      await supabase.from("places").update({ google_data: merged }).eq("id", id);
      console.log(`[enrich:info] Done for ${id}`);

      return NextResponse.json({ ok: true, cid: raw.cid || null });
    }

    return NextResponse.json({ ok: false, error: "Biz info returned null" });
  }

  // ─── step=reviews: fetch reviews via CID ───
  if (step === "reviews") {
    // CID can come from google_data (DataForSEO path) or from request body (Google path)
    const body = await request.json().catch(() => ({}));
    const cid = (body as any)?.cid || (googleData.cid as string) || null;

    if (!cid) {
      return NextResponse.json({ error: "No CID available" }, { status: 400 });
    }

    console.log(`[enrich:reviews] Starting for ${id}, cid: ${cid}`);

    const rawReviews = await fetchReviews(client, {
      cid,
      depth: 50,
      location_name: country,
    });

    if (rawReviews.length > 0) {
      const reviews = transformReviews(rawReviews);
      trackUsage(user.id, "dataforseo_reviews").catch(() => {});

      const { data: cur } = await supabase.from("places").select("google_data").eq("id", id).single();
      const curData = (cur?.google_data as Record<string, unknown>) || {};
      // Merge, don't replace — re-runs accumulate the corpus. This fetch
      // uses the default "relevant" sort, so it establishes/refreshes the
      // relevance backbone (see mergeReviews).
      const merged = mergeReviews(
        (curData.reviews as GoogleReview[] | undefined) ?? [],
        reviews,
        { incomingOrder: "relevant" }
      );
      await supabase.from("places").update({ google_data: { ...curData, reviews: merged } }).eq("id", id);
      console.log(`[enrich:reviews] ${reviews.length} fetched, ${merged.length} stored for ${id}`);

      // ─── Phase 4: chain into profile generation (fire-and-forget) ───
      // Gated by ai_features_enabled. Errors here never affect the reviews
      // response — the chain is best-effort.
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
          console.warn(`[enrich:reviews] profile chain failed for ${id}:`, e);
        });
      }
    }

    return NextResponse.json({ ok: true, reviews: rawReviews.length });
  }

  // ─── step=profile: Gemini Flash full place_profile ───
  // Logic extracted to src/lib/ai/generate-profile.ts (15.07.2026) so the
  // refresh cron can run it with the service client. This branch is the
  // cookie-authed HTTP shell; response shapes are unchanged.
  if (step === "profile") {
    const outcome = await generatePlaceProfile(supabase, user.id, id);
    if (outcome.ok) {
      return NextResponse.json({ ok: true, applied: outcome.applied });
    }
    switch (outcome.reason) {
      case "ai_disabled":
        return NextResponse.json(
          { error: "AI features disabled" },
          { status: 403 }
        );
      case "not_configured":
        return NextResponse.json(
          { error: "AI not configured (GOOGLE_GENERATIVE_AI_API_KEY missing)" },
          { status: 503 }
        );
      case "cap_exceeded":
        return NextResponse.json(
          {
            error: "Monthly AI profile limit reached (1000). Resets on the 1st.",
            used: outcome.capUsed,
            cap: outcome.capLimit,
          },
          { status: 429 }
        );
      case "no_reviews":
        return NextResponse.json(
          { ok: false, reason: "no_reviews" },
          { status: 400 }
        );
      case "not_found":
        return NextResponse.json({ error: "Place not found" }, { status: 404 });
      case "llm_failed":
      default:
        return NextResponse.json(
          { ok: false, error: "LLM generation failed" },
          { status: 500 }
        );
    }
  }

  return NextResponse.json(
    { error: "step parameter required (info, reviews, or profile)" },
    { status: 400 }
  );
}
