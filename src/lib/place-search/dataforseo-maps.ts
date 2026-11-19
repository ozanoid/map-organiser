import "server-only";
import { dataForSeoClientFromEnv } from "@/lib/dataforseo/client";
import { convertPriceLevel } from "@/lib/dataforseo/price-level-adapter";
import type {
  FoundPlace,
  PlaceSearchInput,
  PlaceSearchProvider,
  PlaceSearchResult,
} from "@/lib/place-search/types";

/**
 * Google Maps search through DataForSEO's SERP API, live mode:
 * POST /v3/serp/google/maps/live/advanced — one task, $0.002 per search of
 * up to 100 results (the response's own `cost` field, checked 18.11.2026).
 * It returns Google's `cid`, the key the import pipeline dedupes and
 * enriches by. Measured latency 2.6–12.4 s.
 */

const ENDPOINT = "/serp/google/maps/live/advanced";
/** DataForSEO's task status for "nothing found". */
const NO_RESULTS = 40102;

interface MapsItem {
  type?: string;
  title?: string | null;
  address?: string | null;
  cid?: string | null;
  place_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
  price_level?: string | null;
  category?: string | null;
  phone?: string | null;
  url?: string | null;
  work_hours?: { current_status?: string | null } | null;
  address_info?: {
    borough?: string | null;
    city?: string | null;
    region?: string | null;
    country_code?: string | null;
  } | null;
}

interface MapsResponse {
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: Array<{ items?: MapsItem[] | null }> | null;
  }>;
}

export class PlaceSearchUnavailableError extends Error {}

/** The map zoom whose viewport is about `radiusM` across each way (Web
 *  Mercator, ~1000 px viewport); DataForSEO accepts 3z–21z. */
export function zoomForRadius(radiusM: number, lat: number): number {
  const metersPerPixel = radiusM / 500;
  const z = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
  return Math.min(21, Math.max(3, Math.round(z)));
}

function closedState(status: string | null | undefined): FoundPlace["closed"] {
  if (status === "closed_forever") return "permanently";
  if (status === "temporarily_closed") return "temporarily";
  return null;
}

function toFoundPlace(it: MapsItem): FoundPlace | null {
  const name = it.title?.trim();
  if (!name) return null;
  return {
    name,
    address: it.address ?? null,
    cid: it.cid ?? null,
    googlePlaceId: it.place_id ?? null,
    lat: typeof it.latitude === "number" ? it.latitude : null,
    lng: typeof it.longitude === "number" ? it.longitude : null,
    rating: typeof it.rating?.value === "number" ? it.rating.value : null,
    reviews: typeof it.rating?.votes_count === "number" ? it.rating.votes_count : null,
    priceLevel: convertPriceLevel(it.price_level ?? null),
    category: it.category ?? null,
    phone: it.phone ?? null,
    website: it.url ?? null,
    closed: closedState(it.work_hours?.current_status),
    addressParts: it.address_info
      ? {
          borough: it.address_info.borough ?? null,
          city: it.address_info.city ?? null,
          region: it.address_info.region ?? null,
          countryCode: it.address_info.country_code ?? null,
        }
      : null,
  };
}

export const dataForSeoMapsSearch: PlaceSearchProvider = {
  id: "dataforseo-maps",

  async search(input: PlaceSearchInput, opts = {}): Promise<PlaceSearchResult> {
    const client = dataForSeoClientFromEnv();
    if (!client) throw new PlaceSearchUnavailableError("DataForSEO credentials are not set on the server");

    const { lat, lng } = input.center;
    const zoom = zoomForRadius(input.radiusM, lat);
    const res = await client.post<MapsResponse>(
      ENDPOINT,
      [
        {
          keyword: input.query,
          location_coordinate: `${lat.toFixed(7)},${lng.toFixed(7)},${zoom}z`,
          language_code: input.language ?? "en",
          depth: input.limit,
        },
      ],
      { signal: opts.signal }
    );

    const task = res.tasks?.[0];
    // 40102 "No Search Results" is an answer — nothing matched — not a failure
    // (measured 18.11.2026: two Instagram eval posts failed on it).
    if (task?.status_code === NO_RESULTS) {
      return { places: [], costUsd: typeof task.cost === "number" ? task.cost : null };
    }
    if (!task || task.status_code !== 20000) {
      throw new Error(`DataForSEO Maps search failed: ${task?.status_code ?? "no task"} ${task?.status_message ?? ""}`);
    }
    const items = task.result?.[0]?.items ?? [];
    const places = items
      .filter((it) => it.type === "maps_search")
      .map(toFoundPlace)
      .filter((p): p is FoundPlace => p !== null)
      .slice(0, input.limit);
    return { places, costUsd: typeof task.cost === "number" ? task.cost : null };
  },
};
