import type { Category } from "@/lib/types";

/**
 * Maps Google Places API types to our default category names.
 * Priority: first match wins, so more specific types should come first in the place's types array.
 */
const GOOGLE_TYPE_TO_CATEGORY: Record<string, string> = {
  // --- Restaurant (~110 types, all *_restaurant + food venues) ---
  restaurant: "Restaurant",
  american_restaurant: "Restaurant",
  asian_restaurant: "Restaurant",
  asian_fusion_restaurant: "Restaurant",
  barbecue_restaurant: "Restaurant",
  brazilian_restaurant: "Restaurant",
  breakfast_restaurant: "Restaurant",
  brunch_restaurant: "Restaurant",
  buffet_restaurant: "Restaurant",
  burger_restaurant: "Restaurant",
  chinese_restaurant: "Restaurant",
  cuban_restaurant: "Restaurant",
  diner: "Restaurant",
  dumpling_restaurant: "Restaurant",
  ethiopian_restaurant: "Restaurant",
  european_restaurant: "Restaurant",
  falafel_restaurant: "Restaurant",
  fast_food_restaurant: "Restaurant",
  fine_dining_restaurant: "Restaurant",
  fish_and_chips_restaurant: "Restaurant",
  french_restaurant: "Restaurant",
  german_restaurant: "Restaurant",
  greek_restaurant: "Restaurant",
  gyro_restaurant: "Restaurant",
  halal_restaurant: "Restaurant",
  hamburger_restaurant: "Restaurant",
  hot_pot_restaurant: "Restaurant",
  indian_restaurant: "Restaurant",
  indonesian_restaurant: "Restaurant",
  italian_restaurant: "Restaurant",
  japanese_restaurant: "Restaurant",
  kebab_shop: "Restaurant",
  korean_restaurant: "Restaurant",
  korean_barbecue_restaurant: "Restaurant",
  latin_american_restaurant: "Restaurant",
  lebanese_restaurant: "Restaurant",
  malaysian_restaurant: "Restaurant",
  mediterranean_restaurant: "Restaurant",
  mexican_restaurant: "Restaurant",
  middle_eastern_restaurant: "Restaurant",
  moroccan_restaurant: "Restaurant",
  pakistani_restaurant: "Restaurant",
  peruvian_restaurant: "Restaurant",
  pizza_restaurant: "Restaurant",
  ramen_restaurant: "Restaurant",
  seafood_restaurant: "Restaurant",
  south_indian_restaurant: "Restaurant",
  spanish_restaurant: "Restaurant",
  steak_house: "Restaurant",
  sushi_restaurant: "Restaurant",
  taco_restaurant: "Restaurant",
  thai_restaurant: "Restaurant",
  turkish_restaurant: "Restaurant",
  vegan_restaurant: "Restaurant",
  vegetarian_restaurant: "Restaurant",
  vietnamese_restaurant: "Restaurant",
  food_court: "Restaurant",
  meal_delivery: "Restaurant",
  meal_takeaway: "Restaurant",
  noodle_shop: "Restaurant",
  sandwich_shop: "Restaurant",
  salad_shop: "Restaurant",
  shawarma_restaurant: "Restaurant",
  soup_restaurant: "Restaurant",
  tapas_restaurant: "Restaurant",
  tex_mex_restaurant: "Restaurant",
  bistro: "Restaurant",
  family_restaurant: "Restaurant",
  fondue_restaurant: "Restaurant",
  fusion_restaurant: "Restaurant",
  oyster_bar_restaurant: "Restaurant",
  soul_food_restaurant: "Restaurant",
  yakiniku_restaurant: "Restaurant",
  yakitori_restaurant: "Restaurant",
  tonkatsu_restaurant: "Restaurant",

  // --- Cafe ---
  cafe: "Cafe",
  cafeteria: "Cafe",
  coffee_shop: "Cafe",
  coffee_roastery: "Cafe",
  coffee_stand: "Cafe",
  tea_house: "Cafe",
  bakery: "Cafe",
  pastry_shop: "Cafe",
  donut_shop: "Cafe",
  cake_shop: "Cafe",

  // --- Bar & Nightlife ---
  bar: "Bar & Nightlife",
  pub: "Bar & Nightlife",
  irish_pub: "Bar & Nightlife",
  gastropub: "Bar & Nightlife",
  brewpub: "Bar & Nightlife",
  sports_bar: "Bar & Nightlife",
  cocktail_bar: "Bar & Nightlife",
  wine_bar: "Bar & Nightlife",
  lounge_bar: "Bar & Nightlife",
  hookah_bar: "Bar & Nightlife",
  beer_garden: "Bar & Nightlife",
  brewery: "Bar & Nightlife",
  winery: "Bar & Nightlife",
  night_club: "Bar & Nightlife",
  karaoke: "Bar & Nightlife",
  live_music_venue: "Bar & Nightlife",
  dance_hall: "Bar & Nightlife",
  comedy_club: "Bar & Nightlife",
  bar_and_grill: "Bar & Nightlife",

  // --- Hotel & Accommodation ---
  hotel: "Hotel & Accommodation",
  hostel: "Hotel & Accommodation",
  motel: "Hotel & Accommodation",
  lodging: "Hotel & Accommodation",
  bed_and_breakfast: "Hotel & Accommodation",
  guest_house: "Hotel & Accommodation",
  resort_hotel: "Hotel & Accommodation",
  inn: "Hotel & Accommodation",
  campground: "Hotel & Accommodation",
  camping_cabin: "Hotel & Accommodation",
  cottage: "Hotel & Accommodation",
  farmstay: "Hotel & Accommodation",
  extended_stay_hotel: "Hotel & Accommodation",
  japanese_inn: "Hotel & Accommodation",
  budget_japanese_inn: "Hotel & Accommodation",
  private_guest_room: "Hotel & Accommodation",
  rv_park: "Hotel & Accommodation",
  mobile_home_park: "Hotel & Accommodation",

  // --- Shopping ---
  shopping_mall: "Shopping",
  clothing_store: "Shopping",
  shoe_store: "Shopping",
  jewelry_store: "Shopping",
  book_store: "Shopping",
  electronics_store: "Shopping",
  furniture_store: "Shopping",
  home_goods_store: "Shopping",
  department_store: "Shopping",
  convenience_store: "Shopping",
  supermarket: "Shopping",
  grocery_store: "Shopping",
  pet_store: "Shopping",
  florist: "Shopping",
  gift_shop: "Shopping",
  toy_store: "Shopping",
  hardware_store: "Shopping",
  cosmetics_store: "Shopping",
  thrift_store: "Shopping",
  flea_market: "Shopping",
  farmers_market: "Shopping",
  liquor_store: "Shopping",
  chocolate_shop: "Shopping",
  candy_store: "Shopping",
  confectionery: "Shopping",
  delicatessen: "Shopping",
  butcher_shop: "Shopping",
  health_food_store: "Shopping",
  discount_store: "Shopping",
  hypermarket: "Shopping",
  warehouse_store: "Shopping",
  wholesaler: "Shopping",
  market: "Shopping",
  general_store: "Shopping",
  home_improvement_store: "Shopping",
  garden_center: "Shopping",
  cell_phone_store: "Shopping",
  bicycle_store: "Shopping",
  auto_parts_store: "Shopping",
  building_materials_store: "Shopping",
  womens_clothing_store: "Shopping",
  store: "Shopping",
  tea_store: "Shopping",
  asian_grocery_store: "Shopping",

  // --- Museum & Culture ---
  museum: "Museum & Culture",
  art_gallery: "Museum & Culture",
  art_museum: "Museum & Culture",
  history_museum: "Museum & Culture",
  art_studio: "Museum & Culture",
  castle: "Museum & Culture",
  monument: "Museum & Culture",
  sculpture: "Museum & Culture",
  historical_landmark: "Museum & Culture",
  historical_place: "Museum & Culture",
  cultural_landmark: "Museum & Culture",
  cultural_center: "Museum & Culture",
  tourist_attraction: "Museum & Culture",
  visitor_center: "Museum & Culture",
  concert_hall: "Museum & Culture",
  opera_house: "Museum & Culture",
  performing_arts_theater: "Museum & Culture",
  philharmonic_hall: "Museum & Culture",
  amphitheatre: "Museum & Culture",
  auditorium: "Museum & Culture",
  planetarium: "Museum & Culture",
  fountain: "Museum & Culture",
  gallery: "Museum & Culture",

  // --- Park & Nature ---
  park: "Park & Nature",
  city_park: "Park & Nature",
  national_park: "Park & Nature",
  state_park: "Park & Nature",
  botanical_garden: "Park & Nature",
  garden: "Park & Nature",
  hiking_area: "Park & Nature",
  nature_preserve: "Park & Nature",
  wildlife_park: "Park & Nature",
  wildlife_refuge: "Park & Nature",
  zoo: "Park & Nature",
  scenic_spot: "Park & Nature",
  picnic_ground: "Park & Nature",
  woods: "Park & Nature",
  mountain_peak: "Park & Nature",
  lake: "Park & Nature",
  river: "Park & Nature",
  island: "Park & Nature",

  // --- Beach ---
  beach: "Beach",

  // --- Gym & Sports ---
  gym: "Gym & Sports",
  fitness_center: "Gym & Sports",
  swimming_pool: "Gym & Sports",
  stadium: "Gym & Sports",
  arena: "Gym & Sports",
  sports_complex: "Gym & Sports",
  sports_club: "Gym & Sports",
  athletic_field: "Gym & Sports",
  tennis_court: "Gym & Sports",
  golf_course: "Gym & Sports",
  ski_resort: "Gym & Sports",
  bowling_alley: "Gym & Sports",
  ice_skating_rink: "Gym & Sports",
  skateboard_park: "Gym & Sports",
  water_park: "Gym & Sports",
  adventure_sports_center: "Gym & Sports",
  go_karting_venue: "Gym & Sports",
  paintball_center: "Gym & Sports",
  cycling_park: "Gym & Sports",
  fishing_charter: "Gym & Sports",
  fishing_pier: "Gym & Sports",
  fishing_pond: "Gym & Sports",
  dog_park: "Gym & Sports",
  playground: "Gym & Sports",
  indoor_playground: "Gym & Sports",
  miniature_golf_course: "Gym & Sports",
  indoor_golf_course: "Gym & Sports",
  race_course: "Gym & Sports",
  sports_activity_location: "Gym & Sports",
  sports_coaching: "Gym & Sports",
  sports_school: "Gym & Sports",

  // --- Health & Medical ---
  hospital: "Health & Medical",
  pharmacy: "Health & Medical",
  doctor: "Health & Medical",
  dentist: "Health & Medical",
  dental_clinic: "Health & Medical",
  medical_center: "Health & Medical",
  medical_clinic: "Health & Medical",
  chiropractor: "Health & Medical",
  physiotherapist: "Health & Medical",
  spa: "Health & Medical",
  massage: "Health & Medical",
  massage_spa: "Health & Medical",
  sauna: "Health & Medical",
  wellness_center: "Health & Medical",
  yoga_studio: "Health & Medical",
  skin_care_clinic: "Health & Medical",
  tanning_studio: "Health & Medical",
  drugstore: "Health & Medical",
  medical_lab: "Health & Medical",
  general_hospital: "Health & Medical",

  // --- Entertainment ---
  movie_theater: "Entertainment",
  casino: "Entertainment",
  amusement_park: "Entertainment",
  amusement_center: "Entertainment",
  event_venue: "Entertainment",
  convention_center: "Entertainment",
  banquet_hall: "Entertainment",
  wedding_venue: "Entertainment",
  community_center: "Entertainment",
  marina: "Entertainment",
  observation_deck: "Entertainment",
  video_arcade: "Entertainment",
  ferris_wheel: "Entertainment",
  roller_coaster: "Entertainment",
  vineyard: "Entertainment",
  internet_cafe: "Entertainment",
  plaza: "Entertainment",
  off_roading_area: "Entertainment",
  movie_rental: "Entertainment",
  barbecue_area: "Entertainment",
  aquarium: "Entertainment",
};

/**
 * Resolves a category name from Google Place types.
 * Also checks for "beach" in the place name as a heuristic.
 */
export function resolveCategoryName(
  googleTypes: string[],
  placeName?: string
): string {
  // Check name heuristic for beach
  if (placeName) {
    const lowerName = placeName.toLowerCase();
    if (
      lowerName.includes("beach") ||
      lowerName.includes("plaj") ||
      lowerName.includes("sahil")
    ) {
      return "Beach";
    }
  }

  // Also handle *_restaurant pattern dynamically
  for (const type of googleTypes) {
    // Direct mapping
    if (GOOGLE_TYPE_TO_CATEGORY[type]) {
      return GOOGLE_TYPE_TO_CATEGORY[type];
    }
    // Catch-all for any *_restaurant type not explicitly listed
    if (type.endsWith("_restaurant")) {
      return "Restaurant";
    }
  }

  return "Other";
}

/**
 * Resolves a category ID from Google Place types and the user's category list.
 */
export function resolveCategoryId(
  googleTypes: string[],
  userCategories: Category[],
  placeName?: string
): string | null {
  const categoryName = resolveCategoryName(googleTypes, placeName);
  const match = userCategories.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase()
  );
  return match?.id || null;
}
