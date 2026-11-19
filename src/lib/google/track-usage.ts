import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { AI_SKU_CONFIG } from "@/lib/ai/track-usage";

/**
 * Every paid SKU the app tracks. Google Places SKUs are retired since
 * v1.42.0 (every place lookup goes through DataForSEO): nothing writes them,
 * and the cost tracker shows them only in a month that still has usage.
 */
export const SKU_CONFIG = {
  text_search_pro: { name: "Text Search", costPer1k: 17.0, freeMonthly: 5000, retired: true },
  place_details_pro: {
    name: "Place Details",
    costPer1k: 17.0,
    freeMonthly: 5000,
    retired: true,
  },
  reviews_enterprise: {
    name: "Reviews",
    costPer1k: 20.0,
    freeMonthly: 1000,
    retired: true,
  },
  photos: { name: "Photos", costPer1k: 7.0, freeMonthly: 1000, retired: true },
  mapbox_load: { name: "Mapbox Loads", costPer1k: 5.0, freeMonthly: 50000 },
  // DataForSEO SKUs
  dataforseo_business_info_live: {
    name: "DataForSEO Business Info",
    costPer1k: 5.4,
    freeMonthly: 0,
  },
  // Per task, billed when the task is created: $0.0075 at depth 50 and
  // priority 2 — what every caller asks for (measured 19.11.2026; depth 10
  // costs $0.0015). Was 0.75 — the price of 10 reviews at standard priority —
  // so the report showed a tenth of the spend.
  dataforseo_reviews: {
    name: "DataForSEO Reviews",
    costPer1k: 7.5,
    freeMonthly: 0,
  },
  mapbox_search_session: {
    name: "Mapbox Search Sessions",
    costPer1k: 11.5,
    freeMonthly: 500,
  },
  // v1.22.0 (NF-07): Directions calls were previously fully untracked —
  // one call per multi-place day per trip-detail/shared view, recomputed
  // every GET (no cache yet). Mapbox pricing: 100k free, then $2/1k.
  mapbox_directions: {
    name: "Mapbox Directions",
    costPer1k: 2.0,
    freeMonthly: 100000,
  },
  // Assistant tools: an area name ("Shoreditch, London") → a point for
  // "near" searches. Mapbox temporary geocoding: 100k free, then $0.75/1k.
  mapbox_geocoding: {
    name: "Mapbox Geocoding",
    costPer1k: 0.75,
    freeMonthly: 100000,
  },
  // Assistant tools: Google Maps search through DataForSEO's SERP API
  // (live). $0.002 per search of up to 100 results; confirmed by the `cost`
  // field of live responses on 18.11.2026.
  dataforseo_maps_search: {
    name: "DataForSEO Maps Search",
    costPer1k: 2.0,
    freeMonthly: 0,
  },
  // Instagram import: candidate search asks for website + phone, which puts
  // Text Search on the Enterprise SKU ($35/1K after 1K free per month).
  text_search_enterprise: {
    name: "Text Search (Enterprise)",
    costPer1k: 35.0,
    freeMonthly: 1000,
    retired: true,
  },
  // Instagram import: one per post, reel-usertags and profile read
  // (HikerAPI pay-as-you-go plan, $1 per 1,000 requests).
  hikerapi_request: {
    name: "HikerAPI Requests",
    costPer1k: 1.0,
    freeMonthly: 0,
  },
} as const;

export type SkuType = keyof typeof SKU_CONFIG;

export async function trackUsage(
  userId: string,
  sku: SkuType,
  client?: SupabaseClient
): Promise<void> {
  try {
    const supabase = client ?? (await createClient());
    const config = SKU_CONFIG[sku];
    await supabase.rpc("increment_api_usage", {
      p_user_id: userId,
      p_sku: sku,
      p_cost: config.costPer1k,
    });
  } catch (e) {
    // Don't fail the main request if tracking fails
    console.error("[Usage Tracking] Error:", e);
  }
}

export interface MonthlyUsage {
  sku: string;
  name: string;
  count: number;
  freeLimit: number;
  costPer1k: number;
  estimatedCost: number;
}

export async function getMonthlyUsage(
  userId: string
): Promise<MonthlyUsage[]> {
  const supabase = await createClient();

  // Get first day of current month in UTC (matches Supabase timestamps)
  const now = new Date();
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const { data: rows } = await supabase
    .from("api_usage")
    .select("sku, count")
    .eq("user_id", userId)
    .gte("created_at", firstOfMonth);

  // Aggregate by SKU
  const totals: Record<string, number> = {};
  for (const row of rows || []) {
    totals[row.sku] = (totals[row.sku] || 0) + row.count;
  }

  // Build result for all SKUs — Google/DataForSEO/Mapbox (SKU_CONFIG) plus
  // the AI SKUs (AI_SKU_CONFIG), which live in a separate registry but write
  // the same api_usage table. Without the merge the cost tracker silently
  // omits every ai_* SKU.
  const DISPLAY_CONFIG = { ...SKU_CONFIG, ...AI_SKU_CONFIG };
  // A retired SKU (Google Places, v1.42.0) shows only in a month it was used.
  const shown = Object.entries(DISPLAY_CONFIG).filter(
    ([sku, config]) => !("retired" in config && config.retired) || (totals[sku] || 0) > 0
  );
  return shown.map(([sku, config]) => {
    const count = totals[sku] || 0;
    const billableCount = Math.max(0, count - config.freeMonthly);
    const estimatedCost = (billableCount / 1000) * config.costPer1k;
    return {
      sku,
      name: config.name,
      count,
      freeLimit: config.freeMonthly,
      costPer1k: config.costPer1k,
      estimatedCost,
    };
  });
}
