import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Get photos
  const { data: photos } = await supabase
    .from("place_photos")
    .select("*")
    .eq("place_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    ...place,
    location: parseLocation(place.location),
    tags: placeTags?.map((pt) => pt.tags) || [],
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
  const { name, address, category_id, rating, notes } = body;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (category_id !== undefined) updates.category_id = category_id || null;
  if (rating !== undefined) updates.rating = rating || null;
  if (notes !== undefined) updates.notes = notes || null;

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
