/**
 * Lite profile builder — rule-based, LLM-less, sub-second.
 *
 * Called inline by /api/places/parse-link so the AddPlaceDialog can show
 * AI suggestion chips the moment a URL is parsed. The full profile (Phase 4)
 * is generated in the background after the place is saved and reviews
 * arrive.
 *
 * Inputs are loose so the function can be reused from both the parse-link
 * path (ParsedPlaceData shape) and any future preview-card flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import type { ParsedPlaceData } from "@/lib/types";
import {
  extractFeaturesLite,
  type RawPlaceData,
} from "./features-extractor";
import { resolveCategorySignals } from "./category-resolver";
import {
  matchTagsFromFeatures,
  matchListsFromProfile,
} from "./suggestions-from-profile";

interface LiteProfileInput {
  name: string;
  /**
   * Free-form address — feeds list-matching when the metropolitan city only
   * appears in the address ("Kadıköy/İstanbul" → "Istanbul Cafes" match).
   */
  address?: string | null;
  city?: string | null;
  country?: string | null;
  /** Google Places types array (DataForSEO returns these too). */
  types?: string[];
  /** DataForSEO attributes boolean map. */
  attributes?: Record<string, boolean>;
  /** DataForSEO place_topics map. */
  place_topics?: Record<string, number>;
  /** DataForSEO category_ids array (may be null). */
  category_ids?: string[];
  /** Price level (number 1-4 or string "$".."$$$$"). */
  price_level?: number | string | null;
  /** Total photo count from DataForSEO. */
  total_photos?: number;
  /** is_claimed flag from DataForSEO. */
  is_claimed?: boolean;
}

interface UserContextSlice {
  tags: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string }>;
}

/**
 * Build a lite profile for a parsed place.
 *
 * @param data     Parsed place data (post DataForSEO/Google transform).
 * @param context  User's existing tags + lists for fuzzy match.
 * @returns A `lite` PlaceProfile. All full-only fields are null.
 */
export function buildLiteProfile(
  data: LiteProfileInput,
  context: UserContextSlice
): PlaceProfile {
  const categorySignals = resolveCategorySignals(data.types, data.name);

  const rawForFeatures: RawPlaceData = {
    types: data.types,
    attributes: data.attributes,
    place_topics: data.place_topics,
    category_ids: data.category_ids,
    price_level: data.price_level,
    total_photos: data.total_photos,
    is_claimed: data.is_claimed,
  };
  const features = extractFeaturesLite(rawForFeatures);

  const suggested_tags = matchTagsFromFeatures(features, context.tags);
  const suggested_lists = matchListsFromProfile(
    features,
    {
      city: data.city,
      country: data.country,
      address: data.address,
      primaryCategory: categorySignals.primary,
      secondaryRole: categorySignals.secondary_role,
    },
    context.lists
  );

  return {
    completeness: "lite",
    category_signals: categorySignals,
    features,
    suggested_tags,
    suggested_lists,
    tldr: null,
    pros: null,
    cons: null,
    theme_insights: null,
    searchable_summary: null,
    source_review_count: 0,
    generated_at: new Date().toISOString(),
    model_version: "rule-based-v1",
  };
}

/**
 * Fetch the user's tags + lists and build a lite_profile for a parsed
 * place, gated on the user's `ai_features_enabled` flag. Returns null
 * when AI is disabled or the build throws (fail-soft: never block the
 * preview). Shared by BOTH place-preview entry points so they can't
 * drift again — /api/places/parse-link (paste flow) and
 * /api/search/retrieve/[id] (Mapbox-search flow).
 */
export async function buildLiteProfileForResponse(
  supabase: SupabaseClient,
  userId: string,
  placeData: ParsedPlaceData,
  extended?: {
    attributes?: Record<string, boolean>;
    place_topics?: Record<string, number>;
    is_claimed?: boolean;
    total_photos?: number;
  } | null
): Promise<PlaceProfile | null> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("ai_features_enabled")
      .eq("id", userId)
      .single();
    if (!profile?.ai_features_enabled) return null;

    const [{ data: tags }, { data: lists }] = await Promise.all([
      supabase.from("tags").select("id, name").eq("user_id", userId),
      supabase.from("lists").select("id, name").eq("user_id", userId),
    ]);

    return buildLiteProfile(
      {
        name: placeData.name,
        address: placeData.address,
        city: placeData.city,
        country: placeData.country,
        types: placeData.types,
        price_level: placeData.priceLevel,
        attributes: extended?.attributes,
        place_topics: extended?.place_topics,
        total_photos: extended?.total_photos,
        is_claimed: extended?.is_claimed,
      },
      {
        tags: (tags ?? []) as Array<{ id: string; name: string }>,
        lists: (lists ?? []) as Array<{ id: string; name: string }>,
      }
    );
  } catch (e) {
    console.warn("[lite_profile] build failed:", e);
    return null;
  }
}
