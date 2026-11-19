import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DataForSEOClient, isServiceFailure } from "@/lib/dataforseo/client";
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
} from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";
import type { GoogleReview } from "@/lib/types";
import type { RawBusinessInfo } from "@/lib/dataforseo/api-types";

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
  /** False when DataForSEO looked and has no record of the place (gone, or
   *  its id changed) — the row is still updated (reviews may have merged via
   *  the stored cid) and `refresh_attempted_at` is stamped, but extended data
   *  didn't refresh. A failed lookup is `ok: false` instead (v1.45.0). */
  bizInfoOk: boolean;
  /** The reviews fetch failed; the stored reviews were kept. */
  reviewsFailed?: boolean;
  /** DataForSEO itself failed (down, out of balance, rate-limited): nothing
   *  was written; the next run tries again — the cron stops its sweep. */
  serviceFailure?: boolean;
}

/**
 * Full DataForSEO re-lookup for one place: business info + extended data
 * (incl. `enriched_at` stamp) + reviews (merged into the stored corpus —
 * see mergeReviews) + photo (unless skipped).
 *
 * Extracted from the refresh-google-data route (15.07.2026) so the same
 * logic runs under BOTH the cookie-scoped user client (route) and the
 * service-role client (the refresh cron). Every query filters by userId
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
  }
): Promise<RefreshOutcome> {
  const { placeId, userId } = opts;
  const none = {
    totalReviews: 0,
    newReviews: 0,
    hadProfile: false,
    bizInfoOk: false,
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

  // 1. Fetch fresh business info via DataForSEO Live
  const keyword = place.google_place_id.startsWith("ChIJ")
    ? `place_id:${place.google_place_id}`
    : `cid:${place.google_place_id}`;

  // A failed lookup isn't "no record" (v1.45.0; before, it read as null and
  // the refresh "succeeded" on the old data). Nothing of the place is
  // written, and it's reported:
  //  - DataForSEO itself failing → not even the staleness marker, so the next
  //    run tries again (the cron stops its sweep);
  //  - a failure of this place's own request (an invalid field, say) → the
  //    marker only, so it waits a cycle like a place Google no longer knows
  //    and can't hold the head of every daily batch.
  let raw: RawBusinessInfo | null;
  try {
    raw = await fetchBusinessInfoLive(client, { keyword });
  } catch (error) {
    console.error(`[refresh-google-data] lookup failed for ${placeId}:`, error);
    const serviceFailure = isServiceFailure(error);
    if (!serviceFailure) {
      await supabase
        .from("places")
        .update({ google_data: { ...existingData, refresh_attempted_at: new Date().toISOString() } })
        .eq("id", placeId)
        .eq("user_id", userId);
    }
    return {
      ok: false,
      status: 502,
      error: "Place lookup failed — try again",
      ...none,
      hadProfile,
      serviceFailure,
    };
  }
  // Billed whether or not DataForSEO found the place.
  trackUsage(userId, "dataforseo_business_info_live", supabase).catch(
    () => {}
  );

  const details = raw ? transformBusinessInfoToPlaceData(raw) : null;
  const extended = raw ? extractExtendedData(raw) : {};

  // 2. Fetch reviews — need CID + location for the reviews endpoint.
  const cid = raw?.cid || (existingData.cid as string) || null;
  const existingReviews =
    (existingData.reviews as GoogleReview[] | undefined) ?? [];
  let mergedReviews = existingReviews;
  let newReviews = 0;
  let reviewsFailed = false;
  if (cid) {
    try {
      const rawReviews = await fetchReviews(
        client,
        {
          cid,
          depth: 50,
          sort_by: opts.reviewSort ?? "newest",
          location_coordinate: toLocationCoordinate(
            place.location ? parsePostgisPoint(place.location) : null
          ),
          location_name: (place.country as string) || "United States",
        },
        // The task is billed once created, reviews or not.
        { onBilled: () => trackUsage(userId, "dataforseo_reviews", supabase) }
      );
      const fetched = transformReviews(rawReviews);
      if (fetched.length > 0) {
        // Key-diff BEFORE merging — a length delta reads 0 at the cap.
        newReviews = countNewReviews(existingReviews, fetched);
        // Merge, don't replace — mode mirrors the fetch sort ("newest"
        // feeds the pool; "relevant" would re-establish the backbone).
        mergedReviews = mergeReviews(existingReviews, fetched, {
          incomingOrder: opts.reviewSort ?? "newest",
        });
      }
    } catch (error) {
      // The business info above is fresh; keep the stored reviews.
      reviewsFailed = true;
      console.error(`[refresh-google-data] reviews failed for ${placeId}:`, error);
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

  // Calculate total ratings from distribution.
  const dist = (extended as { rating_distribution?: Record<string, number> })
    .rating_distribution;
  const userRatingsTotal = dist
    ? Object.values(dist).reduce((a: number, b: number) => a + b, 0)
    : existingData.user_ratings_total;

  const updatedGoogleData: Record<string, unknown> = {
    ...existingData,
    types: details?.types || existingData.types,
    rating: details?.rating ?? existingData.rating,
    user_ratings_total: userRatingsTotal,
    opening_hours: details?.openingHours || existingData.opening_hours,
    website: details?.website || existingData.website,
    phone: details?.phone || existingData.phone,
    price_level: details?.priceLevel ?? existingData.price_level,
    url: details?.googleMapsUrl || existingData.url,
    photo_storage_url: photoStorageUrl,
    reviews: mergedReviews,
    // DataForSEO extended fields (includes enriched_at when biz-info
    // succeeded).
    ...extended,
    // Stamped whenever the lookup ran, found or not — the cron's staleness
    // marker. Without it a place Google no longer knows would sort to the
    // head of every daily batch forever (starvation). A failed lookup
    // returns above.
    refresh_attempted_at: new Date().toISOString(),
  };

  // Clean legacy fields
  delete updatedGoogleData.photos;
  delete updatedGoogleData.editorial_summary;
  delete updatedGoogleData.editorialSummary;

  const { data: updated, error: updateError } = await supabase
    .from("places")
    .update({
      google_data: updatedGoogleData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", placeId)
    .eq("user_id", userId)
    .select("*, category:categories(*)")
    .single();

  if (updateError) {
    return {
      ok: false,
      status: 500,
      error: updateError.message,
      totalReviews: mergedReviews.length,
      newReviews,
      hadProfile,
      bizInfoOk: Boolean(raw),
      reviewsFailed,
    };
  }

  return {
    ok: true,
    updated,
    totalReviews: mergedReviews.length,
    newReviews,
    hadProfile,
    bizInfoOk: Boolean(raw),
    reviewsFailed,
  };
}
