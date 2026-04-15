import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchReviews } from "@/lib/dataforseo/reviews";
import { transformReviews } from "@/lib/dataforseo/transform";
import { trackUsage } from "@/lib/google/track-usage";

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

// POST /api/places/bulk-enrich-reviews — background batch review enrichment
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getDataForSEOClient();
  if (!client) {
    return NextResponse.json(
      { error: "DataForSEO not configured" },
      { status: 500 }
    );
  }

  const { placeIds } = await request.json();
  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return NextResponse.json(
      { error: "placeIds array required" },
      { status: 400 }
    );
  }

  let enriched = 0;
  let failed = 0;

  for (const placeId of placeIds) {
    try {
      // Fetch place to get CID
      const { data: place } = await supabase
        .from("places")
        .select("id, google_data, country")
        .eq("id", placeId)
        .eq("user_id", user.id)
        .single();

      if (!place) {
        failed++;
        continue;
      }

      const cid =
        (place.google_data as Record<string, unknown>)?.cid as
          | string
          | undefined;
      if (!cid) {
        failed++;
        continue;
      }

      const reviews = await fetchReviews(client, {
        cid,
        depth: 50,
        location_name: place.country || "United Kingdom",
      });

      if (reviews && reviews.length > 0) {
        const transformed = transformReviews(reviews);
        await trackUsage(user.id, "dataforseo_reviews");

        await supabase
          .from("places")
          .update({
            google_data: {
              ...(place.google_data as Record<string, unknown>),
              reviews: transformed,
            },
          })
          .eq("id", placeId);

        enriched++;
      } else {
        failed++;
      }

      // Rate limit between review fetches
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ enriched, failed, total: placeIds.length });
}
