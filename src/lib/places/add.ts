import "server-only";
import type { UserContext } from "@/lib/db/context";
import { createServiceClient } from "@/lib/supabase/server";
import { dataForSeoClientFromEnv } from "@/lib/dataforseo/client";
import { kickDrain } from "@/lib/import/kick-drain";
import {
  NOT_ON_GOOGLE_MAPS,
  importPlace,
  resolveIdentity,
  type ImportPayload,
  type PlaceIdentity,
} from "@/lib/import/process-place";
import { log } from "@/lib/telemetry/logger";
import type { Category, VisitStatus } from "@/lib/types";

/**
 * Adding places the user named by their Google identity — a CID from
 * search_google_maps or a Google Maps link. Claude's add_places tool.
 *
 * The place is created inside the request, through the same importPlace the
 * import queue runs (one business-info lookup, ~10 s), so the tool can answer
 * with the saved place instead of "queued" — and is never stuck behind a
 * large import in the shared queue. What takes minutes — photo, reviews, the
 * AI profile — goes to that queue as an `assistant` job whose items start at
 * the `photo` stage.
 *
 * Only an exact identity is accepted: a link that doesn't name one place
 * (a search, a bare coordinate) is refused before anything is paid for, and a
 * place Google Maps has no record of is not added (no thin row).
 */

export interface GoogleAddTarget {
  /** Google CID, e.g. google_cid from search_google_maps. */
  googleCid?: string;
  /** A Google Maps link; short links are followed. */
  mapsUrl?: string;
  /** For a new place: its note. A saved place's note is left alone. */
  note?: string | null;
}

export type GoogleAddResult =
  | { status: "added"; placeId: string }
  | { status: "already_saved"; placeId: string }
  /** The link doesn't identify one place. */
  | { status: "not_one_place" }
  /** Google Maps has no such place. */
  | { status: "not_found" }
  /** `retry`: a lookup or link that failed this time (worth another try);
   *  otherwise trying again gives the same answer. */
  | { status: "failed"; reason: string; retry: boolean };

export interface GoogleAddOutcome {
  /** One per target, in order; a target repeated in the batch shares the result. */
  results: GoogleAddResult[];
  /** Photo, reviews and profile were queued for the places added. */
  enrichmentQueued: boolean;
}

/** The server has no DataForSEO account. */
export class PlaceLookupUnavailableError extends Error {}

/** One lookup's bound. DataForSEO's live business info took 10–12 s in testing
 *  (18.11.2026); the tool answers within one call. */
const LOOKUP_TIMEOUT_MS = 35_000;
/** Following a short link (one redirect). */
const LINK_TIMEOUT_MS = 10_000;

function urlOf(target: GoogleAddTarget): string | undefined {
  return target.googleCid ? `https://maps.google.com/?cid=${target.googleCid}` : target.mapsUrl;
}

/** The identity as a URL importPlace reads by pattern alone — no second
 *  redirect follow for a short link. */
function canonicalUrl(identity: PlaceIdentity): string {
  return identity.cid
    ? `https://maps.google.com/?cid=${identity.cid}`
    : `https://maps.google.com/?q=place_id:${identity.placeId}`;
}

export async function addPlacesFromGoogle(
  ctx: UserContext,
  targets: GoogleAddTarget[],
  opts: { visitStatus: VisitStatus | null; origin: string }
): Promise<GoogleAddOutcome> {
  const client = dataForSeoClientFromEnv();
  if (!client) throw new PlaceLookupUnavailableError("Adding places isn't set up on this server.");

  // Free: regex over the link, or one redirect follow for a short link — a
  // short link that can't be followed is a failure, not "names no place".
  const identities = await Promise.all(
    targets.map(async (t) => {
      const url = urlOf(t);
      if (!url) return { error: "not_one_place" as const };
      try {
        const identity = await resolveIdentity(
          { googleMapsUrl: url },
          { signal: AbortSignal.timeout(LINK_TIMEOUT_MS), strict: true }
        );
        return identity.cid || identity.placeId ? { identity } : { error: "not_one_place" as const };
      } catch {
        return { error: "unreadable" as const };
      }
    })
  );

  const { data: cats } = await ctx.supabase.from("categories").select("*").eq("user_id", ctx.userId);
  const categories = (cats ?? []) as Category[];

  // One lookup per distinct place, all at once (at most five).
  const byKey = new Map<string, Promise<GoogleAddResult>>();
  const results = await Promise.all(
    identities.map((entry, i) => {
      if ("error" in entry) {
        return Promise.resolve<GoogleAddResult>(
          entry.error === "not_one_place"
            ? { status: "not_one_place" }
            : { status: "failed", reason: "Couldn't open that Maps link", retry: true }
        );
      }
      const { identity } = entry;
      const key = identity.cid ? `cid:${identity.cid}` : `place_id:${identity.placeId}`;
      let pending = byKey.get(key);
      if (!pending) {
        const payload: ImportPayload = {
          googleMapsUrl: canonicalUrl(identity),
          lat: identity.lat,
          lng: identity.lng,
          note: targets[i].note ?? null,
        };
        pending = addOne(ctx, client, payload, categories, opts.visitStatus);
        byKey.set(key, pending);
      }
      return pending;
    })
  );

  // One place given twice in different forms (its CID and a link with its
  // place id) is looked up twice; the second finds the first's row. Both
  // were added by this call, not saved before.
  const added = [...new Set(results.flatMap((r) => (r.status === "added" ? [r.placeId] : [])))];
  const addedHere = new Set(added);
  const settled = results.map((r): GoogleAddResult =>
    r.status === "already_saved" && addedHere.has(r.placeId) ? { status: "added", placeId: r.placeId } : r
  );
  const enrichmentQueued = added.length > 0 ? await queueEnrichment(ctx.userId, added, opts.origin) : false;
  return { results: settled, enrichmentQueued };
}

async function addOne(
  ctx: UserContext,
  client: NonNullable<ReturnType<typeof dataForSeoClientFromEnv>>,
  payload: ImportPayload,
  categories: Category[],
  visitStatus: VisitStatus | null
): Promise<GoogleAddResult> {
  try {
    const outcome = await importPlace(
      ctx.supabase,
      client,
      ctx.userId,
      payload,
      {
        visitStatus,
        source: "assistant",
        requireLookup: true,
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
      categories
    );
    if (outcome.status === "imported") return { status: "added", placeId: outcome.placeId };
    if (outcome.status === "skipped" && outcome.placeId) return { status: "already_saved", placeId: outcome.placeId };
    if (outcome.status === "skipped" && outcome.reason === NOT_ON_GOOGLE_MAPS) return { status: "not_found" };
    return { status: "failed", reason: outcome.reason, retry: false };
  } catch (e) {
    log.warn("places.add_failed", { userId: ctx.userId, error: e instanceof Error ? e.message : String(e) });
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      status: "failed",
      reason: timedOut ? "The Google Maps lookup took too long" : "The Google Maps lookup failed",
      retry: true,
    };
  }
}

/**
 * Photo, reviews and profile for places just added, through the import queue:
 * one `assistant` job, one item per place at the `photo` stage (the place
 * exists already). Written with the service role — queue items are the
 * drain's, unwritable from a user session — for the verified user only.
 * A failure here leaves the places saved without them; it is logged, not
 * raised.
 *
 * The job is born `preparing` and turns `running` once its items exist: the
 * drain's finalizeJobs closes any running job without active items, and the
 * claim only takes items of running jobs — a job born running could be closed
 * between the two inserts, its items then never claimed.
 */
async function queueEnrichment(userId: string, placeIds: string[], origin: string): Promise<boolean> {
  const admin = createServiceClient();
  const { data: job, error } = await admin
    .from("import_jobs")
    .insert({ user_id: userId, kind: "assistant", total: placeIds.length, status: "preparing" })
    .select("id")
    .single();
  if (error || !job) {
    log.warn("places.enrichment_not_queued", { userId, error: error?.message ?? "no job" });
    return false;
  }
  const { error: itemsError } = await admin.from("import_job_items").insert(
    placeIds.map((placeId) => ({
      job_id: job.id,
      user_id: userId,
      stage: "photo",
      place_id: placeId,
      payload: {},
    }))
  );
  if (itemsError) {
    log.warn("places.enrichment_not_queued", { userId, error: itemsError.message });
    await admin.from("import_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", job.id);
    return false;
  }
  const { error: startError } = await admin.from("import_jobs").update({ status: "running" }).eq("id", job.id);
  if (startError) {
    log.warn("places.enrichment_not_queued", { userId, error: startError.message });
    return false;
  }
  kickDrain(origin);
  return true;
}
