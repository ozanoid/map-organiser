import "server-only";

/**
 * Google Places API (New) Text Search returning several candidates with the
 * fields the Instagram import uses as evidence (phone, website, Maps URI).
 *
 * `websiteUri` and the phone fields put every request on the Text Search
 * ENTERPRISE SKU ($35/1K, 1K free per month) — track it as
 * `text_search_enterprise`, not the Pro SKU `searchPlace` uses.
 */

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "businessStatus",
  "websiteUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "googleMapsUri",
  "userRatingCount",
  "rating",
]
  .map((f) => `places.${f}`)
  .join(",");

export interface PlaceCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
  status: string | null;
  website: string | null;
  phone: string | null;
  mapsUri: string | null;
  /** Google CID from the Maps URI — what the import queue resolves places by. */
  cid: string | null;
  ratingCount: number;
  rating: number | null;
}

export interface CandidateQuery {
  textQuery: string;
  biasLat?: number;
  biasLng?: number;
  radiusM?: number;
  pageSize?: number;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  businessStatus?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  userRatingCount?: number;
  rating?: number;
}

export async function searchPlaceCandidates(
  query: CandidateQuery,
  apiKey: string
): Promise<PlaceCandidate[]> {
  const body: Record<string, unknown> = {
    textQuery: query.textQuery,
    pageSize: query.pageSize ?? 5,
  };
  if (query.biasLat != null && query.biasLng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: query.biasLat, longitude: query.biasLng },
        radius: query.radiusM ?? 1000,
      },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Text Search ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: RawPlace[] };
  return (data.places ?? [])
    .filter((p) => p.id && p.location?.latitude != null && p.location?.longitude != null)
    .map((p) => ({
      id: p.id!,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      lat: p.location!.latitude!,
      lng: p.location!.longitude!,
      types: p.types ?? [],
      status: p.businessStatus ?? null,
      website: p.websiteUri ?? null,
      phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
      mapsUri: p.googleMapsUri ?? null,
      cid: p.googleMapsUri?.match(/[?&]cid=(\d+)/)?.[1] ?? null,
      ratingCount: p.userRatingCount ?? 0,
      rating: p.rating ?? null,
    }));
}
