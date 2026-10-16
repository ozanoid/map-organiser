import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HikerApiError } from "@/lib/hikerapi/client";
import { checkAiBudget, trackAiUsage } from "@/lib/ai/track-usage";
import { trackUsage } from "@/lib/google/track-usage";
import { findExisting } from "@/lib/import/process-place";
import { kickDrain } from "@/lib/import/kick-drain";
import { analyzeInstagramPost, InstagramImportError, type VenueDecision } from "@/lib/instagram/analyze";
import { attachInstagramSource } from "@/lib/instagram/provenance";
import type { Evidence } from "@/lib/instagram/resolve";
import type { InstagramItemInfo, InstagramJobError, InstagramJobMeta } from "@/lib/instagram/types";

/**
 * An Instagram import is an `import_jobs` row of kind "instagram".
 *
 * The route creates it in phase "reading" and runs {@link runInstagramImportJob}
 * after responding. That reads the post and writes one `import_job_items` row
 * per venue: new places at stage "import" (the drain creates and enriches them
 * exactly like a Takeout import), places already saved as "skipped / Already
 * exists" with the tag and post link attached, and venues that could not be
 * pinned as "skipped" with a reason the dialog shows.
 */

/** Skips worth showing the user — "not a venue" accounts are noise. */
const SHOWN_SKIPS = new Set<VenueDecision["reason"]>(["chain_branch_unknown", "no_evidence", "ambiguous", "closed"]);

function evidenceLabels(e: Evidence | null, sources: string[]): string[] {
  const out: string[] = [];
  if (sources.includes("tagged")) out.push("Tagged in photo");
  else if (sources.includes("coauthor")) out.push("Post coauthor");
  else if (sources.includes("mention")) out.push("Mentioned in caption");
  else if (sources.includes("owner")) out.push("Posted by the place");
  else if (sources.includes("location_tag")) out.push("Location tag");
  else if (sources.includes("caption_text")) out.push("Named in caption");
  if (!e) return out;
  if (e.maps) out.push("Maps link in bio");
  else if (e.phone) out.push("Phone matches");
  else if (e.web || e.handle) out.push("Website matches");
  else if (e.addr || e.postAddr) out.push("Address matches");
  else if ((e.distM ?? Infinity) <= 300 || (e.distTagM ?? Infinity) <= 300) out.push("Same spot");
  else if (e.inArea) out.push("Only one nearby");
  return out;
}

function itemInfo(d: VenueDecision): InstagramItemInfo {
  return {
    label: d.label,
    sources: d.sources,
    rule: d.rule,
    evidence: evidenceLabels(d.evidence, d.sources),
    skip: d.outcome === "skip" ? d.reason : null,
    sameNameCount: d.sameNameCount,
    searchName: d.displayName,
  };
}

function errorCode(e: unknown): InstagramJobError {
  if (e instanceof InstagramImportError) return e.code;
  if (e instanceof HikerApiError && e.status === 0) return "not_configured";
  if (e instanceof Error && e.message === "ai_not_configured") return "not_configured";
  return "service_error";
}

export async function runInstagramImportJob(args: {
  admin: SupabaseClient;
  jobId: string;
  userId: string;
  postUrl: string;
  shortcode: string;
  tagIds: string[];
  googleApiKey: string;
  origin: string;
}): Promise<void> {
  const { admin, jobId, userId, postUrl, shortcode, tagIds } = args;

  const finish = async (meta: InstagramJobMeta, total = 0, running = false) => {
    await admin
      .from("import_jobs")
      .update({
        meta,
        total,
        status: running ? "running" : "done",
        finished_at: running ? null : new Date().toISOString(),
      })
      .eq("id", jobId);
  };

  try {
    const budget = await checkAiBudget("instagram", userId, admin);
    if (budget.exceeded) {
      await finish({ phase: "failed", shortcode, error: "budget_exceeded" });
      return;
    }

    const billed = { hikerapi_request: 0, text_search_enterprise: 0 };
    let analysis;
    try {
      analysis = await analyzeInstagramPost(postUrl, {
        googleApiKey: args.googleApiKey,
        userId,
        onBilled: (sku) => {
          billed[sku]++;
        },
      });
    } finally {
      const tracking: Promise<void>[] = [];
      for (const sku of ["hikerapi_request", "text_search_enterprise"] as const) {
        for (let i = 0; i < billed[sku]; i++) tracking.push(trackUsage(userId, sku, admin));
      }
      await Promise.all(tracking);
    }
    await trackAiUsage(userId, "ai_instagram_read", admin);

    const rows: { stage: string; place_id?: string; reason?: string; payload: Record<string, unknown> }[] = [];
    let toImport = 0;
    let alreadySaved = 0;
    for (const d of analysis.decisions) {
      if (d.outcome === "add" && d.place) {
        const payload = {
          name: d.place.name,
          address: d.place.address,
          lat: d.place.lat,
          lng: d.place.lng,
          googleMapsUrl: d.place.cid
            ? `https://maps.google.com/?cid=${d.place.cid}`
            : `https://maps.google.com/?q=place_id:${d.place.id}`,
          note: postUrl,
          instagram: itemInfo(d),
        };
        const existing = await findExisting(admin, userId, { placeId: d.place.id, cid: d.place.cid });
        if (existing) {
          await attachInstagramSource(admin, userId, existing, postUrl, tagIds);
          rows.push({ stage: "skipped", place_id: existing, reason: "Already exists", payload });
          alreadySaved++;
        } else {
          rows.push({ stage: "import", payload });
          toImport++;
        }
      } else if (d.outcome === "skip" && SHOWN_SKIPS.has(d.reason)) {
        rows.push({
          stage: "skipped",
          reason: d.reason ?? "no_evidence",
          payload: { name: d.displayName, instagram: itemInfo(d) },
        });
      }
    }

    if (rows.length > 0) {
      const { error } = await admin
        .from("import_job_items")
        .insert(rows.map((r) => ({ job_id: jobId, user_id: userId, ...r })));
      if (error) throw new Error(error.message);
    }

    const meta: InstagramJobMeta = {
      phase: toImport > 0 ? "adding" : "done",
      shortcode,
      post: {
        owner: analysis.post.ownerUsername,
        ownerFullName: analysis.post.ownerFullName,
        caption: analysis.post.caption.slice(0, 280),
        locationName: analysis.post.locationName,
      },
    };
    await finish(meta, toImport + alreadySaved, toImport > 0);
    if (toImport > 0) kickDrain(args.origin);
  } catch (e) {
    console.error(`[instagram-import] job ${jobId} failed:`, e);
    await finish({ phase: "failed", shortcode, error: errorCode(e) });
  }
}
