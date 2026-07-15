import "server-only";
import { generateText, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiClient, FLASH_MODEL, MODEL_VERSION } from "@/lib/ai/client";
import { buildUserContext } from "@/lib/ai/context-builder";
import { PlaceProfileSchema } from "@/lib/ai/schemas/place-profile";
import { buildPlaceProfilePrompt } from "@/lib/ai/prompts/place-profile-full";
import { applyProfileSuggestions } from "@/lib/ai/apply-suggestions";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";

export type GenerateProfileOutcome =
  | {
      ok: true;
      applied: Awaited<ReturnType<typeof applyProfileSuggestions>>;
    }
  | {
      ok: false;
      reason:
        | "ai_disabled"
        | "not_configured"
        | "cap_exceeded"
        | "not_found"
        | "no_reviews"
        | "llm_failed";
      capUsed?: number;
      capLimit?: number;
    };

/**
 * Generate + persist the full place_profile for one place, then run the
 * Phase 5.5 auto-apply pass.
 *
 * Extracted from enrich?step=profile (15.07.2026) so the same logic runs
 * under BOTH the cookie-scoped user client (routes) and the service-role
 * client (the refresh cron). Every query filters by userId explicitly —
 * nothing in this path relies on RLS.
 */
export async function generatePlaceProfile(
  supabase: SupabaseClient,
  userId: string,
  placeId: string
): Promise<GenerateProfileOutcome> {
  // Gates — same order as the original route: flag → client → cap.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", userId)
    .single();
  if (!profileRow?.ai_features_enabled) {
    return { ok: false, reason: "ai_disabled" };
  }

  const aiClient = getAiClient();
  if (!aiClient) {
    return { ok: false, reason: "not_configured" };
  }

  const cap = await checkAiBudget("profile", userId, supabase);
  if (cap.exceeded) {
    return {
      ok: false,
      reason: "cap_exceeded",
      capUsed: cap.used,
      capLimit: cap.cap,
    };
  }

  const { data: placeFull } = await supabase
    .from("places")
    .select("name, address, city, country, google_data, category_id, subcategory_id")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  if (!placeFull) {
    return { ok: false, reason: "not_found" };
  }

  const googleData = (placeFull.google_data as Record<string, unknown>) ?? {};
  const reviewsArr = (googleData as { reviews?: unknown[] }).reviews ?? [];
  if (!Array.isArray(reviewsArr) || reviewsArr.length === 0) {
    // Without reviews, the prompt is starved; defer to a future re-run.
    return { ok: false, reason: "no_reviews" };
  }

  const userContext = await buildUserContext(supabase, userId);
  const liteForPrior = googleData.place_profile ?? undefined;

  const currentCategoryId = (placeFull.category_id as string | null) ?? null;
  const currentCategoryName = currentCategoryId
    ? userContext.categories.find((c) => c.id === currentCategoryId)?.name ??
      null
    : null;

  const { systemPrompt, userPrompt, usedReviewCount } =
    buildPlaceProfilePrompt(
      {
        name: placeFull.name as string,
        address: (placeFull.address as string | null) ?? null,
        city: (placeFull.city as string | null) ?? null,
        country: (placeFull.country as string | null) ?? null,
        current_category_name: currentCategoryName,
        google_data: googleData,
      },
      userContext,
      liteForPrior
    );

  console.log(`[enrich:profile] Calling Gemini for ${placeId}…`);

  let profile;
  try {
    const result = await generateText({
      model: aiClient(FLASH_MODEL),
      output: Output.object({ schema: PlaceProfileSchema }),
      system: systemPrompt,
      prompt: userPrompt,
      // OTel: gen_ai.* spans → Honeycomb + Langfuse (see
      // instrumentation-node.ts). Runs under both the cookie-authed enrich
      // route and the refresh cron — the parent span in the trace tells
      // which. functionId becomes the span name.
      experimental_telemetry: {
        isEnabled: true,
        functionId: "ai.generate-profile",
        metadata: { userId, placeId },
      },
    });
    profile = result.output;
  } catch (e) {
    console.error(`[enrich:profile] LLM call failed for ${placeId}:`, e);
    return { ok: false, reason: "llm_failed" };
  }

  // Force-stamp meta fields the LLM might miss / get wrong.
  profile.completeness = "full";
  profile.generated_at = new Date().toISOString();
  profile.model_version = MODEL_VERSION;
  profile.source_review_count = usedReviewCount;

  // Persist into google_data.place_profile (re-read to avoid clobbering a
  // concurrent google_data update).
  const { data: cur } = await supabase
    .from("places")
    .select("google_data")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  const curData = (cur?.google_data as Record<string, unknown>) || {};
  await supabase
    .from("places")
    .update({ google_data: { ...curData, place_profile: profile } })
    .eq("id", placeId)
    .eq("user_id", userId);

  // Unified auto-apply (Phase 5.5): considers LLM's primary vs current
  // category, queues a category_change or a sub-cat-with-move when they
  // disagree.
  const applied = await applyProfileSuggestions(supabase, profile, {
    userId,
    placeId,
    tags: userContext.tags.map(({ id: tagId, name }) => ({ id: tagId, name })),
    subcategories: userContext.subcategories.map((s) => ({
      id: s.id,
      slug: s.slug,
      parent_category_id: s.parent_category_id,
    })),
    categories: userContext.categories.map(({ id: cid, name }) => ({
      id: cid,
      name,
    })),
    currentCategoryId,
    currentCategoryName,
    modelVersion: MODEL_VERSION,
  });

  trackAiUsage(userId, "ai_place_profile", supabase).catch(() => {});

  console.log(
    `[enrich:profile] Done for ${placeId}: tagsApplied=${applied.tagsApplied} tagsQueued=${applied.tagsQueued} subCat=${applied.subcategoryApplied ?? applied.subcategoryQueued ?? "none"} catChange=${applied.categoryChangeQueued ?? "none"}`
  );

  return { ok: true, applied };
}
