import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/stats — aggregate statistics for current user
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;

  // Run all queries in parallel
  const [
    placesResult,
    statusResult,
    categoryResult,
    cityResult,
    monthlyResult,
    ratingResult,
  ] = await Promise.all([
    // Hero stats
    supabase
      .from("places")
      .select("id, country, city, rating", { count: "exact" })
      .eq("user_id", userId),

    // By visit status
    supabase.rpc("get_visit_status_counts", { p_user_id: userId }).single(),

    // By category (join)
    supabase
      .from("places")
      .select("category_id, category:categories(name, color)")
      .eq("user_id", userId)
      .not("category_id", "is", null),

    // By city
    supabase
      .from("places")
      .select("city")
      .eq("user_id", userId)
      .not("city", "is", null),

    // Monthly trend (created_at)
    supabase
      .from("places")
      .select("created_at")
      .eq("user_id", userId),

    // Rating distribution
    supabase
      .from("places")
      .select("rating")
      .eq("user_id", userId)
      .not("rating", "is", null),
  ]);

  const places = placesResult.data || [];
  const total = placesResult.count || places.length;

  // Hero stats
  const countries = new Set(places.map((p) => p.country).filter(Boolean)).size;
  const cities = new Set(places.map((p) => p.city).filter(Boolean)).size;
  const ratings = places.map((p) => p.rating).filter((r): r is number => r !== null && r > 0);
  const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

  // Visit status counts (compute from places if RPC doesn't exist)
  let visitStatus: Record<string, number> = { want_to_go: 0, booked: 0, visited: 0, favorite: 0, none: 0 };
  if (statusResult.error) {
    // Fallback: compute from fetched places
    const { data: allPlaces } = await supabase
      .from("places")
      .select("visit_status")
      .eq("user_id", userId);
    for (const p of allPlaces || []) {
      const s = p.visit_status || "none";
      visitStatus[s] = (visitStatus[s] || 0) + 1;
    }
  } else {
    visitStatus = (statusResult.data as Record<string, number>) || visitStatus;
  }

  // Category distribution
  const catCounts = new Map<string, { name: string; color: string; count: number }>();
  for (const p of categoryResult.data || []) {
    const cat = p.category as any;
    if (!cat?.name) continue;
    const existing = catCounts.get(cat.name);
    if (existing) {
      existing.count++;
    } else {
      catCounts.set(cat.name, { name: cat.name, color: cat.color || "#6B7280", count: 1 });
    }
  }
  const byCategory = Array.from(catCounts.values()).sort((a, b) => b.count - a.count);

  // Top cities
  const cityCounts = new Map<string, number>();
  for (const p of cityResult.data || []) {
    if (p.city) cityCounts.set(p.city, (cityCounts.get(p.city) || 0) + 1);
  }
  const topCities = Array.from(cityCounts.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Monthly trend (last 12 months)
  const now = new Date();
  const months: { month: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      count: 0,
    });
  }
  for (const p of monthlyResult.data || []) {
    const d = new Date(p.created_at);
    const key = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const entry = months.find((m) => m.month === key);
    if (entry) entry.count++;
  }

  // Rating distribution
  const ratingDist: { rating: number; count: number }[] = [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: 0 }));
  for (const p of ratingResult.data || []) {
    const r = Math.round(p.rating);
    const entry = ratingDist.find((d) => d.rating === r);
    if (entry) entry.count++;
  }

  return NextResponse.json({
    hero: { total, countries, cities, avgRating },
    visitStatus,
    byCategory,
    topCities,
    monthlyTrend: months,
    ratingDistribution: ratingDist,
  });
}
