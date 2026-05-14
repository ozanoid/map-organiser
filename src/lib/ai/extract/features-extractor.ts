/**
 * Rule-based features extraction for the lite_profile path.
 *
 * Reads DataForSEO's `attributes`, `place_topics`, `category_ids`/`types`, and
 * `price_level` and emits the `features` slice of a PlaceProfile.
 *
 * Phase 4's full profile will overwrite/extend this with LLM-derived
 * `atmosphere`, `occasions`, `music`, `crowd` — all of which we leave empty
 * here (they require review-corpus understanding).
 */

import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";

type Features = PlaceProfile["features"];
type AttrMap = Record<string, boolean | undefined>;

/** Google type → cuisine label. Title-cased so they look nice as tag suggestions. */
const TYPE_TO_CUISINE: Record<string, string> = {
  american_restaurant: "American",
  asian_restaurant: "Asian",
  asian_fusion_restaurant: "Asian Fusion",
  barbecue_restaurant: "Barbecue",
  brazilian_restaurant: "Brazilian",
  burger_restaurant: "Burgers",
  hamburger_restaurant: "Burgers",
  chinese_restaurant: "Chinese",
  cuban_restaurant: "Cuban",
  ethiopian_restaurant: "Ethiopian",
  european_restaurant: "European",
  falafel_restaurant: "Middle Eastern",
  french_restaurant: "French",
  german_restaurant: "German",
  greek_restaurant: "Greek",
  gyro_restaurant: "Greek",
  halal_restaurant: "Halal",
  hot_pot_restaurant: "Chinese",
  indian_restaurant: "Indian",
  indonesian_restaurant: "Indonesian",
  italian_restaurant: "Italian",
  japanese_restaurant: "Japanese",
  sushi_restaurant: "Japanese",
  ramen_restaurant: "Japanese",
  kebab_shop: "Turkish",
  korean_restaurant: "Korean",
  korean_barbecue_restaurant: "Korean",
  latin_american_restaurant: "Latin American",
  lebanese_restaurant: "Lebanese",
  malaysian_restaurant: "Malaysian",
  mediterranean_restaurant: "Mediterranean",
  mexican_restaurant: "Mexican",
  middle_eastern_restaurant: "Middle Eastern",
  modern_european_restaurant: "European",
  moroccan_restaurant: "Moroccan",
  pakistani_restaurant: "Pakistani",
  peruvian_restaurant: "Peruvian",
  pizza_restaurant: "Italian",
  seafood_restaurant: "Seafood",
  south_indian_restaurant: "Indian",
  spanish_restaurant: "Spanish",
  tapas_restaurant: "Spanish",
  thai_restaurant: "Thai",
  turkish_restaurant: "Turkish",
  vegan_restaurant: "Vegan",
  vegetarian_restaurant: "Vegetarian",
  vietnamese_restaurant: "Vietnamese",
  yakiniku_restaurant: "Japanese",
  yakitori_restaurant: "Japanese",
  tonkatsu_restaurant: "Japanese",
  tex_mex_restaurant: "Mexican",
  shawarma_restaurant: "Middle Eastern",
  oyster_bar_restaurant: "Seafood",
  fish_and_chips_restaurant: "British",
  fusion_restaurant: "Fusion",
};

function extractCuisines(types: string[]): string[] {
  const found = new Set<string>();
  for (const t of types) {
    if (TYPE_TO_CUISINE[t]) {
      found.add(TYPE_TO_CUISINE[t]);
    }
  }
  return [...found];
}

function extractDietary(attrs: AttrMap): string[] {
  const found = new Set<string>();
  if (attrs.serves_vegan) found.add("vegan");
  if (attrs.serves_vegetarian) found.add("vegetarian");
  if (attrs.serves_organic) found.add("organic");
  if (attrs.has_gluten_free_options) found.add("gluten-free");
  if (attrs.has_halal_options || attrs.is_halal) found.add("halal");
  if (attrs.has_kosher_options || attrs.is_kosher) found.add("kosher");
  return [...found];
}

function extractSeating(attrs: AttrMap): string[] {
  const found = new Set<string>();
  if (attrs.has_seating_outdoors) found.add("outdoor");
  if (attrs.has_seating) found.add("indoor");
  if (attrs.has_private_dining_room) found.add("private-room");
  if (attrs.has_counter_service) found.add("counter");
  if (attrs.has_bar_onsite) found.add("bar-seating");
  return [...found];
}

function extractDistinctive(
  attrs: AttrMap,
  topPhotos: number | undefined,
  isClaimed: boolean | undefined
): string[] {
  const found = new Set<string>();
  if (attrs.has_wi_fi) found.add("wifi");
  if (attrs.welcomes_lgbtq || attrs.is_transgender_safespace) found.add("lgbtq-friendly");
  if (
    attrs.welcomes_dogs ||
    attrs.allows_dogs_inside ||
    attrs.allows_dogs_outside
  ) {
    found.add("dog-friendly");
  }
  if (
    attrs.has_wheelchair_accessible_entrance ||
    attrs.has_wheelchair_accessible_seating ||
    attrs.has_wheelchair_accessible_restroom
  ) {
    found.add("accessible");
  }
  if (attrs.has_live_music || attrs.has_live_performances) {
    found.add("live-music");
  }
  if (attrs.welcomes_children || attrs.welcomes_families || attrs.has_high_chairs) {
    found.add("family-friendly");
  }
  if (attrs.has_onsite_parking) found.add("parking");
  if (attrs.accepts_reservations || attrs.recommends_reservations_dinner) {
    found.add("reservations");
  }
  // Heuristic flags from non-attribute signals
  if (typeof topPhotos === "number" && topPhotos > 500) {
    found.add("photogenic");
  }
  if (isClaimed === false) {
    found.add("unclaimed");
  }
  return [...found];
}

const PRICE_LEVEL_TO_RANGE: Record<number, "$" | "$$" | "$$$" | "$$$$"> = {
  1: "$",
  2: "$$",
  3: "$$$",
  4: "$$$$",
};

function extractPriceRange(
  priceLevel: number | string | undefined | null
): Features["price_range"] {
  if (priceLevel == null) return null;
  // DataForSEO can return number 1-4 OR string "$" / "$$" / "$$$"
  if (typeof priceLevel === "number") {
    return PRICE_LEVEL_TO_RANGE[priceLevel] ?? null;
  }
  const s = String(priceLevel).trim();
  if (s === "$" || s === "$$" || s === "$$$" || s === "$$$$") return s;
  const n = Number(s);
  if (!Number.isNaN(n)) return PRICE_LEVEL_TO_RANGE[n] ?? null;
  return null;
}

export interface RawPlaceData {
  types?: string[];
  attributes?: Record<string, boolean>;
  place_topics?: Record<string, number>;
  category_ids?: string[];
  price_level?: number | string | null;
  total_photos?: number;
  is_claimed?: boolean;
}

/**
 * Build the `features` slice for a lite profile. LLM-derived fields
 * (atmosphere, occasions, music, crowd) are left empty — they require
 * review-corpus understanding (Phase 4).
 */
export function extractFeaturesLite(data: RawPlaceData): Features {
  const types = data.types ?? [];
  const attrs: AttrMap = data.attributes ?? {};

  return {
    cuisine_types: extractCuisines(types),
    dietary: extractDietary(attrs),
    atmosphere: [],
    occasions: [],
    seating: extractSeating(attrs),
    music: [],
    crowd: [],
    price_range: extractPriceRange(data.price_level ?? null),
    distinctive: extractDistinctive(attrs, data.total_photos, data.is_claimed),
  };
}
