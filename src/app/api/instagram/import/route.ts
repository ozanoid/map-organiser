import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";
import { isAiAvailable } from "@/lib/ai/client";
import { parseInstagramPostUrl } from "@/lib/instagram/url";
import { ensureInstagramTag } from "@/lib/instagram/provenance";
import { runInstagramImportJob } from "@/lib/instagram/import-job";
import { flushLangfuse } from "@/lib/telemetry/langfuse";
import type { InstagramJobMeta } from "@/lib/instagram/types";

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
 * can fire twice, and React re-mounts the dialog in development.
 */

export const maxDuration = 120;

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

const REUSE_WINDOW_MS = 10 * 60 * 1000;
/** Matches the status route: a job still "reading" after this lost its run. */
const STALL_MS = 3 * 60 * 1000;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const ref = parseInstagramPostUrl(body.data.url);
  if (!ref) {
    return NextResponse.json({ error: "That isn't an Instagram post or reel link." }, { status: 400 });
  }

  if (!process.env.HIKERAPI_KEY || !isAiAvailable()) {
    return NextResponse.json({ error: "Instagram import isn't set up on this server." }, { status: 503 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.ai_features_enabled) {
    return NextResponse.json(
      { error: "Instagram import reads the post with AI. Turn on AI features in Settings." },
      { status: 400 }
    );
  }
  // The Google Places toggle covers looking up pasted Maps links; the Instagram
  // import always needs Google's candidate search for its evidence.
  const { googleApiKey } = await getUserApiKeys(user.id);
  if (!googleApiKey) {
    return NextResponse.json(
      { error: "Instagram import needs a Google Places API key. Add one in Settings." },
      { status: 400 }
    );
  }

  const { data: recent } = await supabase
    .from("import_jobs")
    .select("id, meta, created_at")
    .eq("user_id", user.id)
    .eq("kind", "instagram")
    .eq("file_name", ref.canonicalUrl)
    .gte("created_at", new Date(Date.now() - REUSE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recentPhase = (recent?.meta as InstagramJobMeta | null)?.phase;
  const stalled =
    recentPhase === "reading" && Date.now() - new Date(recent?.created_at as string).getTime() > STALL_MS;
  if (recent && recentPhase !== "failed" && !stalled) {
    return NextResponse.json({ jobId: recent.id, reused: true });
  }

  let tagId: string;
  try {
    tagId = await ensureInstagramTag(supabase, user.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Tag error" }, { status: 500 });
  }

  const meta: InstagramJobMeta = { phase: "reading", shortcode: ref.shortcode };
  const { data: job, error } = await supabase
    .from("import_jobs")
    .insert({
      user_id: user.id,
      kind: "instagram",
      file_name: ref.canonicalUrl,
      total: 0,
      // Not "running" yet: the drain closes running jobs that hold no items,
      // and this one has none until the post has been read.
      status: "reading",
      visit_status: "want_to_go",
      tag_ids: [tagId],
      meta,
    })
    .select("id")
    .single();
  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  after(async () => {
    await runInstagramImportJob({
      admin: createServiceClient(),
      jobId: job.id as string,
      userId: user.id,
      postUrl: ref.canonicalUrl,
      shortcode: ref.shortcode,
      tagIds: [tagId],
      googleApiKey,
      origin,
    });
    // The Gemini span ends inside this background run; ship it before the
    // function freezes (same as the other LLM routes).
    await flushLangfuse();
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
