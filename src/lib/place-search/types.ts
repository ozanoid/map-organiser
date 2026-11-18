/**
 * Place search: "find places on a map by name or kind", independent of who
 * answers. One interface so the assistant tools (and later the Instagram
 * resolver) don't depend on a vendor. The provider today is DataForSEO's
 * Google Maps search (src/lib/place-search/dataforseo-maps.ts).
 */

export interface PlaceSearchInput {
  /** A place name ("DanDan Aldgate") or a kind of place ("ramen"). */
  query: string;
  /** Where to look. */
  center: { lat: number; lng: number };
  /** Rough size of the area in metres; providers map it to their own notion (zoom, bias). */
  radiusM: number;
  /** How many results to ask for (1–20). */
  limit: number;
  language?: string;
}

export interface FoundPlace {
  name: string;
  address: string | null;
  /** Google's numeric customer id — the key the import pipeline dedupes and enriches by. */
  cid: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviews: number | null;
  /** 1 (cheap) – 4 (very expensive). */
  priceLevel: number | null;
  category: string | null;
  phone: string | null;
  website: string | null;
  closed: "permanently" | "temporarily" | null;
}

export interface PlaceSearchResult {
  places: FoundPlace[];
  /** What the provider charged for this call, in USD, when it says so. */
  costUsd: number | null;
}

export interface PlaceSearchProvider {
  readonly id: string;
  search(input: PlaceSearchInput, opts?: { signal?: AbortSignal }): Promise<PlaceSearchResult>;
}
