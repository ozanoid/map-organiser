import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { buildUserContext, countriesForCity } from "@/lib/ai/context-builder";
import {
  ParseQuerySchema,
  type ParseQueryOutput,
} from "@/lib/ai/schemas/parse-query";
import { buildParseQueryPrompt } from "@/lib/ai/prompts/parse-query";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";

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

  // ─── Monthly SEARCH budget ───
  // Every search runs exactly one parse, so gating (and counting) here
  // charges one budget unit per search — the rank call rides along free.
  const cap = await checkAiBudget("search", user.id);
  if (cap.exceeded) {
    return NextResponse.json(
      { error: "Monthly search limit reached (500). Resets on the 1st.", used: cap.used, cap: cap.cap },
      { status: 429 }
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
      // OTel: produces gen_ai.* spans (system, model, prompt, completion,
      // input_tokens, output_tokens, latency). Picked up by @vercel/otel
      // and forwarded to Axiom via Vercel's platform pipe. functionId
      // becomes the span name. metadata becomes span attributes.
      experimental_telemetry: {
        isEnabled: true,
        functionId: "ai.parse-query",
        metadata: { userId: user.id, queryLen: query.length },
      },
    });
    parsed = result.output;
  } catch (e) {
    log.error("ai.parse-query.llm_failed", e, { userId: user.id, query });
    trackAiUsage(user.id, "ai_parse_query").catch(() => {});
    return NextResponse.json({
      hard: { search: query },
      semantic_intent: "",
      requires_semantic_ranking: false,
      needs_clarification: null,
    } satisfies ParseQueryOutput);
  }

  // ─── Defense in depth: strip IDs that aren't in the user's context ───
  let sanitized = sanitizeAgainstContext(parsed, userContext);

  // ─── Defense in depth: pair-fix hard.city / hard.country ───
  // If the LLM set city without country, look up the country from the
  // user's own data (city → country mapping built in buildUserContext).
  // This is NOT a static safety net — it's a data-driven inference from
  // what the user already has. It keeps the UI cascade (which is
  // country-first) consistent with the URL state.
  sanitized = pairCityWithCountry(sanitized, userContext);

  // ─── Track usage (fire-and-forget) ───
  trackAiUsage(user.id, "ai_parse_query").catch(() => {});

  // ─── Diagnostic logging ───
  // Structured so Axiom can filter by event / userId / hard.* fields
  // without regex parsing. The traceId attached by getTraceContext()
  // links this log to the parent gen_ai.* spans from generateText.
  log.info("ai.parse-query", {
    userId: user.id,
    query,
    hard: sanitized.hard,
    requires_rerank: sanitized.requires_semantic_ranking,
    intent: sanitized.semantic_intent,
    intent_len: sanitized.semantic_intent.length,
    needs_clarification: sanitized.needs_clarification,
  });

  return NextResponse.json(sanitized);
}

/**
 * Strip any UUIDs from the LLM output that don't appear in the user's context.
 * Catches hallucinated IDs even though the prompt forbids them.
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

  return { ...out, hard };
}

/**
 * If the LLM set `hard.city` but omitted `hard.country`, look up the
 * canonical country for that city in the user's own data and fill it in.
 *
 * The pairing matters because the filter UI (`CountryCityFilter`) is
 * country-first cascading — without a country, the city dropdown can't
 * render the city even though the URL state has it. The Vercel-side
 * filter ALSO works better with both set (less ambiguous when
 * `address ILIKE '%City%'` could otherwise match places elsewhere).
 *
 * This is NOT a static safety net (which only works for hard-coded
 * cities). It's a data-driven inference from what the user already has,
 * so it works for any city/country combination in their collection.
 *
 * Multi-country case (e.g. "London" in UK and Ontario, Canada): picks
 * the most common country by occurrence. See `countriesForCity`.
 */
function pairCityWithCountry(
  out: ParseQueryOutput,
  ctx: Awaited<ReturnType<typeof buildUserContext>>
): ParseQueryOutput {
  const city = out.hard.city?.trim();
  if (!city) return out;
  if (out.hard.country?.trim()) return out;

  const inferred = countriesForCity(ctx, city);
  if (!inferred) {
    // City isn't in the user's data — leave country empty. UI will fall
    // back to "All countries". This is rare (LLM picked a city the user
    // doesn't have), and the city filter is loose enough to still work.
    return out;
  }

  console.log(
    `[ai/parse-query] paired city='${city}' with inferred country='${inferred}'`
  );
  return { ...out, hard: { ...out.hard, country: inferred } };
}
