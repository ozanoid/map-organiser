import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";

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
  const categoryParam = searchParams.get("category");
  const categoryIds = categoryParam?.split(",").filter(Boolean);
  const tagIds = searchParams.get("tags")?.split(",").filter(Boolean);
  const listId = searchParams.get("list");
  const visitStatus = searchParams.get("status");
  const ratingMin = searchParams.get("rating");
  const googleRatingMin = searchParams.get("google_rating");
  const search = searchParams.get("q");
  const sort = searchParams.get("sort");

  // Determine sort field and direction
  const sortConfig: Record<string, { column: string; ascending: boolean }> = {
    newest: { column: "created_at", ascending: false },
    oldest: { column: "created_at", ascending: true },
    name_asc: { column: "name", ascending: true },
    name_desc: { column: "name", ascending: false },
    rating_desc: { column: "rating", ascending: false },
  };
  const { column: sortColumn, ascending: sortAscending } =
    sortConfig[sort || ""] ?? sortConfig.newest;

  let query = supabase
    .from("places")
    .select("*, category:categories(*)")
    .eq("user_id", user.id)
    .order(sortColumn, { ascending: sortAscending });

  if (country) query = query.eq("country", country);
  if (city) query = query.eq("city", city);
  if (categoryIds?.length) query = query.in("category_id", categoryIds);
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

  // Post-query sort for google_rating (stored in JSONB, can't sort at query level)
  if (sort === "google_rating_desc") {
    filteredPlaces.sort((a: any, b: any) => {
      const ra = a.google_data?.rating ?? 0;
      const rb = b.google_data?.rating ?? 0;
      return rb - ra;
    });
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

  // If photoRef exists (DataForSEO path), download photo immediately
  if (photoRef) {
    const { downloadAndStorePhotoFromUrl } = await import("@/lib/dataforseo/photo");
    const storageUrl = await downloadAndStorePhotoFromUrl(photoRef, place.id, user.id);
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
    const le = buf[0] === 1;
    const lng = le ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
    const lat = le ? buf.readDoubleLE(17) : buf.readDoubleBE(17);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  } catch {}
  return null;
}

function parsePostgisPoint(location: unknown): { lat: number; lng: number } {
  if (typeof location === "string") {
    if (/^[0-9a-fA-F]+$/.test(location) && location.length > 20) {
      const parsed = parseEWKB(location);
      if (parsed) return parsed;
    }
    const match = location.match(/POINT\((-?\d+\.?\d*)\s+(-?\d+\.?\d*)\)/);
    if (match) {
      return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
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
