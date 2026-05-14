import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalize } from "@/lib/ai/normalize";

/**
 * POST /api/user/ai-suggestions/[id]/accept
 *
 * Accept a pending AI proposal:
 *   - tag: create the tag in `public.tags`, then attach it to every place
 *     that produced this suggestion (and any other pending row with the
 *     same normalized proposed_value for the same user).
 *   - subcategory: create the row in `public.subcategories` (under the
 *     stored parent_category_id), then point every queued place's
 *     subcategory_id at the new sub-cat.
 *
 * Idempotent w.r.t. accept-then-accept: if the tag/sub-cat already exists
 * (e.g. user created it manually meanwhile), we reuse it instead of
 * throwing. All queue rows for the same proposed_value get status='accepted'.
 */
export async function POST(
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

  // Look up the source proposal
  const { data: source } = await supabase
    .from("ai_suggestions_queue")
    .select("id, type, proposed_value, parent_category_id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  if (source.status !== "pending") {
    return NextResponse.json(
      { error: `Already ${source.status}` },
      { status: 409 }
    );
  }

  const slug = normalize(source.proposed_value);

  // Find all sibling pending rows (same user + type + normalized value +
  // parent_category_id) — they collapse into a single accept.
  const { data: siblings } = await supabase
    .from("ai_suggestions_queue")
    .select("id, place_id, parent_category_id, proposed_value")
    .eq("user_id", user.id)
    .eq("type", source.type)
    .eq("status", "pending");

  const siblingRows = (siblings ?? []).filter(
    (r) =>
      normalize(r.proposed_value as string) === slug &&
      (r.parent_category_id ?? null) === (source.parent_category_id ?? null)
  );

  const queueIds = siblingRows.map((r) => r.id as string);
  const placeIds = siblingRows
    .map((r) => r.place_id as string | null)
    .filter((p): p is string => Boolean(p));

  if (source.type === "tag") {
    // Reuse existing tag if user already has one with this slug, else create
    const titleCased = (source.proposed_value as string)
      .split("-")
      .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

    let tagId: string | null = null;
    const { data: existingTag } = await supabase
      .from("tags")
      .select("id")
      .eq("user_id", user.id)
      .ilike("name", titleCased)
      .maybeSingle();

    if (existingTag) {
      tagId = existingTag.id as string;
    } else {
      const { data: newTag, error: tagErr } = await supabase
        .from("tags")
        .insert({
          user_id: user.id,
          name: titleCased,
        })
        .select("id")
        .single();
      if (tagErr || !newTag) {
        return NextResponse.json(
          { error: tagErr?.message ?? "Failed to create tag" },
          { status: 500 }
        );
      }
      tagId = newTag.id as string;
    }

    // Attach to every place that suggested it
    if (placeIds.length > 0 && tagId) {
      const inserts = placeIds.map((place_id) => ({ place_id, tag_id: tagId }));
      // Best-effort: upsert won't help since (place_id, tag_id) has no
      // ON CONFLICT clause we can target generically; pre-filter instead.
      const { data: existing } = await supabase
        .from("place_tags")
        .select("place_id")
        .eq("tag_id", tagId)
        .in("place_id", placeIds);
      const have = new Set(
        (existing ?? []).map((r) => r.place_id as string)
      );
      const filtered = inserts.filter((row) => !have.has(row.place_id));
      if (filtered.length > 0) {
        await supabase.from("place_tags").insert(filtered);
      }
    }
  } else if (source.type === "subcategory") {
    if (!source.parent_category_id) {
      return NextResponse.json(
        { error: "Subcategory proposal missing parent_category_id" },
        { status: 500 }
      );
    }

    // Reuse existing subcategory if slug already in user's vocabulary
    // (e.g. they created it manually between propose and accept), else create.
    let subcategoryId: string | null = null;
    const { data: existingSub } = await supabase
      .from("subcategories")
      .select("id")
      .eq("user_id", user.id)
      .eq("parent_category_id", source.parent_category_id)
      .eq("slug", slug)
      .maybeSingle();

    if (existingSub) {
      subcategoryId = existingSub.id as string;
      // Flip pending → approved if it was a leftover pending row.
      await supabase
        .from("subcategories")
        .update({ is_pending: false, approved_at: new Date().toISOString() })
        .eq("id", subcategoryId);
    } else {
      const titleCased = (source.proposed_value as string)
        .split("-")
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
      const { data: newSub, error: subErr } = await supabase
        .from("subcategories")
        .insert({
          user_id: user.id,
          parent_category_id: source.parent_category_id,
          name: titleCased,
          slug,
          is_default: false,
          is_pending: false,
          approved_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (subErr || !newSub) {
        return NextResponse.json(
          { error: subErr?.message ?? "Failed to create subcategory" },
          { status: 500 }
        );
      }
      subcategoryId = newSub.id as string;
    }

    // Assign every queued place to the (new or reused) sub-cat
    if (placeIds.length > 0 && subcategoryId) {
      await supabase
        .from("places")
        .update({ subcategory_id: subcategoryId })
        .in("id", placeIds)
        .eq("user_id", user.id);
    }
  }

  // Mark all sibling rows accepted
  if (queueIds.length > 0) {
    await supabase
      .from("ai_suggestions_queue")
      .update({ status: "accepted", resolved_at: new Date().toISOString() })
      .in("id", queueIds);
  }

  return NextResponse.json({
    success: true,
    accepted_count: queueIds.length,
    affected_places: placeIds.length,
  });
}
