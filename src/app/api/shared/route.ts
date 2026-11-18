import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { z } from "zod";

const CreateSchema = z.object({
  resource_type: z.enum(["list", "plan", "trip", "place"]),
  resource_id: z.uuid(),
});

// POST /api/shared — create or get existing share link
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "resource_type (list|plan|place) and resource_id required" }, { status: 400 });
  }
  const { resource_id } = parsed.data;
  // "trip" is what plans were called; a page loaded before the rename may
  // still send it.
  const resource_type = parsed.data.resource_type === "trip" ? "plan" : parsed.data.resource_type;

  // Verify ownership
  const table = { list: "lists", plan: "plans", place: "places" }[resource_type];
  const { data: resource } = await supabase
    .from(table)
    .select("id")
    .eq("id", resource_id)
    .eq("user_id", user.id)
    .single();

  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  // Check if link already exists. A plan that was shared as a trip keeps
  // that link (plans kept the trips' ids) — same URL as before.
  const { data: existing } = await supabase
    .from("shared_links")
    .select("*")
    .eq("user_id", user.id)
    .in("resource_type", resource_type === "plan" ? ["plan", "trip"] : [resource_type])
    .eq("resource_id", resource_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Sharing again after a deactivation must yield a WORKING link —
    // otherwise the copied URL 404s with no hint why.
    if (!existing.is_active) {
      const { data: reactivated, error } = await supabase
        .from("shared_links")
        .update({ is_active: true })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(reactivated);
    }
    return NextResponse.json(existing);
  }

  // Create new link
  const slug = nanoid(10);
  const { data: link, error } = await supabase
    .from("shared_links")
    .insert({
      user_id: user.id,
      resource_type,
      resource_id,
      slug,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(link);
}

// PATCH /api/shared — toggle active/inactive
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, is_active } = await request.json();

  const { data, error } = await supabase
    .from("shared_links")
    .update({ is_active })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
