import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserContext } from "@/lib/db/context";
import { InputError } from "@/lib/db/errors";
import { isAiAvailable } from "@/lib/ai/client";
import { dataForSeoClientFromEnv } from "@/lib/dataforseo/client";
import { parseInstagramPostUrl } from "@/lib/instagram/url";
import { ensureInstagramTag } from "@/lib/instagram/provenance";
import { runInstagramImportJob } from "@/lib/instagram/import-job";
import type { InstagramJobMeta } from "@/lib/instagram/types";

/**
 * Starting an Instagram import — one function for the app's route
 * (POST /api/instagram/import) and Claude's add_places tool.
 *
 * It checks the import can run for this user, reuses a job for the same post
 * from the last 10 minutes (the iOS Shortcut can fire twice; Claude may be
 * asked about a post just shared from the phone), or creates the job in phase
 * "reading". Reading the post is the caller's to run: the route hands it to
 * `after()`, the tool waits for it.
 *
 * Every place the job adds gets the "instagram" tag and the post URL as its
 * note; visit status and lists come from the options (the app: "want to go",
 * no list).
 */

/** Why an import can't start; the message is for the person or the model. */
export class InstagramImportRefused extends InputError {
  constructor(
    message: string,
    readonly status: 400 | 503
  ) {
    super(message);
  }
}

const REUSE_WINDOW_MS = 10 * 60 * 1000;
/** Matches the status view: a job still "reading" after this lost its run. */
const STALL_MS = 3 * 60 * 1000;

export type InstagramImportStart =
  | { jobId: string; reused: true }
  | { jobId: string; reused: false; read: (origin: string) => Promise<void> };

export interface InstagramImportOptions {
  /** Status for the places it adds; the app's import uses "want_to_go". */
  visitStatus?: "want_to_go" | "booked" | "visited" | "favorite";
  /** Lists the places it adds go on (the drain adds them through save_list). */
  listIds?: string[];
  via?: InstagramJobMeta["via"];
}

export async function startInstagramImport(
  ctx: UserContext,
  url: string,
  opts: InstagramImportOptions = {}
): Promise<InstagramImportStart> {
  const ref = parseInstagramPostUrl(url);
  if (!ref) throw new InstagramImportRefused("That isn't an Instagram post or reel link.", 400);

  // HikerAPI reads the post, Gemini reads it, Google Maps (through
  // DataForSEO, the server's own account) finds the places.
  if (!process.env.HIKERAPI_KEY || !isAiAvailable() || !dataForSeoClientFromEnv()) {
    throw new InstagramImportRefused("Instagram import isn't set up on this server.", 503);
  }
  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!profile?.ai_features_enabled) {
    throw new InstagramImportRefused(
      "Instagram import reads the post with AI. Turn on AI features in Settings.",
      400
    );
  }

  const { data: recent } = await ctx.supabase
    .from("import_jobs")
    .select("id, meta, created_at")
    .eq("user_id", ctx.userId)
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
    return { jobId: recent.id as string, reused: true };
  }

  const tagId = await ensureInstagramTag(ctx.supabase, ctx.userId);

  const meta: InstagramJobMeta = {
    phase: "reading",
    shortcode: ref.shortcode,
    ...(opts.via ? { via: opts.via } : {}),
  };
  const { data: job, error } = await ctx.supabase
    .from("import_jobs")
    .insert({
      user_id: ctx.userId,
      kind: "instagram",
      file_name: ref.canonicalUrl,
      total: 0,
      // Not "running" yet: the drain closes running jobs that hold no items,
      // and this one has none until the post has been read.
      status: "reading",
      visit_status: opts.visitStatus ?? "want_to_go",
      list_ids: opts.listIds ?? [],
      tag_ids: [tagId],
      meta,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Failed to create the import job");

  const jobId = job.id as string;
  return {
    jobId,
    reused: false,
    read: (origin) =>
      runInstagramImportJob({
        admin: createServiceClient(),
        jobId,
        userId: ctx.userId,
        postUrl: ref.canonicalUrl,
        shortcode: ref.shortcode,
        tagIds: [tagId],
        origin,
        via: opts.via,
      }),
  };
}
