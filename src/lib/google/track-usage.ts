import { createClient } from "@/lib/supabase/server";

export const SKU_CONFIG = {
  text_search_pro: { name: "Text Search", costPer1k: 17.0, freeMonthly: 5000 },
  place_details_pro: {
    name: "Place Details",
    costPer1k: 17.0,
    freeMonthly: 5000,
  },
  reviews_enterprise: {
    name: "Reviews",
    costPer1k: 20.0,
    freeMonthly: 1000,
  },
  photos: { name: "Photos", costPer1k: 7.0, freeMonthly: 1000 },
  mapbox_load: { name: "Mapbox Loads", costPer1k: 5.0, freeMonthly: 50000 },
} as const;

export type SkuType = keyof typeof SKU_CONFIG;

export async function trackUsage(
  userId: string,
  sku: SkuType
): Promise<void> {
  try {
    const supabase = await createClient();
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

  // Build result for all SKUs
  return Object.entries(SKU_CONFIG).map(([sku, config]) => {
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
