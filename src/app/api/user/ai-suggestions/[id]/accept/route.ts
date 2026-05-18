import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isFuzzyMatch, normalize } from "@/lib/ai/normalize";

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
    .select("id, type, proposed_value, parent_category_id, target_category_name, status")
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
  // parent_category_id + target_category_name) — they collapse into a single
  // accept. target_category_name is part of the key because a sub-cat
  // proposed under the current parent vs. a sub-cat proposed alongside a
  // category move are semantically different proposals.
  const { data: siblings } = await supabase
    .from("ai_suggestions_queue")
    .select("id, place_id, parent_category_id, target_category_name, proposed_value")
    .eq("user_id", user.id)
    .eq("type", source.type)
    .eq("status", "pending");

  const siblingRows = (siblings ?? []).filter(
    (r) =>
      normalize(r.proposed_value as string) === slug &&
      (r.parent_category_id ?? null) === (source.parent_category_id ?? null) &&
      (r.target_category_name ?? null) === (source.target_category_name ?? null)
  );

  const queueIds = siblingRows.map((r) => r.id as string);
  const placeIds = siblingRows
    .map((r) => r.place_id as string | null)
    .filter((p): p is string => Boolean(p));

  if (source.type === "tag") {
    // Resolve tag: prefer fuzzy match against the user's entire tag list
    // so that accepting "Speakeasy Vibe" when "Speakeasy" already exists
    // reuses the existing tag instead of creating a near-duplicate.
    // Background apply runs the same dedup, but the user may have created
    // a matching tag manually AFTER the queue row was written — accept
    // time is the last line of defense.
    const titleCased = (source.proposed_value as string)
      .split("-")
      .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

    const { data: allTags } = await supabase
      .from("tags")
      .select("id, name")
      .eq("user_id", user.id);
    const tagsList = (allTags ?? []) as Array<{ id: string; name: string }>;

    let tagId: string | null = null;
    const fuzzyHit = tagsList.find((t) =>
      isFuzzyMatch(t.name, source.proposed_value as string)
    );

    if (fuzzyHit) {
      tagId = fuzzyHit.id;
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

    // Resolve sub-category under the parent: fuzzy match against the user's
    // existing slugs (and names) so accepting "speakeasy-vibe" when
    // "speakeasy" already lives under Bar & Nightlife reuses the existing
    // entry rather than creating a near-duplicate.
    const { data: parentSubs } = await supabase
      .from("subcategories")
      .select("id, name, slug, is_pending")
      .eq("user_id", user.id)
      .eq("parent_category_id", source.parent_category_id);
    const parentSubsList = (parentSubs ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      is_pending: boolean;
    }>;

    let subcategoryId: string | null = null;
    const existingSub =
      parentSubsList.find((s) => s.slug === slug) ??
      parentSubsList.find(
        (s) =>
          isFuzzyMatch(s.slug, source.proposed_value as string) ||
          isFuzzyMatch(s.name, source.proposed_value as string)
      );

    if (existingSub) {
      subcategoryId = existingSub.id;
      if (existingSub.is_pending) {
        await supabase
          .from("subcategories")
          .update({ is_pending: false, approved_at: new Date().toISOString() })
          .eq("id", subcategoryId);
      }
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

    // Assign every queued place to the (new or reused) sub-cat. When the
    // proposal also implies a category move (target_category_name set), we
    // update category_id in the same statement so the place lands under the
    // correct parent atomically.
    if (placeIds.length > 0 && subcategoryId) {
      const update: Record<string, unknown> = { subcategory_id: subcategoryId };
      if (source.target_category_name) {
        // Verify the target parent matches the stored parent_category_id
        // (defensive — should always match by construction in apply layer).
        update.category_id = source.parent_category_id;
      }
      await supabase
        .from("places")
        .update(update)
        .in("id", placeIds)
        .eq("user_id", user.id);
    }
  } else if (source.type === "category_change") {
    // Pure category move — no sub-cat involved. The LLM detected a primary
    // mismatch and either there's no useful sub-cat or sub-cat slot was
    // resolvable silently. We resolve target_category_name → category_id
    // against the user's current category list (fuzzy match on the name) and
    // update the place's category_id + null out subcategory_id (the prior
    // sub-cat lived under the old parent and no longer applies).
    if (!source.target_category_name) {
      return NextResponse.json(
        { error: "category_change proposal missing target_category_name" },
        { status: 500 }
      );
    }

    const { data: userCats } = await supabase
      .from("categories")
      .select("id, name")
      .eq("user_id", user.id);
    const userCatsList = (userCats ?? []) as Array<{ id: string; name: string }>;

    const targetCat =
      userCatsList.find(
        (c) =>
          c.name.toLowerCase() === (source.target_category_name as string).toLowerCase()
      ) ??
      userCatsList.find((c) =>
        isFuzzyMatch(c.name, source.target_category_name as string)
      );

    if (!targetCat) {
      return NextResponse.json(
        {
          error: `Category "${source.target_category_name}" not found in your category list`,
        },
        { status: 404 }
      );
    }

    if (placeIds.length > 0) {
      await supabase
        .from("places")
        .update({
          category_id: targetCat.id,
          // Old sub-cat lived under the old parent — invalidate it. A
          // subsequent step=profile run will propose a fresh sub-cat under
          // the new parent if appropriate.
          subcategory_id: null,
        })
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
