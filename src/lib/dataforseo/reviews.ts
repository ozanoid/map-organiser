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

/** Task statuses while a queued task is still running: "Task Handed", "Task In Queue". */
const IN_PROGRESS = new Set([40601, 40602]);
/** "No Search Results". */
const NO_RESULTS = 40102;
const MAX_POLLS = 12;

export interface ReviewsOptions {
  /**
   * Called once DataForSEO has created the task (status 20100): it is billed
   * from then on ($0.0015 at priority 2, measured 19.11.2026) whatever the
   * polling brings, so count the usage here.
   */
  onBilled?: () => void | Promise<void>;
}

/**
 * Post a reviews task and poll for its result.
 *
 * Returns the reviews, or `[]` when DataForSEO finished the task and the place
 * has none: status 20000 with `items: null` (measured 19.11.2026), or 40102.
 * Throws on every failure: the task wasn't created, a status other than
 * "handed" / "in queue" / done, or no result after MAX_POLLS (~1.5 min). A
 * failed poll is retried — the task itself may be fine.
 *
 * Until v1.45.0 every failure came back as `[]`, which callers record as
 * "Google has no reviews" (`reviews_checked_at`, no re-check for 30 days);
 * and a place without reviews answered only after the whole polling budget,
 * because `items: null` wasn't taken for done.
 */
export async function fetchReviews(
  client: DataForSEOClient,
  request: ReviewsRequest,
  opts: ReviewsOptions = {}
): Promise<RawReview[]> {
  const depth = request.depth ?? 10;

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
  if (!task?.id || (task.status_code ?? 0) >= 40000) {
    throw new Error(
      `DataForSEO reviews task not created: ${task?.status_code ?? "no task"} ${task?.status_message ?? ""}`.trim()
    );
  }
  try {
    await opts.onBilled?.();
  } catch (error) {
    console.error("[DataForSEO] Reviews usage tracking failed:", error);
  }

  const taskId = task.id;
  let delay = 5000;
  let last = "no answer";
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 10000);

    let getTask;
    try {
      const getResponse = await client.get<ReviewsResponse>(
        `/business_data/google/reviews/task_get/${taskId}`
      );
      getTask = getResponse.tasks?.[0];
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      continue;
    }

    const status = getTask?.status_code;
    if (status === 20000) {
      const items = getTask?.result?.[0]?.items ?? [];
      console.log(`[DataForSEO] Reviews ready after ${attempt + 1} polls: ${items.length}`);
      return items;
    }
    if (status === NO_RESULTS) return [];
    if (status !== undefined && IN_PROGRESS.has(status)) {
      last = String(status);
      continue;
    }
    throw new Error(
      `DataForSEO reviews task ${taskId}: ${status ?? "no task"} ${getTask?.status_message ?? ""}`.trim()
    );
  }
  throw new Error(`DataForSEO reviews task ${taskId}: no result after ${MAX_POLLS} polls (last: ${last})`);
}
