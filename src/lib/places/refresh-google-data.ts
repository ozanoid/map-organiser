import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import { fetchReviews, toLocationCoordinate } from "@/lib/dataforseo/reviews";
import { parsePostgisPoint } from "@/lib/geo";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";
import {
  transformBusinessInfoToPlaceData,
  transformReviews,
  extractExtendedData,
  mergeReviews,
  countNewReviews,
  ratingsTotal,
} from "@/lib/dataforseo/transform";
import { nextAttempt, type WaveAttempt } from "@/lib/places/freshness";
import { trackUsage, type SkuType } from "@/lib/google/track-usage";
import type { GoogleReview } from "@/lib/types";

export interface RefreshOutcome {
  ok: boolean;
  /** HTTP-ish status for route mapping when ok=false. */
  status?: number;
  error?: string;
  /** Fresh place row (with category join) when ok=true. */
  updated?: unknown;
  /** Stored corpus size after the merge. */
  totalReviews: number;
  /** Genuinely new reviews this run discovered (key-diff, not length). */
  newReviews: number;
  /** Whether a place_profile existed before this refresh. */
  hadProfile: boolean;
  /** False when a business-info lookup ran and returned nothing — the row
   *  is still updated (reviews may have merged via the stored cid) and the
   *  attempt is stamped, but the business info didn't refresh. True when
   *  the lookup succeeded or wasn't requested. */
  bizInfoOk: boolean;
  /** Whether a reviews fetch ran and returned reviews. */
  reviewsFetched: boolean;
}

/** Which usage SKUs the calls are billed under. Background waves have their
 *  own SKUs so the wave budget counts only its own spend. */
const USAGE_SKUS: Record<"interactive" | "refresh", { biz: SkuType; reviews: SkuType }> = {
  interactive: { biz: "dataforseo_business_info_live", reviews: "dataforseo_reviews" },
  refresh: { biz: "refresh_business_info", reviews: "refresh_reviews" },
};

/**
 * DataForSEO re-lookup for one place: business info + extended data
 * (incl. `enriched_at` stamp) and/or reviews (merged into the stored corpus
 * — see mergeReviews, stamps `reviews_refreshed_at`) + photo (unless
 * skipped).
 *
 * `parts` picks what to fetch: the manual refresh takes both, the refresh
 * waves take what the current wave still owes (see lib/places/freshness).
 * Each requested part's wave attempt is stamped BEFORE any paid call, so a
 * run that dies mid-place cannot make the same place look untried forever.
 *
 * Shared by the cookie-scoped user client (manual refresh route) and the
 * service-role client (refresh cron). Every query filters by userId
 * explicitly — nothing in this path relies on RLS.
 */
export async function refreshPlaceGoogleData(
  supabase: SupabaseClient,
  opts: {
    placeId: string;
    userId: string;
    /** "newest" (default) for refreshes — the "relevant" sort mostly
     *  returns the same top-50 every run. */
    reviewSort?: "newest" | "relevant";
    /** Skip photo download (cron — avoids storage writes it doesn't need). */
    skipPhoto?: boolean;
    /** What to fetch. Default: both (the manual refresh). */
    parts?: { biz: boolean; reviews: boolean };
    /** Usage SKUs to bill under. Default "interactive". */
    usage?: "interactive" | "refresh";
  }
): Promise<RefreshOutcome> {
  const { placeId, userId } = opts;
  const parts = opts.parts ?? { biz: true, reviews: true };
  const skus = USAGE_SKUS[opts.usage ?? "interactive"];
  const none = {
    totalReviews: 0,
    newReviews: 0,
    hadProfile: false,
    bizInfoOk: false,
    reviewsFetched: false,
  };

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    return {
      ok: false,
      status: 500,
      error: "DataForSEO not configured",
      ...none,
    };
  }
  const client = new DataForSEOClient({ login, password });

  const { data: place, error: fetchError } = await supabase
    .from("places")
    .select("google_place_id, google_data, country, location")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !place) {
    return { ok: false, status: 404, error: "Place not found", ...none };
  }
  if (!place.google_place_id) {
    return {
      ok: false,
      status: 400,
      error: "No Google Place ID associated with this place",
      ...none,
    };
  }

  const existingData = (place.google_data as Record<string, unknown>) || {};
  const hadProfile = Boolean(existingData.place_profile);
  const now = new Date();

  // Reviews need the CID; a place without one gets a business-info lookup
  // too, whatever was asked, because that is where the CID comes from.
  const wantBiz = parts.biz || (parts.reviews && !existingData.cid);

  // 0. Stamp the attempts before any paid call.
  const attempts: Record<string, WaveAttempt> = {};
  if (wantBiz) {
    attempts.biz_attempt = nextAttempt(
      existingData.biz_attempt as WaveAttempt | undefined,
      "biz",
      now
    );
  }
  if (parts.reviews) {
    attempts.reviews_attempt = nextAttempt(
      existingData.reviews_attempt as WaveAttempt | undefined,
      "reviews",
      now
    );
  }
  const baseData: Record<string, unknown> = { ...existingData, ...attempts };
  if (Object.keys(attempts).length > 0) {
    await supabase
      .from("places")
      .update({ google_data: baseData })
      .eq("id", placeId)
      .eq("user_id", userId);
  }

  // 1. Business info via DataForSEO Live.
  let raw: Awaited<ReturnType<typeof fetchBusinessInfoLive>> = null;
  if (wantBiz) {
    const keyword = place.google_place_id.startsWith("ChIJ")
      ? `place_id:${place.google_place_id}`
      : `cid:${place.google_place_id}`;
    raw = await fetchBusinessInfoLive(client, { keyword });
    trackUsage(userId, skus.biz, supabase).catch(() => {});
  }

  const details = raw ? transformBusinessInfoToPlaceData(raw) : null;
  const extended = raw ? extractExtendedData(raw) : {};

  // 2. Reviews — need CID + location for the reviews endpoint.
  const cid = raw?.cid || (existingData.cid as string) || null;
  const existingReviews =
    (existingData.reviews as GoogleReview[] | undefined) ?? [];
  let mergedReviews = existingReviews;
  let newReviews = 0;
  let reviewsFetched = false;
  if (parts.reviews && cid) {
    const rawReviews = await fetchReviews(client, {
      cid,
      depth: 50,
      sort_by: opts.reviewSort ?? "newest",
      location_coordinate: toLocationCoordinate(
        place.location ? parsePostgisPoint(place.location) : null
      ),
      location_name: (place.country as string) || "United States",
    });
    // The task is billed whether or not reviews come back — track always.
    trackUsage(userId, skus.reviews, supabase).catch(() => {});
    const fetched = transformReviews(rawReviews);
    if (fetched.length > 0) {
      reviewsFetched = true;
      // Key-diff BEFORE merging — a length delta reads 0 at the cap.
      newReviews = countNewReviews(existingReviews, fetched);
      // Merge, don't replace — mode mirrors the fetch sort ("newest"
      // feeds the pool; "relevant" would re-establish the backbone).
      mergedReviews = mergeReviews(existingReviews, fetched, {
        incomingOrder: opts.reviewSort ?? "newest",
      });
    }
  }

  // 3. Only download photo if we don't already have one stored.
  let photoStorageUrl = existingData.photo_storage_url as string | undefined;
  if (!opts.skipPhoto && !photoStorageUrl && details?.photoRef) {
    const newUrl = await downloadAndStorePhotoFromUrl(
      supabase,
      details.photoRef,
      placeId,
      userId
    );
    if (newUrl) photoStorageUrl = newUrl;
  }

  const updatedGoogleData: Record<string, unknown> = {
    ...baseData,
    types: details?.types || baseData.types,
    rating: details?.rating ?? baseData.rating,
    user_ratings_total: (raw && ratingsTotal(raw)) ?? baseData.user_ratings_total,
    opening_hours: details?.openingHours || baseData.opening_hours,
    website: details?.website || baseData.website,
    phone: details?.phone || baseData.phone,
    price_level: details?.priceLevel ?? baseData.price_level,
    url: details?.googleMapsUrl || baseData.url,
    photo_storage_url: photoStorageUrl,
    reviews: mergedReviews,
    // DataForSEO extended fields — includes enriched_at, the business-info
    // freshness stamp, when the lookup succeeded.
    ...extended,
    ...(reviewsFetched ? { reviews_refreshed_at: now.toISOString() } : {}),
  };

  // Clean legacy fields. refresh_attempted_at was the old per-place 30-day
  // clock; the waves read the markers above instead.
  delete updatedGoogleData.photos;
  delete updatedGoogleData.editorial_summary;
  delete updatedGoogleData.editorialSummary;
  delete updatedGoogleData.refresh_attempted_at;

  const { data: updated, error: updateError } = await supabase
    .from("places")
    .update({
      google_data: updatedGoogleData,
      updated_at: now.toISOString(),
    })
    .eq("id", placeId)
    .eq("user_id", userId)
    .select("*, category:categories(*)")
    .single();

  const outcome = {
    totalReviews: mergedReviews.length,
    newReviews,
    hadProfile,
    bizInfoOk: !wantBiz || Boolean(raw),
    reviewsFetched,
  };

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message, ...outcome };
  }
  return { ok: true, updated, ...outcome };
}
