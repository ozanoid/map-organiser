import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import { queryPlaces } from "@/lib/places/query-places";
import { log } from "@/lib/telemetry/logger";

// GET /api/places - List all places for current user with filters
//
// v1.21.0 (S3 AI-02): the query engine moved verbatim to
// src/lib/places/query-places.ts so the assistant's search_places tool
// shares it. This handler is now a thin param-mapping shell. Behavioural
// notes (PostgREST or() quoting, JS post-filters, Phase 6.5 f_* removal,
// the v1.19.0 ids= compare fetch) live with the code in the lib file.
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
  const categoryIds = searchParams.get("category")?.split(",").filter(Boolean);
  const subcategoryIds = searchParams
    .get("subcategory")
    ?.split(",")
    .filter(Boolean);
  const tagIds = searchParams.get("tags")?.split(",").filter(Boolean);
  const listId = searchParams.get("list");
  const visitStatus = searchParams.get("status");
  const ratingMin = searchParams.get("rating");
  const googleRatingMin = searchParams.get("google_rating");
  const search = searchParams.get("q");
  const sort = searchParams.get("sort");
  const idsParam = searchParams.get("ids");

  let result;
  try {
    result = await queryPlaces(supabase, user.id, {
      ids: idsParam ? idsParam.split(",") : undefined,
      country: country ?? undefined,
      city: city ?? undefined,
      categoryIds,
      subcategoryIds,
      tagIds,
      listId: listId ?? undefined,
      visitStatus: visitStatus ?? undefined,
      ratingMin: ratingMin ? parseInt(ratingMin) : undefined,
      googleRatingMin: googleRatingMin ? parseFloat(googleRatingMin) : undefined,
      search: search ?? undefined,
      sort: sort ?? undefined,
      openNow: searchParams.get("open_now") === "true",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }

  // ─── Phase 6.5 diagnostic logging ───
  // Only log when AI-search-relevant params are present, to avoid
  // spamming the normal browsing path. The presence of `city` is the
  // best proxy for "this is an AI search call" — manual filter UI
  // typically picks country+city via the cascade, while AI search
  // sets city directly.
  //
  // Structured so Axiom can correlate with the parent ai.parse-query
  // log via traceId — one AI search session's full pipeline shows up
  // as a single timeline.
  if (city) {
    log.info("api.places", {
      userId: user.id,
      filters: {
        country: country ?? null,
        city: city ?? null,
        categories: categoryIds?.length ?? 0,
        subcategories: subcategoryIds?.length ?? 0,
        tags: tagIds?.length ?? 0,
        status: visitStatus ?? null,
        rating: ratingMin ?? null,
        g_rating: googleRatingMin ?? null,
        search: search ?? null,
        sort: sort ?? "newest",
      },
      sql_rows: result.sqlRows,
      returned: result.places.length,
    });
  }

  return NextResponse.json(result.places);
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
  const { name, address, country, city, lat, lng, category_id, subcategory_id, rating, notes, google_place_id, google_data, source, tag_ids, list_ids, visit_status, photoRef } = body;

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
      subcategory_id: subcategory_id || null,
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
