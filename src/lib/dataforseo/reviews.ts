/**
 * DataForSEO Reviews wrapper.
 * Uses async Task POST/GET with polling.
 * Cost: $0.00075/10 reviews (standard), $0.0015/10 reviews (priority)
 *
 * IMPORTANT: a location is REQUIRED even for CID-based queries. Pass
 * location_coordinate — see toLocationCoordinate for why a name is not safe.
 */

import type { DataForSEOClient } from "./client";
import type {
  ReviewsTaskPostResponse,
  ReviewsResponse,
  RawReview,
} from "./api-types";

export interface ReviewsRequest {
  cid: string;
  depth?: number;
  sort_by?: "newest" | "highest_rating" | "lowest_rating" | "relevant";
  /** `"lat,lng,radius"`. Preferred — see the note on location below. */
  location_coordinate?: string;
  location_name?: string;
  location_code?: number;
  language_code?: string;
}

/** DataForSEO's minimum accepted radius is 199.9 m. */
const COORDINATE_RADIUS_M = 1000;

/**
 * Build the `"lat,lng,radius"` value DataForSEO expects, or null when the place
 * has no usable coordinate.
 *
 * Prefer this over `location_name`. The country string on a place comes from
 * whichever provider parsed the address — usually Google — and there is no
 * guarantee it matches DataForSEO's own location vocabulary. It did not for
 * Turkey: Google switched to "Türkiye", DataForSEO rejected "Turkey" with
 * `40501 Invalid Field: 'location_name'`, and 42 places sat without reviews for
 * four months because `bulk-enrich-reviews` only console.warn'd the failure.
 *
 * A coordinate cannot drift like a name can, and every place has one.
 */
export function toLocationCoordinate(
  coords: { lat: number; lng: number } | null | undefined
): string | undefined {
  if (!coords) return undefined;
  const { lat, lng } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat === 0 && lng === 0) return undefined; // parsePostgisPoint's failure value
  return `${lat.toFixed(7)},${lng.toFixed(7)},${COORDINATE_RADIUS_M}`;
}

export async function fetchReviews(
  client: DataForSEOClient,
  request: ReviewsRequest
): Promise<RawReview[]> {
  const depth = request.depth ?? 10;

  try {
    // Step 1: POST task
    const postResponse = await client.post<ReviewsTaskPostResponse>(
      "/business_data/google/reviews/task_post",
      [
        {
          cid: request.cid,
          language_code: request.language_code || "en",
          ...(request.location_coordinate
            ? { location_coordinate: request.location_coordinate }
            : request.location_code
              ? { location_code: request.location_code }
              : request.location_name
                ? { location_name: request.location_name }
                : { location_name: "United Kingdom" }),
          depth,
          sort_by: request.sort_by || "relevant",
          priority: 2,
        },
      ]
    );

    const task = postResponse.tasks?.[0];

    // Check if task creation itself failed
    if (!task?.id || (task.status_code && task.status_code >= 40000)) {
      console.warn(
        `[DataForSEO] Reviews task creation failed: ${task?.status_code} - ${task?.status_message}`
      );
      return [];
    }

    const taskId = task.id;
    console.log(`[DataForSEO] Reviews task posted: ${taskId}, polling...`);

    // Step 2: Poll for results
    const maxAttempts = 12;
    let delay = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, delay));

      try {
        const getResponse = await client.get<ReviewsResponse>(
          `/business_data/google/reviews/task_get/${taskId}`
        );

        const getTask = getResponse.tasks?.[0];

        if (getTask?.status_code === 20000 && getTask.result?.[0]?.items) {
          console.log(
            `[DataForSEO] Reviews ready after ${attempt + 1} attempts, got ${getTask.result[0].items.length} reviews`
          );
          return getTask.result[0].items;
        }

        // Log progress
        console.log(
          `[DataForSEO] Reviews poll ${attempt + 1}/${maxAttempts}: status=${getTask?.status_code}`
        );
      } catch {
        console.log(
          `[DataForSEO] Reviews poll ${attempt + 1} error, retrying...`
        );
      }

      delay = Math.min(delay * 1.3, 10000);
    }

    console.warn("[DataForSEO] Reviews polling timed out");
    return [];
  } catch (error) {
    console.error("[DataForSEO] Reviews fetch error:", error);
    return [];
  }
}
