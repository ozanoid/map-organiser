/**
 * Resolves DataForSEO/Google place data into our (primary category,
 * sub-category) tuple. Rule-based. No LLM call.
 *
 * Strategy:
 *   1. Parent category — reuse the existing `resolveCategoryName` from
 *      `src/lib/google/category-mapping.ts` (Google types → 12 parents).
 *   2. Sub-category — match Google types against a sub-category dictionary
 *      keyed by Google type. First match wins (types are ordered specific
 *      → generic on Google's side).
 *   3. Confidence — 0.95 for a direct hit, 0.75 for inferred, 0 for no match.
 *
 * Output is consumed by lite-profile.ts (Phase 3) and reused as a prior in
 * the Phase 4 full LLM profile prompt.
 */

import { resolveCategoryName } from "@/lib/google/category-mapping";

/**
 * Google type → sub-category slug. Slugs must match those produced by
 * `seed_default_subcategories_for_user()` in the DB so the resolver can
 * look them up by `(parent_category_id, slug)`.
 *
 * Loose inferences (e.g. burger_restaurant → "casual") yield confidence
 * 0.75 — they auto-suggest as chips but won't auto-apply.
 */
const STRICT_TYPE_TO_SUB: Record<string, string> = {
  // Restaurant
  fine_dining_restaurant: "fine-dining",
  brunch_restaurant: "brunch",
  steak_house: "steakhouse",
  seafood_restaurant: "seafood",
  oyster_bar_restaurant: "seafood",
  fish_and_chips_restaurant: "seafood",
  sushi_restaurant: "sushi",
  ramen_restaurant: "sushi",
  pizza_restaurant: "pizza",
  kebab_shop: "kebab",
  shawarma_restaurant: "kebab",
  vegan_restaurant: "vegan-restaurant",
  vegetarian_restaurant: "vegan-restaurant",
  fast_food_restaurant: "fast-food",
  burger_restaurant: "fast-food",
  hamburger_restaurant: "fast-food",
  noodle_shop: "fast-food",
  sandwich_shop: "fast-food",
  meal_takeaway: "fast-food",

  // Cafe
  coffee_roastery: "specialty-coffee",
  coffee_stand: "specialty-coffee",
  tea_house: "specialty-coffee",
  bakery: "bakery-cafe",
  pastry_shop: "bakery-cafe",
  donut_shop: "dessert-cafe",
  cake_shop: "dessert-cafe",
  cafeteria: "brunch-cafe",

  // Bar & Nightlife
  cocktail_bar: "cocktail-bar",
  lounge_bar: "cocktail-bar",
  wine_bar: "wine-bar",
  winery: "wine-bar",
  pub: "pub",
  irish_pub: "pub",
  gastropub: "pub",
  brewpub: "pub",
  beer_garden: "beer-garden",
  brewery: "beer-garden",
  night_club: "nightclub",
  dance_hall: "nightclub",
  sports_bar: "sports-bar",
  // karaoke now has a dedicated sub-slug under Bar & Nightlife
  // (seed dictionary updated in same migration).
  karaoke: "karaoke-bar",
  // live_music_venue moved to Entertainment in the parent mapping —
  // its sub-slug now maps to "concert-venue" under Entertainment.
  live_music_venue: "concert-venue",

  // Hotel & Accommodation
  hostel: "hostel",
  bed_and_breakfast: "bed-and-breakfast",
  resort_hotel: "resort",
  guest_house: "bed-and-breakfast",

  // Shopping
  shopping_mall: "mall",
  department_store: "department-store",
  farmers_market: "local-market",
  flea_market: "local-market",
  gift_shop: "souvenir-shop",

  // Museum & Culture
  art_museum: "art-museum",
  art_gallery: "gallery",
  gallery: "gallery",
  history_museum: "history-museum",

  // Park & Nature
  national_park: "national-park",
  state_park: "national-park",
  city_park: "urban-park",
  park: "urban-park",
  botanical_garden: "botanical-garden",
  garden: "botanical-garden",
  scenic_spot: "viewpoint",
  hiking_area: "hiking-trail",

  // Beach
  beach: "sandy-beach",

  // Gym & Sports
  fitness_center: "fitness-center",
  gym: "fitness-center",
  yoga_studio: "yoga-studio",
  swimming_pool: "swimming-pool",
  stadium: "sports-arena",
  arena: "sports-arena",

  // Health & Medical
  pharmacy: "pharmacy",
  drugstore: "pharmacy",
  medical_clinic: "clinic",
  doctor: "clinic",
  hospital: "hospital",
  general_hospital: "hospital",
  spa: "spa",
  massage_spa: "spa",
  sauna: "spa",
  dental_clinic: "dental",
  dentist: "dental",

  // Entertainment
  movie_theater: "cinema",
  performing_arts_theater: "theater",
  opera_house: "theater",
  concert_hall: "concert-venue",
  amphitheatre: "concert-venue",
  amusement_park: "amusement-park",
  amusement_center: "amusement-park",
  comedy_club: "comedy-club",
};

/**
 * Inferred (loose) mappings — lower confidence. Applied only when no strict
 * match is found.
 */
const LOOSE_TYPE_TO_SUB: Record<string, string> = {
  // Many ethnic restaurants → "casual" by default
  restaurant: "casual",
  diner: "casual",
  bistro: "casual",
  food_court: "fast-food",
  cafe: "specialty-coffee",
  coffee_shop: "specialty-coffee",
  bar: "cocktail-bar",
  bar_and_grill: "cocktail-bar",
  hotel: "boutique-hotel",
  motel: "boutique-hotel",
  lodging: "boutique-hotel",
  inn: "boutique-hotel",
  museum: "history-museum",
  boutique: "boutique",
  store: "boutique",
  clothing_store: "boutique",
};

export interface CategorySignals {
  primary: string;
  primary_confidence: number;
  /** sub-category slug (e.g. "cocktail-bar") or null when no match. */
  sub_category: string | null;
  sub_category_confidence: number;
  /** For hybrid venues, the secondary parent (e.g. a restaurant that's also a bar). */
  secondary_role: string | null;
}

/**
 * Resolve category signals from Google types + place name.
 *
 * @param googleTypes  Google Places `types` array (most-specific first).
 * @param placeName    Used as a fallback heuristic (e.g. "beach" in name).
 */
export function resolveCategorySignals(
  googleTypes: string[] | undefined | null,
  placeName?: string
): CategorySignals {
  const types = Array.isArray(googleTypes) ? googleTypes : [];

  const primary = resolveCategoryName(types, placeName);
  let primary_confidence = primary === "Other" ? 0 : 0.95;

  // If we matched via the name heuristic ("beach"), confidence drops a bit
  // because we don't have type-level evidence.
  const matchedByName =
    primary !== "Other" &&
    !types.some((t) => {
      const tNorm = t.toLowerCase();
      return tNorm.endsWith("_restaurant") || tNorm in STRICT_TYPE_TO_SUB || tNorm in LOOSE_TYPE_TO_SUB;
    });
  if (matchedByName) primary_confidence = 0.7;

  // Sub-category: strict first, then loose
  let sub_category: string | null = null;
  let sub_category_confidence = 0;

  for (const t of types) {
    if (STRICT_TYPE_TO_SUB[t]) {
      sub_category = STRICT_TYPE_TO_SUB[t];
      sub_category_confidence = 0.95;
      break;
    }
  }
  if (!sub_category) {
    for (const t of types) {
      if (LOOSE_TYPE_TO_SUB[t]) {
        sub_category = LOOSE_TYPE_TO_SUB[t];
        sub_category_confidence = 0.75;
        break;
      }
    }
  }

  // Secondary role: if types contain both a restaurant and a bar signal,
  // surface the alternative (the parent NOT used as primary).
  let secondary_role: string | null = null;
  const hasRestaurantSignal = types.some(
    (t) => t === "restaurant" || t.endsWith("_restaurant") || t === "bistro"
  );
  const hasBarSignal = types.some(
    (t) =>
      t === "bar" ||
      t === "cocktail_bar" ||
      t === "wine_bar" ||
      t === "pub" ||
      t === "irish_pub" ||
      t === "gastropub" ||
      t === "bar_and_grill"
  );
  if (hasRestaurantSignal && hasBarSignal) {
    if (primary === "Restaurant") secondary_role = "Bar & Nightlife";
    else if (primary === "Bar & Nightlife") secondary_role = "Restaurant";
  }

  return {
    primary,
    primary_confidence,
    sub_category,
    sub_category_confidence,
    secondary_role,
  };
}
