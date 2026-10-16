import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { findExisting } from "@/lib/import/process-place";
import { kickDrain } from "@/lib/import/kick-drain";
import { attachInstagramSource } from "@/lib/instagram/provenance";
import type { InstagramItemInfo, InstagramJobMeta } from "@/lib/instagram/types";

/**
 * POST /api/instagram/import/[id]/pick — add the place the user picked for a
 * venue the import skipped (a chain's branch, or one of several near-matches).
 *
 * Only a place the import itself offered for that item can be picked. The
 * pick turns the skipped item back into a queue item, so it is added exactly
 * like the automatic ones: "instagram" tag, post link as the note, "want to
 * go", enrichment. A place the user already has gets the tag and link instead.
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

  // Read with the session client: RLS proves the job and the item are the user's.
  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, file_name, tag_ids, meta, total")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("kind", "instagram")
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: item } = await supabase
    .from("import_job_items")
    .select("id, stage, reason, payload")
    .eq("id", body.data.itemId)
    .eq("job_id", id)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const info = (item.payload as { instagram?: InstagramItemInfo } | null)?.instagram;
  const option = info?.options?.find((o) => o.id === body.data.placeId);
  if (item.stage !== "skipped" || item.reason === "Already exists" || !info || !option) {
    return NextResponse.json({ error: "This place can't be picked for that item." }, { status: 409 });
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

  const existing = await findExisting(admin, user.id, { placeId: option.id, cid: option.cid });
  if (existing) {
    await attachInstagramSource(admin, user.id, existing, postUrl, tagIds);
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
    if (!updated?.length) return NextResponse.json({ error: "Already picked." }, { status: 409 });
    // Counted like the places the first read found already saved.
    await admin
      .from("import_jobs")
      .update({ total: ((job.total as number | null) ?? 0) + 1 })
      .eq("id", id);
    return NextResponse.json({ status: "already_saved" });
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
  if (!updated?.length) return NextResponse.json({ error: "Already picked." }, { status: 409 });

  // Back to "running": the drain only claims items of running jobs, and closes
  // the job again once this item is through.
  const meta: InstagramJobMeta = { ...(job.meta as InstagramJobMeta), phase: "adding" };
  await admin
    .from("import_jobs")
    .update({ status: "running", finished_at: null, meta, total: ((job.total as number | null) ?? 0) + 1 })
    .eq("id", id);
  kickDrain(request.nextUrl.origin);

  return NextResponse.json({ status: "pending" });
}
