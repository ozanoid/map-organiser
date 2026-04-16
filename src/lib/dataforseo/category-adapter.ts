/**
 * Convert DataForSEO category strings to Google-compatible type format.
 *
 * DataForSEO returns: "Italian restaurant", "Cafe", "Hotel"
 * Google uses:        "italian_restaurant", "cafe", "hotel"
 *
 * The existing category-mapping.ts expects Google-style snake_case types.
 */

export function dataforseoCategoriesToGoogleTypes(
  category: string | null,
  additionalCategories: string[] | null
): string[] {
  const types: string[] = [];

  if (category) {
    types.push(normalizeToGoogleType(category));
  }

  for (const cat of additionalCategories || []) {
    const normalized = normalizeToGoogleType(cat);
    if (normalized && !types.includes(normalized)) {
      types.push(normalized);
    }
  }

  // Always include generic POI type so existing mapping has something to work with
  if (types.length > 0 && !types.includes("point_of_interest")) {
    types.push("point_of_interest");
  }

  return types;
}

/**
 * Normalize a human-readable category to Google-style snake_case.
 *
 * "Italian restaurant"  → "italian_restaurant"
 * "Bed & breakfast"     → "bed_and_breakfast"
 * "Shopping mall"       → "shopping_mall"
 * "Bar & grill"         → "bar_and_grill"
 */
function normalizeToGoogleType(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}
