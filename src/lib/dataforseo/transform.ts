/**
 * Transform DataForSEO raw responses → app-compatible types.
 *
 * This is the most critical file in the DataForSEO integration:
 * it ensures the rest of the app sees the exact same ParsedPlaceData
 * and GoogleReview[] shapes regardless of which provider is active.
 */

import type { ParsedPlaceData, GoogleReview } from "@/lib/types";
import type { ExtendedPlaceData } from "@/lib/data-provider/types";
import type { RawBusinessInfo, RawReview } from "./api-types";
import { dataforseoCategoriesToGoogleTypes } from "./category-adapter";
import { convertWorkTimeToOpeningHours } from "./opening-hours-adapter";
import { convertPriceLevel } from "./price-level-adapter";

// ISO 3166-1 alpha-2 → country name (common countries)
const COUNTRY_CODE_MAP: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  UK: "United Kingdom",
  TR: "Turkey",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  PT: "Portugal",
  GR: "Greece",
  AT: "Austria",
  CH: "Switzerland",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czech Republic",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  HR: "Croatia",
  IE: "Ireland",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  TW: "Taiwan",
  TH: "Thailand",
  VN: "Vietnam",
  IN: "India",
  AU: "Australia",
  NZ: "New Zealand",
  CA: "Canada",
  MX: "Mexico",
  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  EG: "Egypt",
  MA: "Morocco",
  ZA: "South Africa",
  RU: "Russia",
  UA: "Ukraine",
  IL: "Israel",
  SG: "Singapore",
  MY: "Malaysia",
  ID: "Indonesia",
  PH: "Philippines",
};

function resolveCountryName(code: string | null): string {
  if (!code) return "";
  return COUNTRY_CODE_MAP[code.toUpperCase()] || code;
}

/**
 * Transform DataForSEO RawBusinessInfo → ParsedPlaceData.
 * Output matches the exact structure that Google adapter produces.
 */
export function transformBusinessInfoToPlaceData(
  raw: RawBusinessInfo
): ParsedPlaceData {
  const types = dataforseoCategoriesToGoogleTypes(
    raw.category,
    raw.additional_categories
  );

  const openingHours = convertWorkTimeToOpeningHours(raw.work_time);
  const priceLevel = convertPriceLevel(raw.price_level);

  // Construct Google Maps URL from place_id or cid
  let googleMapsUrl: string | null = null;
  if (raw.place_id) {
    googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${raw.place_id}`;
  } else if (raw.cid) {
    googleMapsUrl = `https://www.google.com/maps?cid=${raw.cid}`;
  }

  return {
    placeId: raw.place_id || raw.cid || "",
    name: raw.title || "",
    address: raw.address || "",
    country: resolveCountryName(raw.address_info?.country_code ?? null),
    city: raw.address_info?.city || "",
    lat: raw.latitude || 0,
    lng: raw.longitude || 0,
    types,
    photos: [],
    photoRef: raw.main_image || null,
    rating: raw.rating?.value ?? null,
    openingHours,
    website: raw.url || null,
    phone: raw.phone || null,
    priceLevel,
    googleMapsUrl,
  };
}

/**
 * Extract DataForSEO-exclusive fields for storage in google_data JSONB.
 * These fields provide extra value beyond what Google Places API offers.
 */
export function extractExtendedData(
  raw: RawBusinessInfo
): ExtendedPlaceData {
  // Flatten attributes into a boolean map
  const attributes: Record<string, boolean> = {};
  if (raw.attributes?.available_attributes) {
    for (const [group, items] of Object.entries(
      raw.attributes.available_attributes
    )) {
      if (Array.isArray(items)) {
        for (const item of items) {
          attributes[item] = true;
        }
      } else {
        attributes[group] = true;
      }
    }
  }
  if (raw.attributes?.unavailable_attributes) {
    for (const [group, items] of Object.entries(
      raw.attributes.unavailable_attributes
    )) {
      if (Array.isArray(items)) {
        for (const item of items) {
          attributes[item] = false;
        }
      } else {
        attributes[group] = false;
      }
    }
  }

  return {
    provider: "dataforseo",
    cid: raw.cid || undefined,
    feature_id: raw.feature_id || undefined,
    rating_distribution: raw.rating_distribution || undefined,
    popular_times: (raw.popular_times as ExtendedPlaceData["popular_times"]) || undefined,
    place_topics: raw.place_topics || undefined,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    is_claimed: raw.is_claimed ?? undefined,
    current_status: raw.work_time?.current_status || undefined,
    total_photos: raw.total_photos || undefined,
    business_description: raw.description || raw.snippet || undefined,
    book_online_url: raw.book_online_url || undefined,
    local_business_links:
      raw.local_business_links?.map((l) => ({
        type: l.type || "link",
        url: l.url || "",
        title: l.title || undefined,
      })) || undefined,
    people_also_search:
      raw.people_also_search?.map((p) => ({
        title: p.title || "",
        cid: p.cid || undefined,
        rating: p.rating?.value,
      })) || undefined,
    enriched_at: new Date().toISOString(),
  };
}

/**
 * Transform DataForSEO RawReview[] → GoogleReview[].
 * Matches the exact interface the UI expects.
 */
export function transformReviews(rawReviews: RawReview[]): GoogleReview[] {
  return rawReviews
    .filter((r) => r.review_text || r.original_review_text)
    .map((r) => ({
      rating: r.rating?.value ?? 0,
      text: r.review_text || r.original_review_text || "",
      author_name: r.profile_name || "Anonymous",
      author_photo: r.profile_image_url || undefined,
      relative_time: r.time_ago || "",
      publish_time: r.timestamp || undefined,
    }));
}

/**
 * Extract extended review data (DataForSEO exclusive fields).
 * These provide richer review information than Google Places API.
 */
export function transformExtendedReviews(rawReviews: RawReview[]) {
  return rawReviews
    .filter((r) => r.review_text || r.original_review_text)
    .map((r) => ({
      review_id: r.review_id,
      text: r.review_text || r.original_review_text || "",
      original_text: r.original_review_text || undefined,
      original_language: r.original_language || undefined,
      rating: r.rating?.value ?? 0,
      author_name: r.profile_name || "Anonymous",
      author_photo: r.profile_image_url || undefined,
      author_profile_url: r.profile_url || undefined,
      author_reviews_count: r.reviews_count || undefined,
      author_photos_count: r.photos_count || undefined,
      local_guide: r.local_guide || false,
      relative_time: r.time_ago || "",
      timestamp: r.timestamp || undefined,
      images:
        r.images?.map((img) => img.image_url || img.url || "").filter(Boolean) ||
        [],
      owner_answer: r.owner_answer || undefined,
      original_owner_answer: r.original_owner_answer || undefined,
      owner_timestamp: r.owner_timestamp || undefined,
      votes_count: r.rating?.votes_count || 0,
      review_url: r.review_url || undefined,
    }));
}
