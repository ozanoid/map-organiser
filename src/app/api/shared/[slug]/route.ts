import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePostgisPoint } from "@/lib/geo";
import { getRoute } from "@/lib/trip/directions";

// GET /api/shared/[slug] — public, no auth required
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient();
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
  }

  return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
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
      // Sort by list order and parse PostGIS
      const orderMap = new Map<string, number>(listPlaces.map((lp: any) => [lp.place_id, lp.sort_order ?? 0]));
      places = rawPlaces
        .map((p: any) => ({
          ...p,
          location: p.location ? parsePostgisPoint(p.location) : { lat: 0, lng: 0 },
        }))
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

      const places = (dayPlaces || []).map((dp: any) => ({
        ...dp,
        place: dp.place
          ? { ...dp.place, location: dp.place.location ? parsePostgisPoint(dp.place.location) : { lat: 0, lng: 0 } }
          : null,
      }));

      // Get route
      const coords = places
        .filter((dp: any) => dp.place?.location)
        .map((dp: any) => [dp.place.location.lng, dp.place.location.lat] as [number, number]);

      let route = null;
      if (coords.length >= 2) {
        route = await getRoute(coords, "walking");
      }

      return { ...day, places, route };
    })
  );

  return NextResponse.json({
    type: "trip",
    slug: link.slug,
    ownerName,
    trip: {
      ...trip,
      days: enrichedDays,
      day_count: enrichedDays.length,
      place_count: enrichedDays.reduce((s: number, d: any) => s + (d.places?.length || 0), 0),
    },
  });
}
