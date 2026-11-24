/**
 * How many places an `ids` filter can name (GET /api/places?ids=…,
 * queryPlaces, the URL parser). It covers the largest result the assistant
 * can put on the map ("Show on map"): search_places returns at most 25.
 */
export const MAX_PLACE_IDS = 25;
