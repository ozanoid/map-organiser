/**
 * Google Places API adapter — wraps existing functions into PlaceDataProvider interface.
 * No behavior change from the original implementation.
 */

import type {
  PlaceDataProvider,
  ProviderCredentials,
  PlaceDetailsResult,
} from "./types";
import type { GoogleReview } from "@/lib/types";
import * as placesApi from "@/lib/google/places-api";

export class GoogleProvider implements PlaceDataProvider {
  readonly name = "google" as const;

  async getPlaceDetails(
    placeId: string,
    creds: ProviderCredentials,
    userId: string
  ): Promise<PlaceDetailsResult | null> {
    if (!creds.googleApiKey) return null;
    const data = await placesApi.getPlaceDetails(
      placeId,
      creds.googleApiKey,
      userId
    );
    if (!data) return null;
    return { data, extended: { provider: "google" } };
  }

  async searchPlace(
    query: string,
    creds: ProviderCredentials,
    userId: string,
    lat?: number,
    lng?: number
  ): Promise<PlaceDetailsResult | null> {
    if (!creds.googleApiKey) return null;
    const data = await placesApi.searchPlace(
      query,
      creds.googleApiKey,
      userId,
      lat,
      lng
    );
    if (!data) return null;
    return { data, extended: { provider: "google" } };
  }

  async getPlaceReviews(
    placeId: string,
    creds: ProviderCredentials,
    userId: string
  ): Promise<GoogleReview[]> {
    if (!creds.googleApiKey) return [];
    return placesApi.getPlaceReviews(
      placeId,
      creds.googleApiKey,
      userId
    );
  }

  async downloadAndStorePhoto(
    photoRef: string,
    placeId: string,
    userId: string,
    creds: ProviderCredentials
  ): Promise<string | null> {
    if (!creds.googleApiKey) return null;
    return placesApi.downloadAndStorePhoto(
      photoRef,
      placeId,
      userId,
      creds.googleApiKey
    );
  }
}
