import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { trackUsage } from "@/lib/google/track-usage";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";

function extractCidFromUrl(url: string): string | null {
  const cidParam = url.match(/[?&]cid=(\d+)/);
  if (cidParam) return cidParam[1];
  const ftidMatch =
    url.match(/!1s0x[a-f0-9]+:(0x[a-f0-9]+)/) ||
    url.match(/ftid=0x[a-f0-9]+:(0x[a-f0-9]+)/);
  if (ftidMatch) {
    try { return BigInt(ftidMatch[1]).toString(); } catch {}
  }
  return null;
}

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

// POST /api/places/import-batch — enrich + insert a small batch (3 places)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = getDataForSEOClient();
  if (!client) {
    return NextResponse.json({ error: "DataForSEO not configured" }, { status: 500 });
  }

  const body = await request.json();
  const places = body.places || [];
  const visitStatus: string | null = body.visit_status || null;
  const listIds: string[] = body.list_ids || [];
  const tagIds: string[] = body.tag_ids || [];

  if (places.length === 0) {
    return NextResponse.json({ error: "No places" }, { status: 400 });
  }

  const { data: userCategories } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id);

  const results: Array<{
    name: string;
    status: "enriched" | "imported" | "skipped";
    reason?: string;
    placeId?: string;
  }> = [];

  for (const p of places) {
    try {
      let googleData: Record<string, unknown> = {};
      let googlePlaceId: string | null = null;
      let address = p.address;
      let country: string | null = null;
      let city: string | null = null;
      let lat = p.lat;
      let lng = p.lng;
      let categoryId: string | null = null;
      let photoRef: string | null = null;

      // Build keyword
      let keyword: string = p.name;
      let locationCoordinate: string | undefined;

      if (p.googleMapsUrl) {
        const parsed = await parseMapsUrl(p.googleMapsUrl);
        const cid = extractCidFromUrl(p.googleMapsUrl);
        if (cid) keyword = `cid:${cid}`;
        else if (parsed.placeId) keyword = `place_id:${parsed.placeId}`;
        else if (parsed.query) keyword = parsed.query;

        const biasLat = parsed.lat || lat;
        const biasLng = parsed.lng || lng;
        if (biasLat && biasLng) locationCoordinate = `${biasLat},${biasLng},1000`;
      } else if (lat && lng) {
        locationCoordinate = `${lat},${lng},1000`;
      }

      // DataForSEO
      const raw = await fetchBusinessInfoLive(client, { keyword, location_coordinate: locationCoordinate });

      if (raw) {
        const placeData = transformBusinessInfoToPlaceData(raw);
        const extended = extractExtendedData(raw);
        googlePlaceId = placeData.placeId || null;
        address = placeData.address || address;
        country = placeData.country || country;
        city = placeData.city || city;
        lat = placeData.lat || lat;
        lng = placeData.lng || lng;
        photoRef = placeData.photoRef ?? null;
        googleData = {
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
        if (placeData.types?.length && userCategories?.length) {
          categoryId = resolveCategoryId(placeData.types, userCategories, p.name);
        }
      }

      await trackUsage(user.id, "dataforseo_business_info_live");

      if (!lat || !lng) {
        results.push({ name: p.name, status: "skipped", reason: "No coordinates" });
        continue;
      }

      // Duplicate check
      if (googlePlaceId) {
        const { data: existing } = await supabase
          .from("places").select("id").eq("user_id", user.id).eq("google_place_id", googlePlaceId).maybeSingle();
        if (existing) {
          results.push({ name: p.name, status: "skipped", reason: "Already exists" });
          continue;
        }
      }

      // Insert
      const { data: inserted, error } = await supabase
        .from("places")
        .insert({
          user_id: user.id, name: p.name, address, country, city,
          location: `POINT(${lng} ${lat})`, notes: p.note,
          google_place_id: googlePlaceId, google_data: googleData,
          category_id: categoryId, source: "import",
          ...(visitStatus && { visit_status: visitStatus }),
          ...(visitStatus === "visited" && { visited_at: new Date().toISOString() }),
          ...(visitStatus === "booked" && { booked_at: new Date().toISOString() }),
        })
        .select("id").single();

      if (error || !inserted) {
        results.push({ name: p.name, status: "skipped", reason: error?.message || "Insert failed" });
        continue;
      }

      // Photo
      if (photoRef) {
        const url = await downloadAndStorePhotoFromUrl(photoRef, inserted.id, user.id);
        if (url) {
          await supabase.from("places").update({ google_data: { ...googleData, photo_storage_url: url } }).eq("id", inserted.id);
        }
      }

      // Lists + Tags
      if (listIds.length > 0) {
        await supabase.from("list_places").insert(listIds.map((lid) => ({ list_id: lid, place_id: inserted.id })));
      }
      if (tagIds.length > 0) {
        await supabase.from("place_tags").insert(tagIds.map((tid) => ({ tag_id: tid, place_id: inserted.id })));
      }

      results.push({ name: p.name, status: raw ? "enriched" : "imported", placeId: inserted.id });
    } catch {
      results.push({ name: p.name, status: "skipped", reason: "Unknown error" });
    }
  }

  return NextResponse.json({ results });
}
