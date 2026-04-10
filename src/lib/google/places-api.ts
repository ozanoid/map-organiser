/**
 * Google Places API (New) wrapper.
 * Server-side only — never expose the API key to the client.
 */

import type { ParsedPlaceData, GoogleReview } from "@/lib/types";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE_URL = "https://places.googleapis.com/v1";

const FIELD_MASK = [
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
  "reviews",
  "editorialSummary",
].join(",");

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
    if (comp.types.includes("country")) {
      country = comp.longText;
    }
    if (
      comp.types.includes("locality") ||
      comp.types.includes("administrative_area_level_1")
    ) {
      if (!city) city = comp.longText;
    }
  }

  return { country, city };
}

/**
 * Fetch place details by Place ID using the new Places API.
 */
export async function getPlaceDetails(
  placeId: string
): Promise<ParsedPlaceData | null> {
  const res = await fetch(`${BASE_URL}/places/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    next: { revalidate: 86400 }, // Cache 24 hours
  });

  if (!res.ok) {
    console.error("Places API error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();

  const { country, city } = extractCountryAndCity(
    data.addressComponents || []
  );

  const photos =
    data.photos?.slice(0, 5).map((p: { name: string }) => {
      return `${BASE_URL}/${p.name}/media?maxHeightPx=400&maxWidthPx=400&key=${API_KEY}`;
    }) || [];

  return {
    placeId: data.id || placeId,
    name: data.displayName?.text || "",
    address: data.formattedAddress || "",
    country,
    city,
    lat: data.location?.latitude || 0,
    lng: data.location?.longitude || 0,
    types: data.types || [],
    photos,
    rating: data.rating || null,
    openingHours: data.regularOpeningHours
      ? {
          weekday_text: data.regularOpeningHours.weekdayDescriptions,
          open_now: data.currentOpeningHours?.openNow,
        }
      : null,
    website: data.websiteUri || null,
    phone: data.nationalPhoneNumber || null,
    reviews: extractReviews(data.reviews),
    editorialSummary: data.editorialSummary?.text || null,
    priceLevel: data.priceLevel ? parsePriceLevel(data.priceLevel) : null,
    googleMapsUrl: data.googleMapsUri || null,
  };
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
 * Search for a place by text query, optionally biased to coordinates.
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

  const res = await fetch(`${BASE_URL}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": `places.${FIELD_MASK.split(",").join(",places.")}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Places search error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const place = data.places?.[0];
  if (!place) return null;

  const { country, city } = extractCountryAndCity(
    place.addressComponents || []
  );

  const photos =
    place.photos?.slice(0, 5).map((p: { name: string }) => {
      return `${BASE_URL}/${p.name}/media?maxHeightPx=400&maxWidthPx=400&key=${API_KEY}`;
    }) || [];

  return {
    placeId: place.id || "",
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    country,
    city,
    lat: place.location?.latitude || 0,
    lng: place.location?.longitude || 0,
    types: place.types || [],
    photos,
    rating: place.rating || null,
    openingHours: place.regularOpeningHours
      ? {
          weekday_text: place.regularOpeningHours.weekdayDescriptions,
          open_now: place.currentOpeningHours?.openNow,
        }
      : null,
    website: place.websiteUri || null,
    phone: place.nationalPhoneNumber || null,
    reviews: extractReviews(place.reviews),
    editorialSummary: place.editorialSummary?.text || null,
    priceLevel: place.priceLevel ? parsePriceLevel(place.priceLevel) : null,
    googleMapsUrl: place.googleMapsUri || null,
  };
}
