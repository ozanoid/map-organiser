import { NextRequest, NextResponse, after } from "next/server";
import { generateText, Output } from "ai";
import { propagateAttributes } from "@langfuse/tracing";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { CompareSchema, type CompareOutput } from "@/lib/ai/schemas/compare";
import {
  buildComparePrompt,
  type CompareCandidate,
} from "@/lib/ai/prompts/compare";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * POST /api/ai/compare — S2 F-04 (v1.19.0).
 *
 * Body: { place_ids: string[] } (2-4 ids owned by the user)
 *
 * Feeds the stored place_profiles (NOT raw reviews — profiles are the
 * pre-digested corpus, so input cost is ~$0.002/compare) to Gemini and
 * returns per-theme winners + occasion-based picks. Follows the
 * parse-query route skeleton: auth → flush hook → ai_features gate →
 * client gate → budget ("compare", cap 200/mo, SKU ai_compare) →
 * validate → LLM → sanitize → track.
 *
 * The LLM references places by INDEX into the request array (v1.8.5
 * lesson); out-of-range indices are dropped here, and the response
 * echoes `order` (the ids in prompt order) so the client can map
 * idx → place without trusting the LLM.
 */

const BodySchema = z.object({
  place_ids: z.array(z.string().uuid()).min(2).max(4),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Flush Langfuse's span batch once the response is sent (serverless).
  after(flushLangfuse);

  // ─── Auth gate: ai_features_enabled flag ───
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

  // ─── AI client availability ───
  const aiClient = getAiClient();
  if (!aiClient) {
    return NextResponse.json(
      { error: "AI not configured (GOOGLE_GENERATIVE_AI_API_KEY missing)" },
      { status: 503 }
    );
  }

  // ─── Monthly COMPARE budget ───
  const cap = await checkAiBudget("compare", user.id);
  if (cap.exceeded) {
    return NextResponse.json(
      {
        error: "Monthly compare limit reached (200). Resets on the 1st.",
        used: cap.used,
        cap: cap.cap,
      },
      { status: 429 }
    );
  }

  // ─── Parse + validate input ───
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "place_ids must be 2-4 place UUIDs" },
      { status: 400 }
    );
  }
  const placeIds = [...new Set(parsed.data.place_ids)];
  if (placeIds.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 distinct places" },
      { status: 400 }
    );
  }

  // ─── Load the places (user-scoped — never trust client ids alone) ───
  const { data: places, error } = await supabase
    .from("places")
    .select("id, name, city, rating, google_data, category:categories(name)")
    .eq("user_id", user.id)
    .in("id", placeIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!places || places.length < 2) {
    return NextResponse.json(
      { error: "Places not found (need at least 2 you own)" },
      { status: 404 }
    );
  }

  // Preserve the REQUEST order — the client renders columns in this
  // order and idx references resolve against it.
  const ordered = placeIds
    .map((id) => places.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);

  const candidates: CompareCandidate[] = ordered.map((p, idx) => {
    const gd = (p.google_data ?? {}) as Record<string, unknown>;
    const profile = (gd.place_profile as PlaceProfile | undefined) ?? null;
    const category = (p.category as { name?: string } | null)?.name ?? null;
    return {
      idx,
      name: p.name,
      city: p.city ?? null,
      category,
      rating: (gd.rating as number | undefined) ?? null,
      ratingCount: (gd.user_ratings_total as number | undefined) ?? null,
      priceRange:
        (profile?.features?.price_range as string | undefined) ?? null,
      profile,
    };
  });

  const withProfile = candidates.filter(
    (c) => c.profile?.completeness === "full"
  ).length;

  const { systemPrompt, userPrompt } = buildComparePrompt(candidates);

  // ─── Call Gemini Flash ───
  let result: CompareOutput;
  try {
    const generation = await propagateAttributes(
      {
        traceName: "ai-compare",
        userId: user.id,
        tags: ["compare"],
      },
      () =>
        generateText({
          model: aiClient(FLASH_MODEL),
          output: Output.object({ schema: CompareSchema }),
          system: systemPrompt,
          prompt: userPrompt,
          // OTel: gen_ai.* spans → Honeycomb + Langfuse (see
          // instrumentation-node.ts). functionId becomes the span name.
          experimental_telemetry: {
            isEnabled: true,
            functionId: "ai.compare",
            metadata: {
              userId: user.id,
              placeCount: candidates.length,
              profiledCount: withProfile,
            },
          },
        })
    );
    result = generation.output;
  } catch (e) {
    log.error("ai.compare.llm_failed", e, {
      userId: user.id,
      placeCount: candidates.length,
    });
    // Still burn the budget unit — the LLM call was made.
    trackAiUsage(user.id, "ai_compare").catch(() => {});
    return NextResponse.json(
      { error: "Comparison failed — try again" },
      { status: 502 }
    );
  }

  // ─── Sanitize: drop out-of-range idx AND duplicate themes (the prompt
  // promises at most one verdict per theme; the LLM occasionally repeats
  // — first occurrence wins, mirroring rank-results' duplicate-idx drop).
  const maxIdx = candidates.length - 1;
  const seenThemes = new Set<string>();
  const sanitized: CompareOutput = {
    overall: result.overall,
    theme_verdicts: result.theme_verdicts.filter((t) => {
      if (t.winner_idx < 0 || t.winner_idx > maxIdx) return false;
      if (seenThemes.has(t.theme)) return false;
      seenThemes.add(t.theme);
      return true;
    }),
    pick_by_occasion: result.pick_by_occasion.filter(
      (o) => o.idx >= 0 && o.idx <= maxIdx
    ),
  };

  trackAiUsage(user.id, "ai_compare").catch(() => {});
  log.info("ai.compare", {
    userId: user.id,
    placeCount: candidates.length,
    profiledCount: withProfile,
    themeVerdicts: sanitized.theme_verdicts.length,
    occasionPicks: sanitized.pick_by_occasion.length,
  });

  return NextResponse.json({
    result: sanitized,
    /** Prompt-order ids — idx N in the result = order[N]. */
    order: ordered.map((p) => p.id),
    profiledCount: withProfile,
  });
}
