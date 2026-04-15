import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/lists/[id]/reorder — update sort_order for places in a list
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: listId } = await params;
  const { placeIds } = await request.json();

  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return NextResponse.json({ error: "placeIds array required" }, { status: 400 });
  }

  // Verify list ownership
  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("user_id", user.id)
    .single();

  if (!list) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Update sort_order for each place
  const updates = placeIds.map((placeId: string, index: number) =>
    supabase
      .from("list_places")
      .update({ sort_order: index })
      .eq("list_id", listId)
      .eq("place_id", placeId)
  );

  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
