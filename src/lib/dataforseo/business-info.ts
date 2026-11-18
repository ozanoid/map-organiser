/**
 * DataForSEO My Business Info wrapper.
 * Uses the LIVE endpoint for synchronous results (~6-10 sec).
 * Cost: $0.0054/task ($5.40/1K)
 *
 * IMPORTANT: DataForSEO requires at least one location parameter
 * (location_name, location_code, or location_coordinate) for every request,
 * even CID-based lookups. We default to location_coordinate when available,
 * falling back to location_code 2840 (US) as a global default.
 */

import type { DataForSEOClient } from "./client";
import type {
  BusinessInfoResponse,
  RawBusinessInfo,
} from "./api-types";

export interface BusinessInfoRequest {
  keyword: string;
  location_name?: string;
  location_code?: number;
  location_coordinate?: string; // "latitude,longitude,radius" (radius min 199.9)
  language_code?: string;
}

/** DataForSEO's task status for "nothing found". */
const NO_RESULTS = 40102;

export interface BusinessInfoOptions {
  /** Abort the request (a caller answering within one request bounds it). */
  signal?: AbortSignal;
  /**
   * Throw when the request itself fails — network, HTTP status, abort —
   * instead of returning null. Null then means only "DataForSEO has no
   * record". Callers that must not mistake an outage for "not found" (the
   * assistant's add) set it; the others keep the forgiving default.
   */
  throwOnError?: boolean;
}

export async function fetchBusinessInfoLive(
  client: DataForSEOClient,
  request: BusinessInfoRequest,
  opts: BusinessInfoOptions = {}
): Promise<RawBusinessInfo | null> {
  // DataForSEO requires at least one location param.
  // Priority: location_coordinate > location_code > location_name > fallback
  const hasLocation = request.location_coordinate || request.location_code || request.location_name;

  const taskBody = [
    {
      keyword: request.keyword,
      ...(request.location_name && { location_name: request.location_name }),
      ...(request.location_code && { location_code: request.location_code }),
      ...(request.location_coordinate && { location_coordinate: request.location_coordinate }),
      // If no location provided at all, use US as fallback
      ...(!hasLocation && { location_code: 2840 }),
      language_code: request.language_code || "en",
    },
  ];

  try {
    const response = await client.post<BusinessInfoResponse>(
      "/business_data/google/my_business_info/live",
      taskBody,
      { signal: opts.signal }
    );

    const task = response.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      console.warn(
        `[DataForSEO] Business info task failed: ${task?.status_code} - ${task?.status_message}`
      );
      // 40102 "No Search Results" is DataForSEO's "no such business"; any
      // other task status (balance, bad request, internal error) is a failure.
      if (opts.throwOnError && task?.status_code !== NO_RESULTS) {
        throw new Error(`DataForSEO business info: ${task?.status_code ?? "no task"} ${task?.status_message ?? ""}`.trim());
      }
      return null;
    }

    const result = task.result?.[0];
    if (!result?.items?.length) {
      console.warn("[DataForSEO] Business info: no items returned");
      return null;
    }

    return result.items[0];
  } catch (error) {
    console.error("[DataForSEO] Business info fetch error:", error);
    if (opts.throwOnError) throw error;
    return null;
  }
}
