import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Memory of a review fetch that came back empty.
 *
 * Backfill eligibility asks "does this place have a CID and no reviews?" — a
 * condition that stays true forever for a place Google has no reviews for. The
 * panel therefore re-offered the same place after every import, and each click
 * spent another DataForSEO reviews call to be told the same nothing. There was
 * no record anywhere that we had already asked.
 *
 * The stamp is deliberately not permanent. A place with no reviews today may
 * have some next month, and a fetch that came back empty because of a transient
 * upstream problem should not exile the place for good. After
 * `REVIEWS_RECHECK_DAYS` it becomes eligible again.
 */
export const REVIEWS_RECHECK_DAYS = 30;

/** Note that a reviews fetch for this place returned nothing. */
export async function stampReviewsChecked(
  supabase: SupabaseClient,
  placeId: string
): Promise<void> {
  const { data } = await supabase
    .from("places")
    .select("google_data")
    .eq("id", placeId)
    .single();
  if (!data) return;

  await supabase
    .from("places")
    .update({
      google_data: {
        ...((data.google_data as Record<string, unknown>) ?? {}),
        reviews_checked_at: new Date().toISOString(),
      },
    })
    .eq("id", placeId);
}

/**
 * Did we already ask about this place recently and get nothing back?
 *
 * Callers use this to keep a known-empty place out of "needs reviews" counts
 * without hiding it forever.
 */
export function reviewsRecentlyChecked(
  googleData: Record<string, unknown> | null | undefined
): boolean {
  const stamp = googleData?.reviews_checked_at;
  if (typeof stamp !== "string") return false;
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return false;
  return Date.now() - at < REVIEWS_RECHECK_DAYS * 24 * 60 * 60 * 1000;
}
