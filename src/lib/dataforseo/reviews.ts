/**
 * DataForSEO Reviews wrapper.
 * Uses async Task POST/GET with polling since there is no Live endpoint for reviews.
 * Cost: $0.00075/10 reviews (standard), $0.0015/10 reviews (priority)
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
  location_code?: number;
  language_code?: string;
}

/**
 * Fetch reviews using async task workflow.
 * Posts a task, then polls for results with exponential backoff.
 * Timeout: 90 seconds total.
 */
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
          ...(request.location_code && {
            location_code: request.location_code,
          }),
          depth,
          sort_by: request.sort_by || "newest",
          priority: 2, // Use priority queue for faster results (<1min)
        },
      ]
    );

    const taskId = postResponse.tasks?.[0]?.id;
    if (!taskId) {
      console.warn("[DataForSEO] Reviews: no task ID returned");
      return [];
    }

    console.log(`[DataForSEO] Reviews task posted: ${taskId}, polling...`);

    // Step 2: Poll for results
    const maxAttempts = 15;
    let delay = 3000; // Start at 3s (priority queue is fast)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, delay));

      try {
        const getResponse = await client.get<ReviewsResponse>(
          `/business_data/google/reviews/task_get/${taskId}`
        );

        const task = getResponse.tasks?.[0];

        if (task?.status_code === 20000 && task.result?.[0]?.items) {
          console.log(
            `[DataForSEO] Reviews ready after ${attempt + 1} attempts, got ${task.result[0].items.length} reviews`
          );
          return task.result[0].items;
        }

        // Task not ready yet — known status codes for "still processing"
        if (task?.status_code === 40601 || task?.status_code === 40602) {
          console.log(
            `[DataForSEO] Reviews still processing (attempt ${attempt + 1}/${maxAttempts})`
          );
        }
      } catch {
        // GET might fail if task not ready — continue polling
        console.log(
          `[DataForSEO] Reviews poll attempt ${attempt + 1} failed, retrying...`
        );
      }

      // Exponential backoff: 3s → 4.5s → 6.75s → ... max 15s
      delay = Math.min(delay * 1.5, 15000);
    }

    console.warn("[DataForSEO] Reviews polling timed out");
    return [];
  } catch (error) {
    console.error("[DataForSEO] Reviews fetch error:", error);
    return [];
  }
}
