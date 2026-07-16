import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parsePostgisPoint } from "@/lib/geo";
import { getRoute } from "@/lib/trip/directions";
import { trackUsage } from "@/lib/google/track-usage";

/**
 * v1.22.0: EVERY place embedded in a public payload goes through this
 * whitelist — not just the single-place share. The service client
 * bypasses RLS, and a full `places(*)` passthrough leaks owner-personal
 * fields (user_id, visit_status, timestamps, source) plus the sensitive
 * google_data bulk (reviews, place_profile, work_timetable). Worse, a
 * foreign place attached to a trip (place-ownership gaps) would leak the
 * VICTIM's row. Keep in sync with what SharedListView/SharedTripView/
 * SharedPlaceView actually render.
 */
function publicPlaceProjection(p: any) {
  if (!p) return null;
  const gd = p.google_data ?? {};
  return {
    id: p.id,
    name: p.name,
    address: p.address ?? null,
    city: p.city ?? null,
    country: p.country ?? null,
    notes: p.notes ?? null,
    rating: p.rating ?? null,
    category: p.category
      ? { name: p.category.name, color: p.category.color }
      : null,
    location: p.location ? parsePostgisPoint(p.location) : { lat: 0, lng: 0 },
    google_data: {
      photo_storage_url: gd.photo_storage_url ?? null,
      rating: gd.rating ?? null,
      user_ratings_total: gd.user_ratings_total ?? null,
      opening_hours: gd.opening_hours ?? null,
      website: gd.website ?? null,
      url: gd.url ?? null,
    },
  };
}

// GET /api/shared/[slug] — public, no auth required
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = createServiceClient();
  const { slug } = await params;

  // Lookup active shared link
  const { data: link } = await supabase
    .from("shared_links")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!link) {
    return NextResponse.json({ error: "Link not found or inactive" }, { status: 404 });
  }

  // Increment view count (fire-and-forget)
  supabase
    .from("shared_links")
    .update({ view_count: (link.view_count || 0) + 1 })
    .eq("id", link.id)
    .then(() => {});

  // Fetch owner name
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", link.user_id)
    .maybeSingle();

  const ownerName = profile?.full_name || "Someone";

  if (link.resource_type === "list") {
    return await handleListShare(supabase, link, ownerName);
  } else if (link.resource_type === "trip") {
    return await handleTripShare(supabase, link, ownerName);
  } else if (link.resource_type === "place") {
    return await handlePlaceShare(supabase, link, ownerName);
  }

  return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
}

// NF-18 (v1.20.0): single-place public payload. Deliberate deviation
// from the list/trip full-row passthrough: the payload is a WHITELIST of
// exactly what SharedPlaceView renders. Owner-personal fields
// (user_id, rating, visit_status, booked_at/visited_at, source,
// timestamps) and heavy/private google_data (reviews, place_profile,
// work_timetable, attributes, topics) never leave the server — this is
// an unauthenticated URL. `notes` stays (consistent with list shares;
// sharing is a deliberate act).
async function handlePlaceShare(supabase: any, link: any, ownerName: string) {
  const { data: place } = await supabase
    .from("places")
    .select("*, category:categories(name, color)")
    .eq("id", link.resource_id)
    .single();

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const gd = (place.google_data ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    type: "place",
    slug: link.slug,
    ownerName,
    place: {
      id: place.id,
      name: place.name,
      address: place.address,
      city: place.city,
      country: place.country,
      notes: place.notes,
      category: place.category
        ? { name: place.category.name, color: place.category.color }
        : null,
      google_data: {
        photo_storage_url: gd.photo_storage_url ?? null,
        rating: gd.rating ?? null,
        user_ratings_total: gd.user_ratings_total ?? null,
        opening_hours: gd.opening_hours ?? null,
        website: gd.website ?? null,
        url: gd.url ?? null,
      },
      location: place.location
        ? parsePostgisPoint(place.location)
        : { lat: 0, lng: 0 },
    },
  });
}

async function handleListShare(supabase: any, link: any, ownerName: string) {
  // Fetch list
  const { data: list } = await supabase
    .from("lists")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!list) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Fetch places in list
  const { data: listPlaces } = await supabase
    .from("list_places")
    .select("place_id, sort_order")
    .eq("list_id", list.id)
    .order("sort_order", { ascending: true });

  let places: any[] = [];
  if (listPlaces && listPlaces.length > 0) {
    const placeIds = listPlaces.map((lp: any) => lp.place_id);
    const { data: rawPlaces } = await supabase
      .from("places")
      .select("*, category:categories(*)")
      .in("id", placeIds);

    if (rawPlaces) {
      // Sort by list order; project through the public whitelist.
      const orderMap = new Map<string, number>(listPlaces.map((lp: any) => [lp.place_id, lp.sort_order ?? 0]));
      places = rawPlaces
        .map((p: any) => publicPlaceProjection(p))
        .sort((a: any, b: any) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }
  }

  return NextResponse.json({
    type: "list",
    slug: link.slug,
    ownerName,
    list,
    places,
  });
}

async function handleTripShare(supabase: any, link: any, ownerName: string) {
  // Fetch trip
  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Fetch days
  const { data: days } = await supabase
    .from("trip_days")
    .select("*")
    .eq("trip_id", trip.id)
    .order("day_number", { ascending: true });

  // Fetch places for each day with routes
  const enrichedDays = await Promise.all(
    (days || []).map(async (day: any) => {
      const { data: dayPlaces } = await supabase
        .from("trip_day_places")
        .select("*, place:places(*, category:categories(*))")
        .eq("trip_day_id", day.id)
        .order("sort_order", { ascending: true });

      // NF-08 (v1.22.0): cost_estimate/currency are the owner's private
      // budget planning — never in the public payload; and the embedded
      // place row goes through the same whitelist as every public place.
      const places = (dayPlaces || []).map((dp: any) => {
        const { cost_estimate: _c, currency: _cur, ...rest } = dp;
        return {
          ...rest,
          place: publicPlaceProjection(dp.place),
        };
      });

      // Get route
      const coords = places
        .filter((dp: any) => dp.place?.location)
        .map((dp: any) => [dp.place.location.lng, dp.place.location.lat] as [number, number]);

      let route = null;
      if (coords.length >= 2) {
        // NF-07 (v1.22.0): honour the day's routing_profile on the public
        // view too; the anonymous Directions call is attributed to the
        // link OWNER (their share, their quota).
        route = await getRoute(coords, day.routing_profile ?? "walking");
        // after(): a loose fire-and-forget can be frozen with the
        // serverless instance before the RPC settles.
        after(() =>
          trackUsage(link.user_id, "mapbox_directions", supabase).catch(() => {})
        );
      }

      return { ...day, places, route };
    })
  );

  // party_size is owner-private budget context — strip from public view.
  const { party_size: _ps, ...publicTrip } = trip;

  return NextResponse.json({
    type: "trip",
    slug: link.slug,
    ownerName,
    trip: {
      ...publicTrip,
      days: enrichedDays,
      day_count: enrichedDays.length,
      place_count: enrichedDays.reduce((s: number, d: any) => s + (d.places?.length || 0), 0),
    },
  });
}
