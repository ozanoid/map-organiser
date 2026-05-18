import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import { fetchReviews } from "@/lib/dataforseo/reviews";
import {
  transformReviews,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import { trackUsage } from "@/lib/google/track-usage";
import {
  getAiClient,
  FLASH_MODEL,
  MODEL_VERSION,
} from "@/lib/ai/client";
import { buildUserContext } from "@/lib/ai/context-builder";
import { PlaceProfileSchema } from "@/lib/ai/schemas/place-profile";
import { buildPlaceProfilePrompt } from "@/lib/ai/prompts/place-profile-full";
import { applyProfileSuggestions } from "@/lib/ai/apply-suggestions";
import { trackAiUsage } from "@/lib/ai/track-usage";

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
      await supabase.from("places").update({ google_data: { ...curData, reviews } }).eq("id", id);
      console.log(`[enrich:reviews] ${reviews.length} reviews saved for ${id}`);

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
  if (step === "profile") {
    // Auth gate: ai_features_enabled flag check
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("ai_features_enabled")
      .eq("id", user.id)
      .single();
    if (!profileRow?.ai_features_enabled) {
      return NextResponse.json({ error: "AI features disabled" }, { status: 403 });
    }

    const aiClient = getAiClient();
    if (!aiClient) {
      return NextResponse.json(
        { error: "AI not configured (GOOGLE_GENERATIVE_AI_API_KEY missing)" },
        { status: 503 }
      );
    }

    const reviewsArr =
      (googleData as { reviews?: unknown[] }).reviews ?? [];
    if (!Array.isArray(reviewsArr) || reviewsArr.length === 0) {
      // Without reviews, the prompt is starved; defer to a future re-run.
      return NextResponse.json(
        { ok: false, reason: "no_reviews" },
        { status: 400 }
      );
    }

    // Fetch the full place row (we need name/address/city/country for the prompt)
    const { data: placeFull } = await supabase
      .from("places")
      .select("name, address, city, country, google_data, category_id, subcategory_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!placeFull) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const userContext = await buildUserContext(supabase, user.id);
    const liteForPrior =
      (placeFull.google_data as Record<string, unknown> | null)?.place_profile ??
      undefined;

    const { systemPrompt, userPrompt } = buildPlaceProfilePrompt(
      {
        name: placeFull.name as string,
        address: (placeFull.address as string | null) ?? null,
        city: (placeFull.city as string | null) ?? null,
        country: (placeFull.country as string | null) ?? null,
        google_data: (placeFull.google_data as Record<string, unknown>) ?? {},
      },
      userContext,
      liteForPrior
    );

    console.log(`[enrich:profile] Calling Gemini for ${id}…`);

    let profile;
    try {
      const result = await generateText({
        model: aiClient(FLASH_MODEL),
        output: Output.object({ schema: PlaceProfileSchema }),
        system: systemPrompt,
        prompt: userPrompt,
      });
      profile = result.output;
    } catch (e) {
      console.error(`[enrich:profile] LLM call failed for ${id}:`, e);
      return NextResponse.json(
        { ok: false, error: "LLM generation failed" },
        { status: 500 }
      );
    }

    // Force-stamp meta fields the LLM might miss / get wrong.
    profile.completeness = "full";
    profile.generated_at = new Date().toISOString();
    profile.model_version = MODEL_VERSION;
    profile.source_review_count = reviewsArr.length;

    // Persist into google_data.place_profile
    const { data: cur } = await supabase
      .from("places")
      .select("google_data")
      .eq("id", id)
      .single();
    const curData = (cur?.google_data as Record<string, unknown>) || {};
    await supabase
      .from("places")
      .update({
        google_data: { ...curData, place_profile: profile },
      })
      .eq("id", id);

    // Resolve parent category_id by name match (LLM returns the NAME)
    const parentCat = userContext.categories.find(
      (c) => c.name === profile.category_signals.primary
    );

    // 3-band auto-apply
    const applied = await applyProfileSuggestions(supabase, profile, {
      userId: user.id,
      placeId: id,
      tags: userContext.tags.map(({ id: tagId, name }) => ({ id: tagId, name })),
      subcategories: userContext.subcategories.map((s) => ({
        id: s.id,
        slug: s.slug,
        parent_category_id: s.parent_category_id,
      })),
      parentCategoryId: parentCat?.id ?? null,
      modelVersion: MODEL_VERSION,
    });

    trackAiUsage(user.id, "ai_place_profile").catch(() => {});

    console.log(
      `[enrich:profile] Done for ${id}: tagsApplied=${applied.tagsApplied} tagsQueued=${applied.tagsQueued} subCat=${applied.subcategoryApplied ?? applied.subcategoryQueued ?? "none"}`
    );

    return NextResponse.json({ ok: true, applied });
  }

  return NextResponse.json(
    { error: "step parameter required (info, reviews, or profile)" },
    { status: 400 }
  );
}
