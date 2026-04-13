import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { downloadAndStorePhoto } from "@/lib/google/places-api";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";

// GET /api/places - List all places for current user with filters
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const country = searchParams.get("country");
  const city = searchParams.get("city");
  const categoryId = searchParams.get("category");
  const tagIds = searchParams.get("tags")?.split(",").filter(Boolean);
  const listId = searchParams.get("list");
  const visitStatus = searchParams.get("status");
  const ratingMin = searchParams.get("rating");
  const googleRatingMin = searchParams.get("google_rating");
  const search = searchParams.get("q");

  let query = supabase
    .from("places")
    .select("*, category:categories(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (country) query = query.eq("country", country);
  if (city) query = query.eq("city", city);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (visitStatus) query = query.eq("visit_status", visitStatus);
  if (ratingMin) query = query.gte("rating", parseInt(ratingMin));
  if (search) query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,notes.ilike.%${search}%`);

  const { data: places, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let filteredPlaces = places || [];

  // Filter by Google rating (stored in JSONB, can't filter at query level)
  if (googleRatingMin) {
    const min = parseFloat(googleRatingMin);
    filteredPlaces = filteredPlaces.filter((p: any) => {
      const gr = p.google_data?.rating;
      return gr && gr >= min;
    });
  }

  // If filtering by tags, do a secondary filter

  if (tagIds && tagIds.length > 0) {
    const { data: taggedPlaceIds } = await supabase
      .from("place_tags")
      .select("place_id")
      .in("tag_id", tagIds);

    if (taggedPlaceIds) {
      const ids = new Set(taggedPlaceIds.map((t) => t.place_id));
      filteredPlaces = filteredPlaces.filter((p) => ids.has(p.id));
    }
  }

  // If filtering by list, do a secondary filter
  if (listId) {
    const { data: listPlaceIds } = await supabase
      .from("list_places")
      .select("place_id")
      .eq("list_id", listId);

    if (listPlaceIds) {
      const ids = new Set(listPlaceIds.map((lp) => lp.place_id));
      filteredPlaces = filteredPlaces.filter((p) => ids.has(p.id));
    }
  }

  // Post-filter: also match search in google_data reviews text
  if (search && filteredPlaces.length > 0) {
    const searchLower = search.toLowerCase();
    // Get IDs already matched by DB query
    const dbMatchIds = new Set(filteredPlaces.map((p) => p.id));
    // If we have places NOT matched by name/address/notes but matching review text,
    // we'd need a second query. For now, just filter existing results to include review matches.
    // The DB or() already filtered, so all results match. No extra filtering needed here.
    // But if we want to ALSO find places whose reviews match but name/address don't,
    // we need to fetch ALL places first. For performance, we skip that for now.
    // Instead, just keep existing behavior - DB handles name/address/notes search.
  }

  // Transform PostGIS geography to {lat, lng}
  const transformed = filteredPlaces.map((place) => ({
    ...place,
    location: place.location
      ? parsePostgisPoint(place.location)
      : { lat: 0, lng: 0 },
  }));

  return NextResponse.json(transformed);
}

// POST /api/places - Create a new place
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { googleApiKey } = await getUserApiKeys(user.id);

  const body = await request.json();
  const { name, address, country, city, lat, lng, category_id, rating, notes, google_place_id, google_data, source, tag_ids, list_ids, visit_status, photoRef } = body;

  if (!name || lat === undefined || lng === undefined) {
    return NextResponse.json(
      { error: "name, lat, and lng are required" },
      { status: 400 }
    );
  }

  // Check for duplicate google_place_id
  if (google_place_id) {
    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", user.id)
      .eq("google_place_id", google_place_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "This place is already saved", existingId: existing.id },
        { status: 409 }
      );
    }
  }

  // Auto-categorize from Google types if no category provided
  let resolvedCategoryId = category_id || null;
  const googleTypes: string[] = google_data?.types || [];
  if (!resolvedCategoryId && googleTypes.length > 0) {
    const { data: userCategories } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id);

    if (userCategories && userCategories.length > 0) {
      resolvedCategoryId = resolveCategoryId(googleTypes, userCategories, name);
    }
  }

  // Set date fields based on visit status
  const visited_at = visit_status === "visited" ? new Date().toISOString() : null;
  const booked_at = visit_status === "booked" ? new Date().toISOString() : null;

  // Build google_data - strip reviews (fetched on demand) and editorialSummary (removed)
  const savedGoogleData: Record<string, unknown> = { ...(google_data || {}) };
  delete savedGoogleData.reviews;
  delete savedGoogleData.editorialSummary;
  delete savedGoogleData.editorial_summary;
  // Keep only essential photo data - actual image stored in Supabase Storage
  delete savedGoogleData.photos;

  const { data: place, error } = await supabase
    .from("places")
    .insert({
      user_id: user.id,
      name,
      address,
      country,
      city,
      location: `POINT(${lng} ${lat})`,
      category_id: resolvedCategoryId,
      rating: rating || null,
      notes: notes || null,
      google_place_id: google_place_id || null,
      google_data: savedGoogleData,
      source: source || "manual",
      visit_status: visit_status || null,
      visited_at,
      booked_at,
    })
    .select("*, category:categories(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Download photo to Supabase Storage (1 photo only, $7/1K requests)
  if (photoRef && googleApiKey) {
    const storageUrl = await downloadAndStorePhoto(photoRef, place.id, user.id, googleApiKey);
    if (storageUrl) {
      await supabase
        .from("places")
        .update({
          google_data: { ...savedGoogleData, photo_storage_url: storageUrl },
        })
        .eq("id", place.id);
    }
  }

  // Add tags if provided
  if (tag_ids && tag_ids.length > 0) {
    await supabase.from("place_tags").insert(
      tag_ids.map((tagId: string) => ({
        place_id: place.id,
        tag_id: tagId,
      }))
    );
  }

  // Add to lists if provided
  if (list_ids && list_ids.length > 0) {
    await supabase.from("list_places").insert(
      list_ids.map((listId: string) => ({
        list_id: listId,
        place_id: place.id,
      }))
    );
  }

  return NextResponse.json({
    ...place,
    location: { lat, lng },
  });
}

/**
 * Parse PostGIS geography point to {lat, lng}.
 * Supabase REST API returns geography as hex EWKB string.
 */
function parseEWKB(hex: string): { lat: number; lng: number } | null {
  try {
    const buf = Buffer.from(hex, "hex");
    // EWKB: byte_order(1) + type(4) + srid(4) + x(8) + y(8)
    // Little-endian (01) or big-endian (00)
    const le = buf[0] === 1;
    const lng = le ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
    const lat = le ? buf.readDoubleLE(17) : buf.readDoubleBE(17);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  } catch {}
  return null;
}

function parsePostgisPoint(location: unknown): { lat: number; lng: number } {
  if (typeof location === "string") {
    // Hex EWKB format (from Supabase REST API)
    if (/^[0-9a-fA-F]+$/.test(location) && location.length > 20) {
      const parsed = parseEWKB(location);
      if (parsed) return parsed;
    }
    // WKT format: POINT(lng lat)
    const match = location.match(/POINT\((-?\d+\.?\d*)\s+(-?\d+\.?\d*)\)/);
    if (match) {
      return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
    // GeoJSON string
    try {
      const geo = JSON.parse(location);
      if (geo.coordinates) return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
    } catch {}
  }

  if (typeof location === "object" && location !== null) {
    const loc = location as Record<string, unknown>;
    if ("lat" in loc && "lng" in loc) {
      return { lat: Number(loc.lat), lng: Number(loc.lng) };
    }
    if ("coordinates" in loc && Array.isArray(loc.coordinates)) {
      return { lng: loc.coordinates[0], lat: loc.coordinates[1] };
    }
  }

  return { lat: 0, lng: 0 };
}
