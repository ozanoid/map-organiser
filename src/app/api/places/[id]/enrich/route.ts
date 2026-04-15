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
 * POST /api/places/[id]/enrich
 *
 * Called by client after save. Runs DataForSEO enrichment in its own
 * function instance so it doesn't get killed when POST /api/places returns.
 *
 * Two modes based on request body:
 * - fullEnrichment=true (Google path): biz info (photo + extended) + reviews
 * - fullEnrichment=false (DataForSEO path): reviews only via CID
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
  const cid = googleData.cid as string | undefined;
  const country = place.country || "United States";
  const isFromDataForSEO = googleData.provider === "dataforseo";

  console.log(`[enrich] Starting for ${id}, provider=${googleData.provider}, cid=${cid}, placeId=${googlePlaceId}`);

  // ─── DataForSEO path: reviews only (extended data + photo already saved) ───
  if (isFromDataForSEO && cid) {
    console.log(`[enrich] DataForSEO path: reviews only, cid: ${cid}`);

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
      console.log(`[enrich] ${reviews.length} reviews saved`);
    }

    return NextResponse.json({ ok: true, reviews: rawReviews.length });
  }

  // ─── Google path: full enrichment (biz info + photo + extended + reviews) ───
  if (googlePlaceId) {
    const keyword = googlePlaceId.startsWith("ChIJ")
      ? `place_id:${googlePlaceId}`
      : `cid:${googlePlaceId}`;

    console.log(`[enrich] Google path: full enrichment, keyword: ${keyword}`);

    // Step 1: Business info via Live
    const raw = await fetchBusinessInfoLive(client, { keyword, location_name: country });
    trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});

    let resolvedCid: string | null = null;

    if (raw) {
      resolvedCid = raw.cid || null;
      const extended = extractExtendedData(raw);
      console.log(`[enrich] Biz info received, cid: ${resolvedCid}, main_image: ${!!raw.main_image}`);

      const { data: cur } = await supabase.from("places").select("google_data").eq("id", id).single();
      const curData = (cur?.google_data as Record<string, unknown>) || {};
      const merged = { ...curData, ...extended };

      if (!curData.photo_storage_url && raw.main_image) {
        const photoUrl = await downloadAndStorePhotoFromUrl(raw.main_image, id, user.id);
        if (photoUrl) merged.photo_storage_url = photoUrl;
        console.log(`[enrich] Photo: ${photoUrl ? "saved" : "failed"}`);
      }

      await supabase.from("places").update({ google_data: merged }).eq("id", id);
      console.log("[enrich] Extended data saved");
    }

    // Step 2: Reviews via CID
    if (resolvedCid) {
      const rawReviews = await fetchReviews(client, {
        cid: resolvedCid,
        depth: 50,
        location_name: country,
      });

      if (rawReviews.length > 0) {
        const reviews = transformReviews(rawReviews);
        trackUsage(user.id, "dataforseo_reviews").catch(() => {});

        const { data: cur } = await supabase.from("places").select("google_data").eq("id", id).single();
        const curData = (cur?.google_data as Record<string, unknown>) || {};
        await supabase.from("places").update({ google_data: { ...curData, reviews } }).eq("id", id);
        console.log(`[enrich] ${reviews.length} reviews saved`);
      }
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to enrich" }, { status: 400 });
}
