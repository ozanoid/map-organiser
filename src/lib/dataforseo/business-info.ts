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

/**
 * How long a caller answering within one request waits for a live lookup.
 * DataForSEO took 10–12 s in testing (18.11.2026); past this bound "try again"
 * serves the user better than a request that hangs.
 */
export const LIVE_LOOKUP_TIMEOUT_MS = 35_000;

export interface BusinessInfoOptions {
  /** Abort the request (a caller answering within one request bounds it). */
  signal?: AbortSignal;
}

/**
 * One live business-info lookup.
 *
 * Returns the business, or `null` when DataForSEO ran the lookup and has no
 * such business (task status 40102, or no items) — billed either way
 * ($0.0054, measured 18.11.2026), so callers count both. Every failure —
 * network, HTTP status, abort or timeout, any other task status (balance,
 * bad request, internal error) — throws and is not billed.
 *
 * Until v1.45.0 a failure also returned `null` unless the caller asked
 * otherwise, and callers took it for "not on Google": the import kept a thin
 * record, the link preview said "not found".
 */
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

  const response = await client.post<BusinessInfoResponse>(
    "/business_data/google/my_business_info/live",
    taskBody,
    { signal: opts.signal }
  );

  const task = response.tasks?.[0];
  if (task?.status_code === NO_RESULTS) return null;
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `DataForSEO business info: ${task?.status_code ?? "no task"} ${task?.status_message ?? ""}`.trim()
    );
  }

  const result = task.result?.[0];
  if (!result?.items?.length) {
    console.warn("[DataForSEO] Business info: no items returned");
    return null;
  }

  return result.items[0];
}
