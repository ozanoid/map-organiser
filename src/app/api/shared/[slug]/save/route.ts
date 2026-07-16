import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  // Link lookup works on the cookie client via the public-read policy
  // (is_active = true). The ORIGINAL content does not: lists/trips/places
  // only have owner-scoped RLS, so cross-user reads must go through the
  // service client (`admin`). Inserts stay on the cookie client so RLS
  // WITH CHECK enforces user_id ownership.
  const { data: link } = await supabase
    .from("shared_links")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const admin = createServiceClient();

  if (link.resource_type === "list") {
    return await saveList(supabase, admin, link, user.id);
  } else if (link.resource_type === "trip") {
    return await saveTrip(supabase, admin, link, user.id);
  } else if (link.resource_type === "place") {
    return await savePlace(supabase, admin, link, user.id);
  }

  return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
}

// NF-18 (v1.20.0): copy ONE shared place into the visitor's account —
// the same per-place copy/dedupe block the list saver uses. Copies omit
// rating/visit_status/category (categories are per-user), matching the
// existing savers. Requires places_source_check to include 'shared'
// (widened in the same release — the check had never included it and
// the copy path was latently broken since April).
async function savePlace(supabase: any, admin: any, link: any, userId: string) {
  const { data: op } = await admin
    .from("places")
    .select("*")
    .eq("id", link.resource_id)
    .single();

  if (!op) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  // Dedupe by google_place_id when present. Check-then-insert without a
  // unique constraint (idx_places_google_id is non-unique) — a concurrent
  // double-tap can produce a duplicate copy; accepted, matches the
  // list/trip savers' posture.
  if (op.google_place_id) {
    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", userId)
      .eq("google_place_id", op.google_place_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ type: "place", id: existing.id, deduped: true });
    }
  }

  const loc = parsePostgisPoint(op.location);
  const { data: newPlace, error } = await supabase
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

  if (error || !newPlace) {
    return NextResponse.json(
      { error: error?.message || "Failed to save place" },
      { status: 500 }
    );
  }

  return NextResponse.json({ type: "place", id: newPlace.id });
}

async function saveList(supabase: any, admin: any, link: any, userId: string) {
  // Fetch original list (service client — owner-scoped RLS blocks the
  // visitor's session; this cross-user read had 404'd since April)
  const { data: originalList } = await admin
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

  // Fetch original places (service client — cross-user rows)
  const { data: listPlaces } = await admin
    .from("list_places")
    .select("place_id, sort_order")
    .eq("list_id", link.resource_id)
    .order("sort_order", { ascending: true });

  if (listPlaces && listPlaces.length > 0) {
    const placeIds = listPlaces.map((lp: any) => lp.place_id);
    const { data: originalPlaces } = await admin
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

async function saveTrip(supabase: any, admin: any, link: any, userId: string) {
  // Fetch original trip (service client — owner-scoped RLS blocks the
  // visitor's session; this cross-user read had 404'd since April)
  const { data: originalTrip } = await admin
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

  // Fetch original days (service client — cross-user rows)
  const { data: originalDays } = await admin
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

    // Fetch day places (service client — cross-user rows)
    const { data: dayPlaces } = await admin
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
