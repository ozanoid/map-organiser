import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normalize } from "@/lib/ai/normalize";

/**
 * GET /api/subcategories
 *
 * Returns the user's subcategories. Pending AI proposals (is_pending=true)
 * are excluded by default; pass ?include_pending=true to include them
 * (used by Phase 5 moderation queue).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includePending =
    request.nextUrl.searchParams.get("include_pending") === "true";

  let query = supabase
    .from("subcategories")
    .select("*")
    .order("name", { ascending: true });

  if (!includePending) {
    query = query.eq("is_pending", false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subcategories: data ?? [] });
}

const PostBodySchema = z.object({
  parent_category_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/subcategories
 *
 * Creates a new user-defined subcategory. If `slug` is omitted it's derived
 * from `name`. Returns 409 on duplicate (parent_category_id, slug) collision.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const slug = parsed.data.slug
    ? normalize(parsed.data.slug)
    : normalize(parsed.data.name);

  // Verify the parent category belongs to the user (RLS does this too, but
  // an explicit check yields a friendlier error).
  const { data: parent } = await supabase
    .from("categories")
    .select("id")
    .eq("id", parsed.data.parent_category_id)
    .single();

  if (!parent) {
    return NextResponse.json(
      { error: "Parent category not found" },
      { status: 404 }
    );
  }

  const { data, error } = await supabase
    .from("subcategories")
    .insert({
      user_id: user.id,
      parent_category_id: parsed.data.parent_category_id,
      name: parsed.data.name,
      slug,
      is_default: false,
      is_pending: false,
      approved_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A subcategory with this slug already exists in that parent" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subcategory: data });
}
