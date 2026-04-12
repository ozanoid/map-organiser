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
 */

import type { ParsedPlaceData, GoogleReview } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
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

function extractCountryAndCity(components: AddressComponent[]): {
  country: string;
  city: string;
} {
  let country = "";
  let city = "";

  for (const comp of components) {
    const types = comp.types || [];
    if (types.includes("country")) {
      country = comp.longText || "";
    }
    if (
      types.includes("locality") ||
      types.includes("administrative_area_level_1")
    ) {
      if (!city) city = comp.longText || "";
    }
  }

  return { country, city };
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
  userId: string
): Promise<string | null> {
  try {
    const googleUrl = `${BASE_URL}/${photoName}/media?maxHeightPx=600&maxWidthPx=600&key=${API_KEY}`;
    console.log(`[Google API REQUEST] curl -X GET "${BASE_URL}/${photoName}/media?maxHeightPx=600&maxWidthPx=600&key=${API_KEY.substring(0,8)}...${API_KEY.substring(API_KEY.length-4)}"`);
    const res = await fetch(googleUrl);
    console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | content-type=${res.headers.get("content-type")} | content-length=${res.headers.get("content-length")}`);
    if (!res.ok) return null;

    const blob = await res.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const fileName = `${userId}/${placeId}.${ext}`;

    const supabase = await createClient();

    // Upload (overwrite if exists)
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

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("place-photos")
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (e) {
    console.error("Photo download error:", e);
    return null;
  }
}

/**
 * Fetch place details by Place ID. Uses PRO tier ($17/1K).
 * Returns 1 photo reference (not URL) for later storage.
 */
export async function getPlaceDetails(
  placeId: string
): Promise<ParsedPlaceData | null> {
  const url = `${BASE_URL}/places/${placeId}`;
  const headers = { "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": FIELD_MASK_PRO };
  console.log(`[Google API REQUEST] curl -X GET "${url}" -H "X-Goog-Api-Key: ${API_KEY.substring(0,8)}...${API_KEY.substring(API_KEY.length-4)}" -H "X-Goog-FieldMask: ${FIELD_MASK_PRO}"`);

  const res = await fetch(url, { method: "GET", headers, next: { revalidate: 86400 } });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 1000)}${responseBody.length > 1000 ? "...[truncated]" : ""}`);

  if (!res.ok) return null;

  const data = JSON.parse(responseBody);;

  const { country, city } = extractCountryAndCity(
    data.addressComponents || []
  );

  // Only take first photo REFERENCE (not media URL — that costs $7/1K)
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
    photos: [], // Empty — photo stored via downloadAndStorePhoto separately
    photoRef, // Raw reference for later download
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
  const reqHeaders = { "Content-Type": "application/json", "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": fieldMask };
  const reqBody = JSON.stringify(body);
  console.log(`[Google API REQUEST] curl -X POST "${url}" -H "Content-Type: application/json" -H "X-Goog-Api-Key: ${API_KEY.substring(0,8)}...${API_KEY.substring(API_KEY.length-4)}" -H "X-Goog-FieldMask: ${fieldMask}" -d '${reqBody}'`);

  const res = await fetch(url, { method: "POST", headers: reqHeaders, body: reqBody });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 1000)}${responseBody.length > 1000 ? "...[truncated]" : ""}`);

  if (!res.ok) return null;

  const data = JSON.parse(responseBody);
  const place = data.places?.[0];

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
  placeId: string
): Promise<GoogleReview[]> {
  const url = `${BASE_URL}/places/${placeId}`;
  console.log(`[Google API REQUEST] curl -X GET "${url}" -H "X-Goog-Api-Key: ${API_KEY.substring(0,8)}...${API_KEY.substring(API_KEY.length-4)}" -H "X-Goog-FieldMask: ${FIELD_MASK_REVIEWS}"`);

  const res = await fetch(url, { method: "GET", headers: { "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": FIELD_MASK_REVIEWS } });
  const responseBody = await res.text();

  console.log(`[Google API RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "...[truncated]" : ""}`);

  if (!res.ok) return [];

  const data = JSON.parse(responseBody);
  return extractReviews(data.reviews);
}
