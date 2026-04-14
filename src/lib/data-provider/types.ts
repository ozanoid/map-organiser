/**
 * Data Provider Abstraction Layer.
 *
 * Defines the interface that both Google Places API and DataForSEO
 * must implement so the rest of the app is provider-agnostic.
 */

import type { ParsedPlaceData, GoogleReview } from "@/lib/types";

export type DataProviderName = "google" | "dataforseo";

export interface ProviderCredentials {
  googleApiKey?: string;
  dataforseoLogin?: string;
  dataforseoPassword?: string;
}

/**
 * Extended data that DataForSEO provides but Google Places API does not.
 * Stored in google_data JSONB alongside standard fields.
 */
export interface ExtendedPlaceData {
  provider?: DataProviderName;
  cid?: string;
  feature_id?: string;
  rating_distribution?: Record<string, number>;
  popular_times?: Record<string, Array<{ hour: number; popular_index: number }>>;
  place_topics?: Record<string, number>;
  attributes?: Record<string, boolean>;
  available_attributes?: Record<string, string>;
  unavailable_attributes?: Record<string, string>;
  is_claimed?: boolean;
  current_status?: string;
  total_photos?: number;
  business_description?: string;
  book_online_url?: string;
  local_business_links?: Array<{ type: string; url: string; title?: string }>;
  people_also_search?: Array<{ title: string; cid?: string; rating?: number }>;
  enriched_at?: string;
}

export interface PlaceDetailsResult {
  data: ParsedPlaceData;
  extended?: ExtendedPlaceData;
}

export interface PlaceDataProvider {
  readonly name: DataProviderName;

  getPlaceDetails(
    placeId: string,
    credentials: ProviderCredentials,
    userId: string
  ): Promise<PlaceDetailsResult | null>;

  searchPlace(
    query: string,
    credentials: ProviderCredentials,
    userId: string,
    lat?: number,
    lng?: number
  ): Promise<PlaceDetailsResult | null>;

  getPlaceReviews(
    placeId: string,
    credentials: ProviderCredentials,
    userId: string,
    depth?: number
  ): Promise<GoogleReview[]>;

  downloadAndStorePhoto(
    photoRef: string,
    placeId: string,
    userId: string,
    credentials: ProviderCredentials
  ): Promise<string | null>;
}
