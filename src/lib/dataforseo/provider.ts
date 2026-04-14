/**
 * DataForSEO Provider — implements PlaceDataProvider interface.
 *
 * Uses DataForSEO Business Data API as the data source for place details,
 * reviews, and photos. Returns the same types as the Google adapter.
 */

import type {
  PlaceDataProvider,
  ProviderCredentials,
  PlaceDetailsResult,
} from "@/lib/data-provider/types";
import type { GoogleReview } from "@/lib/types";
import { DataForSEOClient } from "./client";
import { fetchBusinessInfoLive } from "./business-info";
import { fetchReviews } from "./reviews";
import { downloadAndStorePhotoFromUrl } from "./photo";
import {
  transformBusinessInfoToPlaceData,
  transformReviews,
  extractExtendedData,
} from "./transform";
import { trackUsage } from "@/lib/google/track-usage";

export class DataForSEOProvider implements PlaceDataProvider {
  readonly name = "dataforseo" as const;

  private getClient(creds: ProviderCredentials): DataForSEOClient {
    if (!creds.dataforseoLogin || !creds.dataforseoPassword) {
      throw new Error(
        "DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD."
      );
    }
    return new DataForSEOClient({
      login: creds.dataforseoLogin,
      password: creds.dataforseoPassword,
    });
  }

  /**
   * Determine the keyword format for DataForSEO based on the placeId format.
   * - ChIJ... → "place_id:ChIJ..."
   * - Pure numeric → "cid:123..."
   * - Other → use as-is (treated as search keyword)
   */
  private formatKeyword(placeId: string): string {
    if (placeId.startsWith("ChIJ")) {
      return `place_id:${placeId}`;
    }
    if (/^\d+$/.test(placeId)) {
      return `cid:${placeId}`;
    }
    // Already prefixed or a search term
    if (placeId.startsWith("place_id:") || placeId.startsWith("cid:")) {
      return placeId;
    }
    return placeId;
  }

  async getPlaceDetails(
    placeId: string,
    creds: ProviderCredentials,
    userId: string
  ): Promise<PlaceDetailsResult | null> {
    const client = this.getClient(creds);
    const keyword = this.formatKeyword(placeId);

    const raw = await fetchBusinessInfoLive(client, { keyword });
    if (!raw) return null;

    trackUsage(userId, "dataforseo_business_info_live").catch(() => {});

    const data = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);

    return { data, extended };
  }

  async searchPlace(
    query: string,
    creds: ProviderCredentials,
    userId: string,
    lat?: number,
    lng?: number
  ): Promise<PlaceDetailsResult | null> {
    const client = this.getClient(creds);

    // For text search, pass query as keyword.
    // If we have coordinates, add them to help DataForSEO locate the right business.
    let keyword = query;
    if (lat && lng) {
      // Use location_coordinate for geo-biasing
      const raw = await fetchBusinessInfoLive(client, {
        keyword,
        // DataForSEO doesn't have locationBias like Google,
        // but we can include coords in the keyword for better results
      });
      if (!raw) return null;

      trackUsage(userId, "dataforseo_business_info_live").catch(() => {});
      const data = transformBusinessInfoToPlaceData(raw);
      const extended = extractExtendedData(raw);
      return { data, extended };
    }

    const raw = await fetchBusinessInfoLive(client, { keyword });
    if (!raw) return null;

    trackUsage(userId, "dataforseo_business_info_live").catch(() => {});
    const data = transformBusinessInfoToPlaceData(raw);
    const extended = extractExtendedData(raw);

    return { data, extended };
  }

  async getPlaceReviews(
    placeId: string,
    creds: ProviderCredentials,
    userId: string,
    depth?: number
  ): Promise<GoogleReview[]> {
    const client = this.getClient(creds);

    // Reviews endpoint requires CID (numeric Google client ID).
    // If we have a ChIJ place_id, fetch business info first to get CID.
    let cid = placeId;

    if (placeId.startsWith("ChIJ") || !(/^\d+$/.test(placeId))) {
      console.log(
        `[DataForSEO] Reviews: placeId "${placeId}" is not a CID, fetching business info for CID...`
      );
      const keyword = this.formatKeyword(placeId);
      const info = await fetchBusinessInfoLive(client, { keyword });
      if (!info?.cid) {
        console.warn("[DataForSEO] Could not resolve CID for reviews");
        return [];
      }
      cid = info.cid;
      trackUsage(userId, "dataforseo_business_info_live").catch(() => {});
    }

    const rawReviews = await fetchReviews(client, { cid, depth: depth ?? 10 });
    trackUsage(userId, "dataforseo_reviews").catch(() => {});

    return transformReviews(rawReviews);
  }

  async downloadAndStorePhoto(
    photoRef: string,
    placeId: string,
    userId: string,
    _creds: ProviderCredentials
  ): Promise<string | null> {
    // For DataForSEO, photoRef IS the image URL (main_image field)
    if (!photoRef || !photoRef.startsWith("http")) return null;
    return downloadAndStorePhotoFromUrl(photoRef, placeId, userId);
  }
}
