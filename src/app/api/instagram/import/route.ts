import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { InstagramImportRefused, startInstagramImport } from "@/lib/instagram/start-import";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * POST /api/instagram/import { url }
 *
 * Starts an Instagram import: creates the job, answers with its id, and reads
 * the post after the response (`after`). The dialog polls
 * GET /api/instagram/import/[id] for progress.
 *
 * Every place it adds gets visit status "want_to_go", the "instagram" tag and
 * the post URL as its note. Sharing the same post again within 10 minutes
 * returns the running job instead of starting a second one — the iOS Shortcut
 * can fire twice, and React re-mounts the dialog in development. The checks
 * and the job live in src/lib/instagram/start-import.ts, shared with Claude's
 * add_places tool.
 */

export const maxDuration = 120;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  let start;
  try {
    start = await startInstagramImport({ supabase, userId: user.id }, body.data.url);
  } catch (e) {
    if (e instanceof InstagramImportRefused) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start the import" },
      { status: 500 }
    );
  }
  if (start.reused) return NextResponse.json({ jobId: start.jobId, reused: true });

  const { read } = start;
  const origin = request.nextUrl.origin;
  after(async () => {
    await read(origin);
    // The read's Langfuse span ends inside this background run; ship it before the
    // function freezes (same as the other LLM routes).
    await flushLangfuse();
  });

  return NextResponse.json({ jobId: start.jobId }, { status: 202 });
}
