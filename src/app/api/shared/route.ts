import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";

// POST /api/shared — create or get existing share link
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { resource_type, resource_id } = await request.json();

  if (!resource_type || !resource_id || !["list", "trip"].includes(resource_type)) {
    return NextResponse.json({ error: "resource_type (list|trip) and resource_id required" }, { status: 400 });
  }

  // Verify ownership
  const table = resource_type === "list" ? "lists" : "trips";
  const { data: resource } = await supabase
    .from(table)
    .select("id")
    .eq("id", resource_id)
    .eq("user_id", user.id)
    .single();

  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  // Check if link already exists
  const { data: existing } = await supabase
    .from("shared_links")
    .select("*")
    .eq("user_id", user.id)
    .eq("resource_type", resource_type)
    .eq("resource_id", resource_id)
    .maybeSingle();

  if (existing) {
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
