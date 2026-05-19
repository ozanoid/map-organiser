/**
 * Google Places API (New) wrapper.
 * Server-side only — never expose the API key to the client.
 *
 * COST TIERS (based on highest field in mask):
 *   Essentials ($5/1K):  id, displayName, formattedAddress, addressComponents, location, types
 *   Pro ($17/1K):        + rating, userRatingCount, openingHours, websiteUri, phone, priceLevel, googleMapsUri, photos (refs only)
 *   Enterprise ($20/1K): + reviews
 *   Photos ($7/1K):      each media URL fetch
 *
 * Default mask uses PRO tier. Reviews fetched separately via getPlaceReviews().
 * All functions require apiKey + userId params for per-user billing and tracking.
 */

import type { ParsedPlaceData, GoogleReview } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { trackUsage } from "@/lib/google/track-usage";
import { maskApiKey } from "@/lib/google/get-user-api-keys";

const BASE_URL = "https://places.googleapis.com/v1";

// PRO tier ($17/1K) - used for place details and search
const FIELD_MASK_PRO = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "location",
  "types",
  "rating",
  "userRatingCount",
  "currentOpeningHours",
  "regularOpeningHours",
  "websiteUri",
  "nationalPhoneNumber",
  "photos",
  "priceLevel",
  "googleMapsUri",
].join(",");

// ENTERPRISE tier ($20/1K) - used only for reviews refresh
const FIELD_MASK_REVIEWS = "reviews";

interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

function extractReviews(reviews: any[] | undefined): GoogleReview[] {
  if (!reviews) return [];
  return reviews.slice(0, 5).map((r: any) => ({
    rating: r.rating || 0,
    text: r.text?.text || r.originalText?.text || "",
    author_name: r.authorAttribution?.displayName || "Anonymous",
    author_photo: r.authorAttribution?.photoUri || undefined,
    relative_time: r.relativePublishTimeDescription || "",
    publish_time: r.publishTime || "",
  }));
}

/**
 * Country codes (ISO 3166-1 alpha-2) where Google returns the city name
 * in `administrative_area_level_1` because the entire country IS the city.
 * For these, we promote admin_area_level_1 to the canonical city slot.
 */
const CITY_STATE_CODES = new Set(["SG", "MC", "VA", "HK", "MO"]);

/**
 * Type tiers for the city, most-specific-city-name first.
 * Walks tiers in order; first hit wins. `administrative_area_level_1`
 * is intentionally NOT in this list — it's an administrative region in
 * most countries (e.g. "England" for UK addresses) and using it as city
 * was the v1 bug that put 174 of one user's 234 UK places under
 * `city='England'`. The fallback at the end handles missing-everything
 * edge cases.
 */
const CITY_TIERS = [
  "locality",                   // canonical city in most countries
  "postal_town",                // UK convention — Royal Mail's "town"
  "sublocality_level_1",        // some regions / cities-of-cities
  "administrative_area_level_2", // county / district fallback
];

function extractCountryAndCity(components: AddressComponent[]): {
  country: string;
  city: string;
} {
  const byType = new Map<string, string>();
  let country = "";
  let countryCode = "";

  for (const comp of components) {
    const types = comp.types || [];
    const value = (comp.longText || "").trim();
    if (!value) continue;
    if (types.includes("country")) {
      country = value;
      countryCode = (comp.shortText || "").trim().toUpperCase();
      continue;
    }
    // First-write-wins per type (Google typically lists most-specific first).
    for (const t of types) {
      if (!byType.has(t)) byType.set(t, value);
    }
  }

  // Walk preferred tiers.
  for (const t of CITY_TIERS) {
    const v = byType.get(t);
    if (v) return { country, city: v };
  }

  // City-states (Singapore, Monaco, Vatican, HK, Macau): admin_area_1 IS the city.
  if (CITY_STATE_CODES.has(countryCode)) {
    const v = byType.get("administrative_area_level_1");
    if (v) return { country, city: v };
  }

  // Last-resort fallback. Some Google responses (rural / unusual addresses)
  // have only admin_area_1. Better to have *something* in the city slot
  // than empty — the Phase 6 NL search OR-matches city against address
  // so this fallback doesn't break later filtering.
  const fallback = byType.get("administrative_area_level_1") || "";
  return { country, city: fallback };
}

function parsePriceLevel(level: string | number): number | null {
  if (typeof level === "number") return level;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level] ?? null;
}

/**
 * Download a Google Places photo and upload to Supabase Storage.
 * Returns the public Supabase Storage URL, or null on failure.
 */
export async function downloadAndStorePhoto(
  photoName: string,
  placeId: string,
  userId: string,
  apiKey: string
): Promise<string | null> {
  try {
    const googleUrl = `${BASE_URL}/${photoName}/media?maxHeightPx=600&maxWidthPx=600&key=${apiKey}`;
    console.log(`[Google API REQUEST] curl -X GET "${BASE_URL}/${photoName}/media?maxHeightPx=600&maxWidthPx=600&key=${maskApiKey(apiKey)}"`);
    const res = await fetch(googleUrl);
    console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | content-type=${res.headers.get("content-type")} | content-length=${res.headers.get("content-length")}`);
    if (!res.ok) return null;

    const blob = await res.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const fileName = `${userId}/${placeId}.${ext}`;

    const supabase = await createClient();

    const { error } = await supabase.storage
      .from("place-photos")
      .upload(fileName, buffer, {
        contentType: blob.type || "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("Storage upload error:", error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("place-photos")
      .getPublicUrl(fileName);

    trackUsage(userId, "photos").catch(() => {});
    return urlData.publicUrl;
  } catch (e) {
    console.error("Photo download error:", e);
    return null;
  }
}

/**
 * Fetch place details by Place ID. Uses PRO tier ($17/1K).
 */
export async function getPlaceDetails(
  placeId: string,
  apiKey: string,
  userId: string
): Promise<ParsedPlaceData | null> {
  const url = `${BASE_URL}/places/${placeId}`;
  const headers = { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK_PRO };
  console.log(`[Google API REQUEST] curl -X GET "${url}" -H "X-Goog-Api-Key: ${maskApiKey(apiKey)}" -H "X-Goog-FieldMask: ${FIELD_MASK_PRO}"`);

  const res = await fetch(url, { method: "GET", headers, next: { revalidate: 86400 } });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 1000)}${responseBody.length > 1000 ? "...[truncated]" : ""}`);

  if (!res.ok) return null;

  const data = JSON.parse(responseBody);
  trackUsage(userId, "place_details_pro").catch(() => {});

  const { country, city } = extractCountryAndCity(
    data.addressComponents || []
  );

  const photoRef = data.photos?.[0]?.name || null;

  return {
    placeId: data.id || placeId,
    name: data.displayName?.text || "",
    address: data.formattedAddress || "",
    country,
    city,
    lat: data.location?.latitude || 0,
    lng: data.location?.longitude || 0,
    types: data.types || [],
    photos: [],
    photoRef,
    rating: data.rating || null,
    openingHours: data.regularOpeningHours
      ? {
          weekday_text: data.regularOpeningHours.weekdayDescriptions,
          open_now: data.currentOpeningHours?.openNow,
        }
      : null,
    website: data.websiteUri || null,
    phone: data.nationalPhoneNumber || null,
    priceLevel: data.priceLevel ? parsePriceLevel(data.priceLevel) : null,
    googleMapsUrl: data.googleMapsUri || null,
  };
}

/**
 * Search for a place by text query. Uses PRO tier ($17/1K).
 */
export async function searchPlace(
  query: string,
  apiKey: string,
  userId: string,
  lat?: number,
  lng?: number
): Promise<ParsedPlaceData | null> {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 1,
  };

  if (lat && lng) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 5000,
      },
    };
  }

  const url = `${BASE_URL}/places:searchText`;
  const fieldMask = `places.${FIELD_MASK_PRO.split(",").join(",places.")}`;
  const reqHeaders = { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask };
  const reqBody = JSON.stringify(body);
  console.log(`[Google API REQUEST] curl -X POST "${url}" -H "Content-Type: application/json" -H "X-Goog-Api-Key: ${maskApiKey(apiKey)}" -H "X-Goog-FieldMask: ${fieldMask}" -d '${reqBody}'`);

  const res = await fetch(url, { method: "POST", headers: reqHeaders, body: reqBody });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 1000)}${responseBody.length > 1000 ? "...[truncated]" : ""}`);

  if (!res.ok) return null;

  const data = JSON.parse(responseBody);
  const place = data.places?.[0];
  trackUsage(userId, "text_search_pro").catch(() => {});

  if (!place) return null;

  const { country, city } = extractCountryAndCity(
    place.addressComponents || []
  );

  const photoRef = place.photos?.[0]?.name || null;

  return {
    placeId: place.id || "",
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    country,
    city,
    lat: place.location?.latitude || 0,
    lng: place.location?.longitude || 0,
    types: place.types || [],
    photos: [],
    photoRef,
    rating: place.rating || null,
    openingHours: place.regularOpeningHours
      ? {
          weekday_text: place.regularOpeningHours.weekdayDescriptions,
          open_now: place.currentOpeningHours?.openNow,
        }
      : null,
    website: place.websiteUri || null,
    phone: place.nationalPhoneNumber || null,
    priceLevel: place.priceLevel ? parsePriceLevel(place.priceLevel) : null,
    googleMapsUrl: place.googleMapsUri || null,
  };
}

/**
 * Fetch reviews for a place. Uses ENTERPRISE tier ($20/1K).
 * Call this ONLY when user explicitly requests reviews (refresh button).
 */
export async function getPlaceReviews(
  placeId: string,
  apiKey: string,
  userId: string
): Promise<GoogleReview[]> {
  const url = `${BASE_URL}/places/${placeId}`;
  console.log(`[Google API REQUEST] curl -X GET "${url}" -H "X-Goog-Api-Key: ${maskApiKey(apiKey)}" -H "X-Goog-FieldMask: ${FIELD_MASK_REVIEWS}"`);

  const res = await fetch(url, { method: "GET", headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK_REVIEWS } });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "...[truncated]" : ""}`);

  if (!res.ok) return [];

  const data = JSON.parse(responseBody);
  trackUsage(userId, "reviews_enterprise").catch(() => {});
  return extractReviews(data.reviews);
}
