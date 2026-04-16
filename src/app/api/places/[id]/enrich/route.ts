import { NextRequest, NextResponse } from "next/server";
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

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

/**
 * POST /api/places/[id]/enrich?step=info|reviews
 *
 * step=info  → biz info + photo + extended data (~3-4s). Client awaits this.
 * step=reviews → reviews via CID (~30s). Client fire-and-forgets this.
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
    }

    return NextResponse.json({ ok: true, reviews: rawReviews.length });
  }

  return NextResponse.json({ error: "step parameter required (info or reviews)" }, { status: 400 });
}
