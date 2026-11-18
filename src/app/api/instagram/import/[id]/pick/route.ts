import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { InstagramPickNotFound, InstagramPickRefused, pickInstagramOption } from "@/lib/instagram/pick";

/**
 * POST /api/instagram/import/[id]/pick — add the place the user picked for a
 * venue the import skipped (a chain's branch, or one of several near-matches).
 * The rules live in src/lib/instagram/pick.ts, shared with Claude's
 * add_places tool.
 */

const BodySchema = z.object({
  itemId: z.string().uuid(),
  placeId: z.string().min(1).max(300),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  try {
    const result = await pickInstagramOption(
      { supabase, userId: user.id },
      { jobId: id, itemId: body.data.itemId, optionId: body.data.placeId, origin: request.nextUrl.origin }
    );
    return NextResponse.json({ status: result.status });
  } catch (e) {
    if (e instanceof InstagramPickNotFound) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e instanceof InstagramPickRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
