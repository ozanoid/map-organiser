import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserContext } from "@/lib/db/context";
import { InputError, NotFoundError } from "@/lib/db/errors";
import { findExisting } from "@/lib/import/process-place";
import { kickDrain } from "@/lib/import/kick-drain";
import { attachInstagramSource } from "@/lib/instagram/provenance";
import type { InstagramItemInfo, InstagramJobMeta } from "@/lib/instagram/types";

/**
 * Add the place picked for a venue an Instagram import skipped (a chain's
 * branch, or one of several near-matches) — one function for the dialog's
 * POST /api/instagram/import/[id]/pick and Claude's add_places tool.
 *
 * Only a place the import itself offered for that item can be picked. The
 * pick turns the skipped item back into a queue item, so it is added exactly
 * like the automatic ones: "instagram" tag, post link as the note, the job's
 * visit status and lists, enrichment. A place the user already has gets the
 * tag and link instead.
 */

export class InstagramPickNotFound extends NotFoundError {}
/** The item can't take this pick (already picked, not a skipped venue, not
 *  one of its options); a 409 in the route. */
export class InstagramPickRefused extends InputError {}

export type InstagramPickResult = { status: "pending" } | { status: "already_saved"; placeId: string };

export async function pickInstagramOption(
  ctx: UserContext,
  args: { jobId: string; itemId: string; optionId: string; origin: string }
): Promise<InstagramPickResult> {
  // Read with the caller's client and filter by the user: the job and the
  // item are proven to be theirs before anything is written.
  const { data: job } = await ctx.supabase
    .from("import_jobs")
    .select("id, file_name, tag_ids, meta, total")
    .eq("id", args.jobId)
    .eq("user_id", ctx.userId)
    .eq("kind", "instagram")
    .maybeSingle();
  if (!job) throw new InstagramPickNotFound("No such Instagram import.");

  const { data: item } = await ctx.supabase
    .from("import_job_items")
    .select("id, stage, reason, payload")
    .eq("id", args.itemId)
    .eq("job_id", args.jobId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!item) throw new InstagramPickNotFound("No such venue in that import.");

  const info = (item.payload as { instagram?: InstagramItemInfo } | null)?.instagram;
  const option = info?.options?.find((o) => o.id === args.optionId);
  if (item.stage !== "skipped" || item.reason === "Already exists" || !info || !option) {
    throw new InstagramPickRefused("This place can't be picked for that item.");
  }

  const admin = createServiceClient();
  const postUrl = job.file_name as string;
  const tagIds = (job.tag_ids as string[] | null) ?? [];
  const payload = {
    name: option.name,
    address: option.address,
    lat: option.lat,
    lng: option.lng,
    googleMapsUrl: `https://maps.google.com/?cid=${option.cid}`,
    note: postUrl,
    // The other options are spent; `undefined` drops them from the stored JSON.
    instagram: {
      ...info,
      rule: "picked",
      evidence: ["Picked by you"],
      skip: null,
      options: undefined,
    } satisfies InstagramItemInfo,
  };

  const existing = await findExisting(admin, ctx.userId, { placeId: option.id, cid: option.cid });
  if (existing) {
    await attachInstagramSource(admin, ctx.userId, existing, postUrl, tagIds);
    const { data: updated } = await admin
      .from("import_job_items")
      .update({
        stage: "skipped",
        reason: "Already exists",
        place_id: existing,
        payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("stage", "skipped")
      .select("id");
    if (!updated?.length) throw new InstagramPickRefused("Already picked.");
    // Counted like the places the first read found already saved.
    await admin
      .from("import_jobs")
      .update({ total: ((job.total as number | null) ?? 0) + 1 })
      .eq("id", args.jobId);
    return { status: "already_saved", placeId: existing };
  }

  // `.eq("stage", "skipped")` makes a double tap pick once.
  const { data: updated } = await admin
    .from("import_job_items")
    .update({
      stage: "import",
      reason: null,
      place_id: null,
      payload,
      attempts: 0,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("stage", "skipped")
    .select("id");
  if (!updated?.length) throw new InstagramPickRefused("Already picked.");

  // Back to "running": the drain only claims items of running jobs, and closes
  // the job again once this item is through.
  const meta: InstagramJobMeta = { ...(job.meta as InstagramJobMeta), phase: "adding" };
  await admin
    .from("import_jobs")
    .update({ status: "running", finished_at: null, meta, total: ((job.total as number | null) ?? 0) + 1 })
    .eq("id", args.jobId);
  kickDrain(args.origin);

  return { status: "pending" };
}
