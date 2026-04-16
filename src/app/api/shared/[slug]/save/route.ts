import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePostgisPoint } from "@/lib/geo";

// POST /api/shared/[slug]/save — save shared content to own account (auth required)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;

  const { data: link } = await supabase
    .from("shared_links")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  if (link.resource_type === "list") {
    return await saveList(supabase, link, user.id);
  } else if (link.resource_type === "trip") {
    return await saveTrip(supabase, link, user.id);
  }

  return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
}

async function saveList(supabase: any, link: any, userId: string) {
  // Fetch original list
  const { data: originalList } = await supabase
    .from("lists")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!originalList) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Create new list for this user
  const { data: newList, error: listError } = await supabase
    .from("lists")
    .insert({
      user_id: userId,
      name: originalList.name,
      description: originalList.description,
      color: originalList.color,
    })
    .select()
    .single();

  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  // Fetch original places
  const { data: listPlaces } = await supabase
    .from("list_places")
    .select("place_id, sort_order")
    .eq("list_id", link.resource_id)
    .order("sort_order", { ascending: true });

  if (listPlaces && listPlaces.length > 0) {
    const placeIds = listPlaces.map((lp: any) => lp.place_id);
    const { data: originalPlaces } = await supabase
      .from("places")
      .select("*")
      .in("id", placeIds);

    if (originalPlaces) {
      // Copy each place (skip if user already has it by google_place_id)
      for (const op of originalPlaces) {
        let targetPlaceId = op.id;

        // Check if user already has this place
        if (op.google_place_id) {
          const { data: existing } = await supabase
            .from("places")
            .select("id")
            .eq("user_id", userId)
            .eq("google_place_id", op.google_place_id)
            .maybeSingle();

          if (existing) {
            targetPlaceId = existing.id;
          } else {
            // Create copy
            const loc = parsePostgisPoint(op.location);
            const { data: newPlace } = await supabase
              .from("places")
              .insert({
                user_id: userId,
                name: op.name,
                address: op.address,
                country: op.country,
                city: op.city,
                location: `POINT(${loc.lng} ${loc.lat})`,
                notes: op.notes,
                google_place_id: op.google_place_id,
                google_data: op.google_data,
                source: "shared",
              })
              .select("id")
              .single();

            if (newPlace) targetPlaceId = newPlace.id;
          }
        } else {
          // No google_place_id — always copy
          const loc = parsePostgisPoint(op.location);
          const { data: newPlace } = await supabase
            .from("places")
            .insert({
              user_id: userId,
              name: op.name,
              address: op.address,
              country: op.country,
              city: op.city,
              location: `POINT(${loc.lng} ${loc.lat})`,
              notes: op.notes,
              google_data: op.google_data,
              source: "shared",
            })
            .select("id")
            .single();

          if (newPlace) targetPlaceId = newPlace.id;
        }

        // Add to new list
        const sortOrder = listPlaces.find((lp: any) => lp.place_id === op.id)?.sort_order ?? 0;
        await supabase.from("list_places").insert({
          list_id: newList.id,
          place_id: targetPlaceId,
          sort_order: sortOrder,
        });
      }
    }
  }

  return NextResponse.json({ type: "list", id: newList.id });
}

async function saveTrip(supabase: any, link: any, userId: string) {
  // Fetch original trip
  const { data: originalTrip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!originalTrip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Create new trip
  const { data: newTrip, error: tripError } = await supabase
    .from("trips")
    .insert({
      user_id: userId,
      name: originalTrip.name,
      start_date: originalTrip.start_date,
      end_date: originalTrip.end_date,
      color: originalTrip.color,
      notes: originalTrip.notes,
    })
    .select()
    .single();

  if (tripError) return NextResponse.json({ error: tripError.message }, { status: 500 });

  // Fetch original days
  const { data: originalDays } = await supabase
    .from("trip_days")
    .select("*")
    .eq("trip_id", link.resource_id)
    .order("day_number", { ascending: true });

  for (const day of originalDays || []) {
    // Create new day
    const { data: newDay } = await supabase
      .from("trip_days")
      .insert({
        trip_id: newTrip.id,
        day_number: day.day_number,
        date: day.date,
        notes: day.notes,
      })
      .select()
      .single();

    if (!newDay) continue;

    // Fetch day places
    const { data: dayPlaces } = await supabase
      .from("trip_day_places")
      .select("*, place:places(*)")
      .eq("trip_day_id", day.id)
      .order("sort_order", { ascending: true });

    for (const dp of dayPlaces || []) {
      if (!dp.place) continue;
      const op = dp.place;
      let targetPlaceId = op.id;

      // Check duplicate or copy
      if (op.google_place_id) {
        const { data: existing } = await supabase
          .from("places")
          .select("id")
          .eq("user_id", userId)
          .eq("google_place_id", op.google_place_id)
          .maybeSingle();

        if (existing) {
          targetPlaceId = existing.id;
        } else {
          const loc = parsePostgisPoint(op.location);
          const { data: newPlace } = await supabase
            .from("places")
            .insert({
              user_id: userId,
              name: op.name,
              address: op.address,
              country: op.country,
              city: op.city,
              location: `POINT(${loc.lng} ${loc.lat})`,
              google_place_id: op.google_place_id,
              google_data: op.google_data,
              source: "shared",
            })
            .select("id")
            .single();
          if (newPlace) targetPlaceId = newPlace.id;
        }
      } else {
        const loc = parsePostgisPoint(op.location);
        const { data: newPlace } = await supabase
          .from("places")
          .insert({
            user_id: userId,
            name: op.name,
            address: op.address,
            country: op.country,
            city: op.city,
            location: `POINT(${loc.lng} ${loc.lat})`,
            google_data: op.google_data,
            source: "shared",
          })
          .select("id")
          .single();
        if (newPlace) targetPlaceId = newPlace.id;
      }

      await supabase.from("trip_day_places").insert({
        trip_day_id: newDay.id,
        place_id: targetPlaceId,
        sort_order: dp.sort_order,
      });
    }
  }

  return NextResponse.json({ type: "trip", id: newTrip.id });
}
