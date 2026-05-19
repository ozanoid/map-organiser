import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AI_SKU_CONFIG } from "@/lib/ai/track-usage";

/**
 * Backfill AI place_profile for the current user's older places.
 *
 * Phase 4 introduced the place_profile pipeline (lite at parse-link
 * time + full via the step=reviews → step=profile chain). Pre-Phase-4
 * places have no profile, which makes the Phase 6 NL filtering soft
 * features + rerank weaker than they should be for those places.
 *
 * GET  → eligibility report + cost estimate (no work performed).
 * POST → kicks off backfill. Returns immediately after queueing the
 *        background fire-and-forget calls. The user polls eligibility
 *        to watch the count come down.
 *
 * Gating: requires auth AND profiles.ai_features_enabled = true. The
 * enrich routes the backfill chains into would reject otherwise.
 */

// DataForSEO reviews price per 1k calls (per src/lib/google/track-usage.ts).
// Hard-coded here to avoid pulling Google's track-usage to the AI module.
const DATAFORSEO_REVIEWS_COST_PER_1K = 1.0; // $1 / 1000 calls (approx)

/** Hard cap on places per POST request. The route dispatches each as a
 *  fire-and-forget fetch — they run in parallel and survive past the parent
 *  response under Vercel Fluid Compute. The cap is for quota friendliness
 *  (Gemini Flash has burst limits), not request duration. The client
 *  iterates POST calls if there's more, watching the eligibility count
 *  come down. */
const MAX_PER_REQUEST = 25;

interface EligibilityReport {
  total_places: number;
  has_profile: number;
  has_reviews_no_profile: number;  // → fire step=profile only (~$0.001 each)
  has_cid_no_reviews: number;       // → fire step=reviews (chains to profile)
  no_cid_no_profile: number;        // → cannot enrich (skipped)
  estimated_cost_usd: number;
  ai_features_enabled: boolean;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .single();

  const report = await buildEligibilityReport(supabase, user.id);
  return NextResponse.json({
    ...report,
    ai_features_enabled: profileRow?.ai_features_enabled ?? true,
  } satisfies EligibilityReport);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Gate on master AI toggle. The downstream step=profile route also
  // gates, but bailing early gives a clear error.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .single();
  if (!profileRow?.ai_features_enabled) {
    return NextResponse.json(
      { error: "AI features disabled" },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
  };
  const limit = Math.max(
    1,
    Math.min(MAX_PER_REQUEST, body.limit ?? MAX_PER_REQUEST)
  );

  // Fetch eligible places — those without a profile, ordered by oldest
  // first so the user sees progress on the long-tail of pre-Phase-4 saves.
  const { data: places } = await supabase
    .from("places")
    .select("id, google_data, country")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const eligible: Array<{
    id: string;
    needs_reviews: boolean;
    country: string | null;
  }> = [];

  for (const p of places ?? []) {
    const gd = (p.google_data as Record<string, unknown> | null) ?? {};
    const hasProfile = gd.place_profile != null;
    if (hasProfile) continue;
    const reviews = gd.reviews;
    const hasReviews = Array.isArray(reviews) && reviews.length > 0;
    const cid = typeof gd.cid === "string" ? gd.cid : null;
    if (!hasReviews && !cid) continue; // unreachable
    eligible.push({
      id: p.id as string,
      needs_reviews: !hasReviews,
      country: (p.country as string | null) ?? null,
    });
    if (eligible.length >= limit) break;
  }

  if (eligible.length === 0) {
    return NextResponse.json({ queued: 0, has_more: false });
  }

  // Dispatch each as fire-and-forget. The enrich route is idempotent
  // (re-firing the same step writes the same data), so a duplicate kick
  // from another tab is safe. step=reviews chains into step=profile
  // automatically when ai_features_enabled is true.
  //
  // Why no batching / inter-batch delay: in Node, void-fetch calls run
  // in parallel regardless of dispatch order. The downstream Gemini and
  // DataForSEO routes have their own quota / rate guards; adding artificial
  // delay in this handler just stretches its wall clock without any
  // real-world throttling effect.
  const origin = request.nextUrl.origin;
  const cookieHeader = request.headers.get("cookie") ?? "";
  let queued_reviews = 0;
  let queued_profile = 0;

  for (const item of eligible) {
    const step = item.needs_reviews ? "reviews" : "profile";
    if (item.needs_reviews) queued_reviews += 1;
    else queued_profile += 1;
    void fetch(`${origin}/api/places/${item.id}/enrich?step=${step}`, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
      },
    }).catch((e) => {
      console.warn(
        `[backfill-profiles] enrich step=${step} for ${item.id} failed:`,
        e
      );
    });
  }

  console.log(
    `[backfill-profiles] user=${user.id} queued=${eligible.length} ` +
      `(reviews=${queued_reviews}, profile=${queued_profile})`
  );

  const totalRemaining = (places ?? []).filter((p) => {
    const gd = (p.google_data as Record<string, unknown> | null) ?? {};
    if (gd.place_profile != null) return false;
    const cid = typeof gd.cid === "string" ? gd.cid : null;
    const reviews = gd.reviews;
    const hasReviews = Array.isArray(reviews) && reviews.length > 0;
    return hasReviews || cid != null;
  }).length;

  return NextResponse.json({
    queued: eligible.length,
    has_more: totalRemaining > eligible.length,
    remaining_after: Math.max(0, totalRemaining - eligible.length),
  });
}

async function buildEligibilityReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Omit<EligibilityReport, "ai_features_enabled">> {
  const { data: places } = await supabase
    .from("places")
    .select("id, google_data")
    .eq("user_id", userId);

  let has_profile = 0;
  let has_reviews_no_profile = 0;
  let has_cid_no_reviews = 0;
  let no_cid_no_profile = 0;

  for (const p of places ?? []) {
    const gd = (p.google_data as Record<string, unknown> | null) ?? {};
    if (gd.place_profile != null) {
      has_profile += 1;
      continue;
    }
    const reviews = gd.reviews;
    const hasReviews = Array.isArray(reviews) && reviews.length > 0;
    const cid = typeof gd.cid === "string" ? gd.cid : null;
    if (hasReviews) {
      has_reviews_no_profile += 1;
    } else if (cid) {
      has_cid_no_reviews += 1;
    } else {
      no_cid_no_profile += 1;
    }
  }

  // Cost = (places needing reviews × DFS_reviews/1k) + (all places needing profile × ai_place_profile/1k)
  const profile_cost =
    ((has_reviews_no_profile + has_cid_no_reviews) *
      AI_SKU_CONFIG.ai_place_profile.costPer1k) /
    1000;
  const reviews_cost =
    (has_cid_no_reviews * DATAFORSEO_REVIEWS_COST_PER_1K) / 1000;
  const estimated_cost_usd = +(profile_cost + reviews_cost).toFixed(4);

  return {
    total_places: places?.length ?? 0,
    has_profile,
    has_reviews_no_profile,
    has_cid_no_reviews,
    no_cid_no_profile,
    estimated_cost_usd,
  };
}
