import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAiAvailable } from "@/lib/ai/client";

/**
 * GET /api/user/ai-settings
 *
 * Returns the user's master AI toggle plus a server-side availability flag
 * (so the UI can disable the toggle gracefully when the deployment has no
 * GOOGLE_GENERATIVE_AI_API_KEY env var).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    enabled: profile?.ai_features_enabled ?? true,
    available: isAiAvailable(),
  });
}

const PutBodySchema = z.object({
  enabled: z.boolean(),
});

/**
 * PUT /api/user/ai-settings
 *
 * Body: { enabled: boolean }
 * Updates the user's master AI toggle. When false, server-side AI routes
 * (Phase 3+) will short-circuit with 403 even if AI is globally available.
 */
export async function PUT(request: NextRequest) {
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

  const parsed = PutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ ai_features_enabled: parsed.data.enabled })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, enabled: parsed.data.enabled });
}
