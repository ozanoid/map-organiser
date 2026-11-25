import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildUserContext, type UserContext } from "@/lib/ai/context-builder";
import { PlaceProfileSchema, type PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { buildPlaceProfilePrompt } from "@/lib/ai/prompts/place-profile-full";
import { applyProfileSuggestions } from "@/lib/ai/apply-suggestions";
import { PROFILE_WRITER } from "@/lib/agent/models";
import { MONTHLY_CAP_USD, supabaseSpendLedger } from "@/lib/agent/spend";
import { structuredClaude, type ClaudeChoice, type SpendContext } from "@/lib/agent/structured";
import { createServiceClient } from "@/lib/supabase/server";
import { loadVocabulary, type Vocabulary } from "@/lib/vocabulary/read";

/** Prompt-stated limits, enforced by truncation after generation — never in the
 *  Zod schema, where a violation costs the whole profile instead of one item. */
const MAX_PROS_CONS = 5;
const MAX_EVIDENCE_QUOTES = 2;

export type GenerateProfileOutcome =
  | {
      ok: true;
      /** null when the suggestions weren't applied (applySuggestions: false). */
      applied: Awaited<ReturnType<typeof applyProfileSuggestions>> | null;
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
      /** cap_exceeded: this month's Claude spend and the cap, in US dollars. */
      capUsed?: number;
      capLimit?: number;
    };

/** What a profile is written from: the prompts, and what applying its
 *  suggestions needs afterwards. */
export interface ProfileInputs {
  systemPrompt: string;
  userPrompt: string;
  usedReviewCount: number;
  /** Every stored review's text — what a quote in the profile must come from. */
  reviewTexts: string[];
  userContext: UserContext;
  vocabulary: Vocabulary;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
}

/**
 * Who writes the profile, and whose ledger pays: production passes
 * PROFILE_WRITER (Claude Sonnet 5.5 — Gemini wrote profiles until v1.51.0);
 * the profile eval can name another Claude model or effort.
 */
export interface ProfileWriter {
  choice: ClaudeChoice;
  spend: SpendContext;
}

/** How a profile's writing went, for the measurement. */
export interface WriteInfo {
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  /** The ledger's figure, in US dollars. */
  costUsd: number;
}

/**
 * The place and its prompts — no model call, nothing saved. Every query
 * filters by userId: it runs under the cookie-scoped client and the service
 * role alike.
 */
export async function profileInputs(
  supabase: SupabaseClient,
  userId: string,
  placeId: string
): Promise<ProfileInputs | { reason: "not_found" | "no_reviews" }> {
  const { data: placeFull } = await supabase
    .from("places")
    .select("name, address, city, country, google_data, category_id, subcategory_id")
    .eq("id", placeId)
    .eq("user_id", userId)
    .single();
  if (!placeFull) return { reason: "not_found" };

  const googleData = (placeFull.google_data as Record<string, unknown>) ?? {};
  const reviewsArr = (googleData as { reviews?: unknown[] }).reviews ?? [];
  if (!Array.isArray(reviewsArr) || reviewsArr.length === 0) {
    // Without reviews, the prompt is starved; defer to a future re-run.
    return { reason: "no_reviews" };
  }

  const [userContext, vocabulary] = await Promise.all([
    buildUserContext(supabase, userId),
    loadVocabulary(supabase),
  ]);
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
      liteForPrior,
      vocabulary
    );

  return {
    systemPrompt,
    userPrompt,
    usedReviewCount,
    reviewTexts: reviewsArr.flatMap((r) =>
      r && typeof r === "object" && typeof (r as { text?: unknown }).text === "string" ? [(r as { text: string }).text] : []
    ),
    userContext,
    vocabulary,
    currentCategoryId,
    currentCategoryName,
  };
}

/**
 * The profile, written by the given model — nothing saved. Throws when the
 * model call fails or doesn't answer with a profile. The count limits and
 * the meta fields are applied here, the same for every model.
 */
export async function writeProfile(
  inputs: ProfileInputs,
  writer: ProfileWriter,
  meta: { placeId: string }
): Promise<{ profile: PlaceProfile; info: WriteInfo }> {
  const result = await structuredClaude(
    {
      choice: writer.choice,
      system: inputs.systemPrompt,
      prompt: inputs.userPrompt,
      schema: PlaceProfileSchema,
      maxTokens: 20_000,
      label: "profile.write",
      metadata: { placeId: meta.placeId },
    },
    writer.spend
  );
  const profile = result.output;
  const info: WriteInfo = {
    model: writer.choice.model,
    ms: result.ms,
    inputTokens: result.cost.inputTokens + result.cost.cacheReadTokens + result.cost.cacheWriteTokens,
    outputTokens: result.cost.outputTokens,
    thinkingTokens: result.thinkingTokens,
    costUsd: result.cost.costUsd,
  };

  // Force-stamp meta fields the LLM might miss / get wrong.
  profile.completeness = "full";
  profile.generated_at = new Date().toISOString();
  profile.model_version = writer.choice.model;
  profile.source_review_count = inputs.usedReviewCount;

  // Enforce the prompt's count limits HERE rather than in the Zod schema.
  // A cap in the schema does not trim the extra item, it discards the whole
  // profile: a third evidence quote per theme threw away an otherwise complete
  // result built from 50 reviews. There is no retry, so an overshoot on the
  // single attempt leaves the place with no profile at all — silently, because
  // the backfill dispatches fire-and-forget.
  profile.pros = profile.pros?.slice(0, MAX_PROS_CONS) ?? null;
  profile.cons = profile.cons?.slice(0, MAX_PROS_CONS) ?? null;
  profile.theme_insights =
    profile.theme_insights?.map((t) => ({
      ...t,
      evidence_quotes: t.evidence_quotes.slice(0, MAX_EVIDENCE_QUOTES),
    })) ?? null;

  // The ids the model hands back count only when they name the user's own
  // tags and lists — the ones the prompt offered. Checked per id, for the same
  // reason as the limits above: one malformed or unknown id drops that id, not
  // the profile.
  const ownTags = new Set(inputs.userContext.tags.map((t) => t.id));
  const ownLists = new Set(inputs.userContext.lists.map((l) => l.id));
  profile.suggested_tags.matched_existing = [...new Set(profile.suggested_tags.matched_existing)].filter((id) =>
    ownTags.has(id)
  );
  profile.suggested_lists = [...new Set(profile.suggested_lists)].filter((id) => ownLists.has(id));

  return { profile, info };
}

/**
 * Generate + persist the full place_profile for one place, then run the
 * Phase 5.5 auto-apply pass.
 *
 * Extracted from enrich?step=profile (15.07.2026) so the same logic runs
 * under BOTH the cookie-scoped user client (routes) and the service-role
 * client (the refresh cron). Every query filters by userId explicitly —
 * nothing in this path relies on RLS.
 *
 * Written by Claude (PROFILE_WRITER — Sonnet 5.5 at medium, Ozan's choice
 * after the 6.2 measurement); Gemini wrote profiles until 24.11.2026. The
 * call is priced into the one ledger (purpose 'profile') and stops at its
 * monthly cap: over it, the place keeps its data and the profile waits.
 * `applySuggestions: false` replaces the profile alone — the bulk rewrite of
 * existing profiles (6.3) can leave tags and categories as they are.
 */
export async function generatePlaceProfile(
  supabase: SupabaseClient,
  userId: string,
  placeId: string,
  options: { applySuggestions?: boolean } = {}
): Promise<GenerateProfileOutcome> {
  // Gates: the user's AI switch → the Claude key → the month's cap.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", userId)
    .single();
  if (!profileRow?.ai_features_enabled) {
    return { ok: false, reason: "ai_disabled" };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "not_configured" };
  }

  // The ledger is written with the service role, whatever client the caller has.
  const ledger = supabaseSpendLedger(createServiceClient());
  const spent = await ledger.monthToDate();
  if (spent >= MONTHLY_CAP_USD) {
    return { ok: false, reason: "cap_exceeded", capUsed: spent, capLimit: MONTHLY_CAP_USD };
  }

  const inputs = await profileInputs(supabase, userId, placeId);
  if ("reason" in inputs) return { ok: false, reason: inputs.reason };

  let profile: PlaceProfile;
  try {
    const writer: ProfileWriter = {
      choice: PROFILE_WRITER,
      spend: { ledger, userId, purpose: "profile" },
    };
    profile = (await writeProfile(inputs, writer, { placeId })).profile;
  } catch (e) {
    console.error(`[enrich:profile] LLM call failed for ${placeId}:`, e);
    return { ok: false, reason: "llm_failed" };
  }

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

  if (options.applySuggestions === false) {
    console.log(`[enrich:profile] Done for ${placeId}: profile only, suggestions not applied`);
    return { ok: true, applied: null };
  }

  // Unified auto-apply (Phase 5.5): considers LLM's primary vs current
  // category, queues a category_change or a sub-cat-with-move when they
  // disagree.
  const { userContext, vocabulary, currentCategoryId, currentCategoryName } = inputs;
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
    modelVersion: PROFILE_WRITER.model,
    vocabulary,
  });

  console.log(
    `[enrich:profile] Done for ${placeId}: tagsApplied=${applied.tagsApplied} tagsQueued=${applied.tagsQueued} subCat=${applied.subcategoryApplied ?? applied.subcategoryQueued ?? "none"} catChange=${applied.categoryChangeQueued ?? "none"}`
  );

  return { ok: true, applied };
}
