import "server-only";
import { geocodeCity } from "@/lib/mapbox/geocode";
import { fold, nameScore } from "@/lib/instagram/normalize";
import { getPlaceSearch, type FoundPlace } from "@/lib/place-search";

/**
 * Google Maps places for the Instagram import, through DataForSEO's Google
 * Maps search (the app's place-search provider) — not Google's Places API.
 * Same listings as Google Maps, with the fields the resolver weighs: phone,
 * website, address, location, Google place id and CID, rating count, closed.
 *
 * Why not Google's Text Search: it bills $35 per 1,000 past 1,000 free a
 * month, and a multi-venue post runs 16–26 searches (measured 18.11.2026).
 * DataForSEO is $0.002 a search with no free tier and no cliff. It needs a
 * point to search around and takes 3–12 s a search (Google: under a second),
 * so the import resolves venues in parallel (analyze.ts).
 *
 * A city's centre comes from Mapbox (place-level lookups only, see
 * geocode.ts); a neighbourhood or district from Google Maps itself, whose
 * answer for an area is the area (no category) with its address parts.
 */

/** One Google Maps place the resolver weighs. */
export interface PlaceCandidate {
  /** Google place id (ChIJ…), or `cid:<cid>` for a listing without one. */
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** A business or point of interest — Google gives it a category. An area's
   *  own result (a neighbourhood) has none. */
  isPlace: boolean;
  closed: boolean;
  website: string | null;
  phone: string | null;
  /** Google CID — what the import queue resolves places by. */
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

export type PlacesSku = "dataforseo_maps_search" | "mapbox_geocoding";

export interface Point {
  lat: number;
  lng: number;
}

/** A neighbourhood or district the post names, and how far it reaches. */
export interface AreaPoint extends Point {
  radiusM: number;
}

export interface PlaceLookup {
  /** Places for a query around a point; `radiusM` sets how wide. */
  search(q: CandidateQuery & { biasLat: number; biasLng: number; radiusM: number }): Promise<PlaceCandidate[]>;
  /** A neighbourhood or district by name, looked up around its city (`name`
   *  empty when the post names none — then around the venue). */
  area(name: string, city: { name: string; at: Point }): Promise<AreaPoint | null>;
  /** A city's centre. */
  city(name: string): Promise<Point | null>;
}

/** How wide a search without its own point looks around its city — the
 *  whole of a large city (zoom 11 on DataForSEO's map). */
export const CITY_RADIUS_M = 30_000;
/** Same reach as the Google types they replace: a neighbourhood, an Istanbul
 *  district (administrative_area_level_2). */
const NEIGHBOURHOOD_M = 2_000;
const DISTRICT_M = 7_000;
const SEARCH_TIMEOUT_MS = 30_000;

export function toCandidate(p: FoundPlace): PlaceCandidate | null {
  if (p.lat === null || p.lng === null) return null;
  const id = p.googlePlaceId ?? (p.cid ? `cid:${p.cid}` : null);
  if (!id) return null;
  return {
    id,
    name: p.name,
    address: p.address ?? "",
    lat: p.lat,
    lng: p.lng,
    isPlace: p.category !== null,
    closed: p.closed === "permanently",
    website: p.website,
    phone: p.phone,
    cid: p.cid,
    ratingCount: p.reviews ?? 0,
    rating: p.rating,
  };
}

/**
 * How far an area's own Google Maps result reaches, from its address parts:
 * the city itself or a region → not an area; an entry that is its own city
 * line inside a region (Kadıköy: city "Kadıköy", region "İstanbul") → a
 * district; anything inside a city or district (Moda: borough "Caferağa",
 * city "Kadıköy"; Shoreditch: city "London") → a neighbourhood.
 */
export function areaReach(found: FoundPlace, cityName: string): number | null {
  const title = fold(found.name);
  if (cityName && title === fold(cityName)) return null;
  const parts = found.addressParts;
  if (!parts) return NEIGHBOURHOOD_M;
  if (parts.region && title === fold(parts.region)) return null;
  if (parts.city && title === fold(parts.city)) return DISTRICT_M;
  return NEIGHBOURHOOD_M;
}

/** The lookup the import uses; `onBilled` hears every answered paid call. */
export function googleMapsLookup(onBilled?: (sku: PlacesSku) => void): PlaceLookup {
  const provider = getPlaceSearch();

  const find = async (query: string, at: Point, radiusM: number, limit: number): Promise<FoundPlace[]> => {
    const once = async () => {
      const res = await provider.search(
        { query, center: at, radiusM, limit },
        { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }
      );
      onBilled?.("dataforseo_maps_search");
      return res.places;
    };
    try {
      return await once();
    } catch (e) {
      console.warn(`[instagram] maps search "${query}" failed, retrying:`, e);
      return once();
    }
  };

  return {
    async search(q) {
      const found = await find(q.textQuery, { lat: q.biasLat, lng: q.biasLng }, q.radiusM, q.pageSize ?? 5);
      return found.flatMap((p) => toCandidate(p) ?? []);
    },

    async area(name, city) {
      const query = city.name && fold(city.name) !== fold(name) ? `${name}, ${city.name}` : name;
      const top = (await find(query, city.at, CITY_RADIUS_M, 3))[0];
      // An area answers with itself: no category, its own name.
      if (!top || top.category !== null || top.lat === null || top.lng === null) return null;
      if (nameScore(name, top.name) < 0.6) return null;
      const radiusM = areaReach(top, city.name);
      return radiusM ? { lat: top.lat, lng: top.lng, radiusM } : null;
    },

    async city(name) {
      const hit = await geocodeCity(name);
      onBilled?.("mapbox_geocoding");
      return hit ? { lat: hit.lat, lng: hit.lng } : null;
    },
  };
}
