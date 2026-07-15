import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { trackUsage } from "@/lib/google/track-usage";

// POST /api/places/add-similar — NF-05 (v1.18.0): add a place from a
// "people also search" suggestion by CID. One DataForSEO business-info
// call per add (tracked as dataforseo_business_info_live). The insert
// mirrors import-batch's per-place block; the client then fires the
// standard enrich step=reviews chain (info is already covered — the
// biz-info lookup happens right here).
//
// Body: { cid: string, title?: string }
// 200 → { id }        · inserted
// 409 → { id }        · this CID already exists in the user's library
// 404 →               · DataForSEO returned nothing for the CID
const BodySchema = z.object({
  cid: z.string().min(1).max(40),
  title: z.string().max(200).optional(),
});

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "cid is required" }, { status: 400 });
  }
  const { cid, title } = parsed.data;

  const client = getDataForSEOClient();
  if (!client) {
    return NextResponse.json(
      { error: "DataForSEO not configured" },
      { status: 500 }
    );
  }

  // Dedup by stored CID (user-scoped — no cross-user reads).
  // KNOWN LIMIT (accepted): check-then-insert with no unique index behind
  // it (idx_places_google_id is non-unique) — two truly concurrent adds
  // of the same CID can both land. Single-user reality + the serialized
  // client (SimilarPlaces queues one add at a time) make this practical
  // noise; revisit if multi-user ever ships.
  const { data: existing } = await supabase
    .from("places")
    .select("id")
    .eq("user_id", user.id)
    .eq("google_data->>cid", cid)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ id: existing.id }, { status: 409 });
  }

  const raw = await fetchBusinessInfoLive(client, { keyword: `cid:${cid}` });
  trackUsage(user.id, "dataforseo_business_info_live").catch(() => {});
  if (!raw) {
    return NextResponse.json(
      { error: "Place not found for this suggestion" },
      { status: 404 }
    );
  }

  const placeData = transformBusinessInfoToPlaceData(raw);
  const extended = extractExtendedData(raw);
  if (!placeData.lat || !placeData.lng) {
    return NextResponse.json(
      { error: "Place has no coordinates" },
      { status: 422 }
    );
  }

  // Secondary dedup: the lookup may resolve to a google_place_id the user
  // already has under a different CID.
  if (placeData.placeId) {
    const { data: dupe } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", user.id)
      .eq("google_place_id", placeData.placeId)
      .maybeSingle();
    if (dupe) {
      return NextResponse.json({ id: dupe.id }, { status: 409 });
    }
  }

  const { data: userCategories } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id);

  const categoryId =
    placeData.types?.length && userCategories?.length
      ? resolveCategoryId(placeData.types, userCategories, placeData.name)
      : null;

  const googleData: Record<string, unknown> = {
    types: placeData.types,
    rating: placeData.rating,
    user_ratings_total: raw.rating?.votes_count,
    opening_hours: placeData.openingHours,
    website: placeData.website,
    phone: placeData.phone,
    price_level: placeData.priceLevel,
    url: placeData.googleMapsUrl,
    ...extended,
  };

  const { data: inserted, error } = await supabase
    .from("places")
    .insert({
      user_id: user.id,
      name: placeData.name || title || "Unknown place",
      address: placeData.address,
      country: placeData.country,
      city: placeData.city,
      location: `POINT(${placeData.lng} ${placeData.lat})`,
      google_place_id: placeData.placeId || null,
      google_data: googleData,
      category_id: categoryId,
      source: "similar",
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: error?.message || "Insert failed" },
      { status: 500 }
    );
  }

  // Photo — best-effort, mirrors import-batch.
  if (placeData.photoRef) {
    const url = await downloadAndStorePhotoFromUrl(
      placeData.photoRef,
      inserted.id,
      user.id
    );
    if (url) {
      await supabase
        .from("places")
        .update({ google_data: { ...googleData, photo_storage_url: url } })
        .eq("id", inserted.id);
    }
  }

  return NextResponse.json({ id: inserted.id }, { status: 200 });
}
