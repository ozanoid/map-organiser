import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api/http";
import { listsOfPlaces } from "@/lib/lists/read";
import { setPlaceLists } from "@/lib/lists/write";
import { plansUsingPlaces } from "@/lib/plans/read";

// GET /api/places/[id]
export async function GET(
  _request: NextRequest,
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

  const { data: place, error } = await supabase
    .from("places")
    .select("*, category:categories(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  // Get tags
  const { data: placeTags } = await supabase
    .from("place_tags")
    .select("tag_id, tags(*)")
    .eq("place_id", id);

  // The lists it is on, each with the place's note there.
  const lists = (await listsOfPlaces({ supabase, userId: user.id }, [id])).get(id) ?? [];

  // Get photos
  const { data: photos } = await supabase
    .from("place_photos")
    .select("*")
    .eq("place_id", id)
    .order("created_at", { ascending: false });

  // The plans this place is a stop of — the delete warning names them.
  const { plans } = await plansUsingPlaces({ supabase, userId: user.id }, [id]);

  return NextResponse.json({
    ...place,
    location: parseLocation(place.location),
    tags: placeTags?.map((pt) => pt.tags) || [],
    lists,
    plans,
    photos: photos || [],
  });
}

// PATCH /api/places/[id]
export async function PATCH(
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

  const body = await request.json();
  const { name, address, category_id, rating, notes, visit_status, tag_ids, list_ids } = body;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (category_id !== undefined) updates.category_id = category_id || null;
  if (rating !== undefined) updates.rating = rating || null;
  if (notes !== undefined) updates.notes = notes || null;

  // Visit status logic
  if (visit_status !== undefined) {
    updates.visit_status = visit_status || null;

    if (visit_status === "visited") {
      // Fetch current place to check if visited_at is already set
      const { data: current } = await supabase
        .from("places")
        .select("visited_at")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (!current?.visited_at) {
        updates.visited_at = new Date().toISOString();
      }
    } else if (visit_status === "booked") {
      const { data: current } = await supabase
        .from("places")
        .select("booked_at")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (!current?.booked_at) {
        updates.booked_at = new Date().toISOString();
      }
    } else if (visit_status === null || visit_status === "want_to_go") {
      updates.visited_at = null;
      updates.booked_at = null;
    }
  }

  const { data: place, error } = await supabase
    .from("places")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, category:categories(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sync tags if provided
  if (tag_ids !== undefined) {
    await supabase.from("place_tags").delete().eq("place_id", id);
    if (tag_ids.length > 0) {
      await supabase.from("place_tags").insert(
        tag_ids.map((tagId: string) => ({
          place_id: id,
          tag_id: tagId,
        }))
      );
    }
  }

  // Lists, if given, are the place's lists from now on. Only the lists that
  // change are written (src/lib/lists): on the others the place keeps its
  // position and its note.
  if (list_ids !== undefined) {
    try {
      await setPlaceLists({ supabase, userId: user.id }, id, list_ids);
    } catch (e) {
      return errorResponse(e, "places.lists");
    }
  }

  return NextResponse.json({
    ...place,
    location: parseLocation(place.location),
  });
}

// DELETE /api/places/[id]
export async function DELETE(
  _request: NextRequest,
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

  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

function parseLocation(location: unknown): { lat: number; lng: number } {
  if (typeof location === "string") {
    const match = location.match(/POINT\((-?\d+\.?\d*)\s+(-?\d+\.?\d*)\)/);
    if (match) return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  }
  if (typeof location === "object" && location !== null) {
    const loc = location as Record<string, unknown>;
    if ("coordinates" in loc && Array.isArray(loc.coordinates)) {
      return { lng: loc.coordinates[0], lat: loc.coordinates[1] };
    }
  }
  return { lat: 0, lng: 0 };
}
