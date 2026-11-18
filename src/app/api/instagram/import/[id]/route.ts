import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInstagramImportView } from "@/lib/instagram/view";

/**
 * GET /api/instagram/import/[id] — progress and result of one Instagram import,
 * shaped for the dialog. Read with the session client: RLS limits both the
 * job and its items to their owner. The view is built in
 * src/lib/instagram/view.ts, shared with Claude's add_places tool.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = await getInstagramImportView({ supabase, userId: user.id }, id);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}
