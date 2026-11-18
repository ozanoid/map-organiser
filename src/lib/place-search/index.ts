import "server-only";
import { dataForSeoMapsSearch } from "@/lib/place-search/dataforseo-maps";
import type { PlaceSearchProvider } from "@/lib/place-search/types";

export { PlaceSearchUnavailableError } from "@/lib/place-search/dataforseo-maps";
export type { FoundPlace, PlaceSearchInput, PlaceSearchProvider, PlaceSearchResult } from "@/lib/place-search/types";

/** The place-search provider in use. One place to change it. */
export function getPlaceSearch(): PlaceSearchProvider {
  return dataForSeoMapsSearch;
}
