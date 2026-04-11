import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type BulkAction =
  | "update_category"
  | "add_tags"
  | "add_to_list"
  | "update_status"
  | "delete";

interface BulkRequest {
  action: BulkAction;
  place_ids: string[];
  category_id?: string;
  tag_ids?: string[];
  list_id?: string;
  visit_status?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: BulkRequest = await request.json();
  const { action, place_ids, category_id, tag_ids, list_id, visit_status } =
    body;

  if (!place_ids || place_ids.length === 0) {
    return NextResponse.json(
      { error: "place_ids must be a non-empty array" },
      { status: 400 }
    );
  }

  // Verify all places belong to the current user
  const { data: ownedPlaces, error: verifyError } = await supabase
    .from("places")
    .select("id")
    .eq("user_id", user.id)
    .in("id", place_ids);

  if (verifyError) {
    return NextResponse.json({ error: verifyError.message }, { status: 500 });
  }

  const ownedIds = new Set(ownedPlaces?.map((p) => p.id) ?? []);
  const validIds = place_ids.filter((id) => ownedIds.has(id));

  if (validIds.length === 0) {
    return NextResponse.json(
      { error: "No valid places found" },
      { status: 404 }
    );
  }

  let affected = 0;

  switch (action) {
    case "update_category": {
      const { error, count } = await supabase
        .from("places")
        .update({
          category_id: category_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .in("id", validIds)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      affected = count ?? validIds.length;
      break;
    }

    case "add_tags": {
      if (!tag_ids || tag_ids.length === 0) {
        return NextResponse.json(
          { error: "tag_ids required for add_tags action" },
          { status: 400 }
        );
      }

      const rows = validIds.flatMap((placeId) =>
        tag_ids.map((tagId) => ({
          place_id: placeId,
          tag_id: tagId,
        }))
      );

      const { error } = await supabase
        .from("place_tags")
        .upsert(rows, { onConflict: "place_id,tag_id", ignoreDuplicates: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      affected = validIds.length;
      break;
    }

    case "add_to_list": {
      if (!list_id) {
        return NextResponse.json(
          { error: "list_id required for add_to_list action" },
          { status: 400 }
        );
      }

      const rows = validIds.map((placeId) => ({
        list_id,
        place_id: placeId,
      }));

      const { error } = await supabase
        .from("list_places")
        .upsert(rows, { onConflict: "list_id,place_id", ignoreDuplicates: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      affected = validIds.length;
      break;
    }

    case "update_status": {
      const updates: Record<string, unknown> = {
        visit_status: visit_status || null,
        updated_at: new Date().toISOString(),
      };

      if (visit_status === "visited") {
        updates.visited_at = new Date().toISOString();
      } else if (visit_status === "booked") {
        updates.booked_at = new Date().toISOString();
      }

      const { error, count } = await supabase
        .from("places")
        .update(updates)
        .eq("user_id", user.id)
        .in("id", validIds)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      affected = count ?? validIds.length;
      break;
    }

    case "delete": {
      const { error, count } = await supabase
        .from("places")
        .delete()
        .eq("user_id", user.id)
        .in("id", validIds)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      affected = count ?? validIds.length;
      break;
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }

  return NextResponse.json({ success: true, affected });
}
