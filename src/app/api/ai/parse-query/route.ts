import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { buildUserContext } from "@/lib/ai/context-builder";
import {
  ParseQuerySchema,
  type ParseQueryOutput,
} from "@/lib/ai/schemas/parse-query";
import { buildParseQueryPrompt } from "@/lib/ai/prompts/parse-query";
import { trackAiUsage } from "@/lib/ai/track-usage";

/**
 * POST /api/ai/parse-query
 *
 * Parses a natural-language query into a structured filter spec.
 *
 * Body:
 *   { query: string }   // ≤ 200 chars
 *
 * Returns:
 *   ParseQueryOutput (see src/lib/ai/schemas/parse-query.ts)
 *
 * Gated by:
 *   - auth (must be logged in)
 *   - profiles.ai_features_enabled
 *   - GOOGLE_GENERATIVE_AI_API_KEY env var
 *
 * See docs/_plans/phase-6-nl-filtering.md.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // ─── Parse + validate input ───
  const body = await request.json().catch(() => ({}));
  const rawQuery = typeof body?.query === "string" ? body.query : "";
  const query = rawQuery.trim();

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.length > 200) {
    return NextResponse.json(
      { error: "query must be ≤ 200 characters" },
      { status: 400 }
    );
  }

  // ─── Build user context and prompt ───
  const userContext = await buildUserContext(supabase, user.id);
  const { systemPrompt, userPrompt } = buildParseQueryPrompt(
    query,
    userContext
  );

  // ─── Call Gemini Flash ───
  // Schema parse failures fall back to a "treat as plain text search"
  // shape so the user still gets results, even if rerank/soft features
  // are unavailable for this query. The preprocess wrappers on
  // ParseQuerySchema catch the most common drift (empty-string optional
  // UUIDs), but unknown LLM weirdness still gets a graceful degrade.
  let parsed: ParseQueryOutput;
  try {
    const result = await generateText({
      model: aiClient(FLASH_MODEL),
      output: Output.object({ schema: ParseQuerySchema }),
      system: systemPrompt,
      prompt: userPrompt,
    });
    parsed = result.output;
  } catch (e) {
    console.error("[ai/parse-query] LLM call failed:", e);
    trackAiUsage(user.id, "ai_parse_query").catch(() => {});
    return NextResponse.json({
      hard: { search: query },
      soft_features: {},
      boosts: {},
      semantic_intent: "",
      requires_semantic_ranking: false,
      needs_clarification: null,
    } satisfies ParseQueryOutput);
  }

  // ─── Defense in depth: strip IDs that aren't in the user's context ───
  const sanitized = sanitizeAgainstContext(parsed, userContext);

  // ─── Track usage (fire-and-forget) ───
  trackAiUsage(user.id, "ai_parse_query").catch(() => {});

  return NextResponse.json(sanitized);
}

/**
 * Strip any UUIDs from the LLM output that don't appear in the user's context.
 * Catches hallucinated IDs even though the prompt forbids them. Applies to
 * BOTH `hard` and `boosts` layers.
 *
 * Returns the same shape with arrays filtered. Non-ID fields pass through.
 */
function sanitizeAgainstContext(
  out: ParseQueryOutput,
  ctx: Awaited<ReturnType<typeof buildUserContext>>
): ParseQueryOutput {
  const categoryIds = new Set(ctx.categories.map((c) => c.id));
  const subcategoryIds = new Set(ctx.subcategories.map((s) => s.id));
  const tagIds = new Set(ctx.tags.map((t) => t.id));
  const listIds = new Set(ctx.lists.map((l) => l.id));

  const hard = { ...out.hard };
  if (hard.category_ids) {
    hard.category_ids = hard.category_ids.filter((id) => categoryIds.has(id));
    if (hard.category_ids.length === 0) delete hard.category_ids;
  }
  if (hard.subcategory_ids) {
    hard.subcategory_ids = hard.subcategory_ids.filter((id) =>
      subcategoryIds.has(id)
    );
    if (hard.subcategory_ids.length === 0) delete hard.subcategory_ids;
  }
  if (hard.tag_ids) {
    hard.tag_ids = hard.tag_ids.filter((id) => tagIds.has(id));
    if (hard.tag_ids.length === 0) delete hard.tag_ids;
  }
  if (hard.list_id && !listIds.has(hard.list_id)) {
    delete hard.list_id;
  }

  const boosts = { ...out.boosts };
  if (boosts.matching_tag_ids) {
    boosts.matching_tag_ids = boosts.matching_tag_ids.filter((id) =>
      tagIds.has(id)
    );
    if (boosts.matching_tag_ids.length === 0) delete boosts.matching_tag_ids;
  }
  if (boosts.matching_list_ids) {
    boosts.matching_list_ids = boosts.matching_list_ids.filter((id) =>
      listIds.has(id)
    );
    if (boosts.matching_list_ids.length === 0) delete boosts.matching_list_ids;
  }
  if (boosts.matching_subcategory_ids) {
    boosts.matching_subcategory_ids = boosts.matching_subcategory_ids.filter(
      (id) => subcategoryIds.has(id)
    );
    if (boosts.matching_subcategory_ids.length === 0) {
      delete boosts.matching_subcategory_ids;
    }
  }

  return { ...out, hard, boosts };
}
