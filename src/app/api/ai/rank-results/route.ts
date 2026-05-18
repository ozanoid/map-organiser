import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import {
  RankResultsSchema,
  type RankResultsOutput,
} from "@/lib/ai/schemas/rank-results";
import {
  buildRankResultsPrompt,
  type RankCandidate,
} from "@/lib/ai/prompts/rank-results";
import { trackAiUsage } from "@/lib/ai/track-usage";

/** Cost guard: refuse to rerank more than this many candidates in one call. */
const MAX_CANDIDATES = 200;
/** Per-summary cap to keep token cost bounded. */
const SUMMARY_CHAR_CAP = 1500;
/** Score bump applied to candidates that match a boost criterion.
 *  Capped at 1.0 after add. Empirical: 0.15 puts a borderline match (~0.5)
 *  comfortably ahead of a strong-but-uncurated match (~0.7 → unchanged). */
const BOOST_DELTA = 0.15;

/**
 * POST /api/ai/rank-results
 *
 * LLM-as-judge ranker for the NL filtering pipeline. Called by the client
 * when parse-query returns `requires_semantic_ranking: true`.
 *
 * Body:
 *   {
 *     semantic_intent: string,
 *     candidates: { id, name, searchable_summary }[]
 *   }
 *
 * Returns: RankResultsOutput (every input candidate, scored 0..1).
 *
 * Gating:
 *   - auth
 *   - profiles.ai_features_enabled
 *   - GOOGLE_GENERATIVE_AI_API_KEY env
 *   - candidates.length ∈ [1, MAX_CANDIDATES]
 *
 * SKU: ai_rank_results — ~$0.002/call at 50 candidates.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Auth gate: ai_features_enabled ───
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

  // ─── AI client ───
  const aiClient = getAiClient();
  if (!aiClient) {
    return NextResponse.json(
      { error: "AI not configured (GOOGLE_GENERATIVE_AI_API_KEY missing)" },
      { status: 503 }
    );
  }

  // ─── Parse + validate input ───
  const body = (await request.json().catch(() => ({}))) as {
    semantic_intent?: unknown;
    candidates?: unknown;
  };

  const semanticIntent =
    typeof body.semantic_intent === "string" ? body.semantic_intent.trim() : "";
  if (!semanticIntent) {
    return NextResponse.json(
      { error: "semantic_intent is required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.candidates)) {
    return NextResponse.json(
      { error: "candidates must be an array" },
      { status: 400 }
    );
  }

  const rawCandidates = body.candidates as unknown[];
  if (rawCandidates.length === 0) {
    return NextResponse.json({ ranked: [] } satisfies RankResultsOutput);
  }
  if (rawCandidates.length > MAX_CANDIDATES) {
    return NextResponse.json(
      {
        error: `Too many candidates (${rawCandidates.length}). Cap is ${MAX_CANDIDATES}; pre-filter on the client.`,
      },
      { status: 400 }
    );
  }

  // Shape + sanitize candidates. We carry subcategory_id alongside for the
  // sub-cat boost — it's already on the place row client-side.
  const candidates: RankCandidate[] = [];
  const candidateSubcat = new Map<string, string | null>();
  for (const c of rawCandidates) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" ? obj.name : "";
    const summary =
      typeof obj.searchable_summary === "string"
        ? obj.searchable_summary.slice(0, SUMMARY_CHAR_CAP)
        : "";
    const subcategoryId =
      typeof obj.subcategory_id === "string" ? obj.subcategory_id : null;
    if (!id || !name) continue;
    candidates.push({ id, name, searchable_summary: summary });
    candidateSubcat.set(id, subcategoryId);
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "no valid candidates after sanitization" },
      { status: 400 }
    );
  }

  // Parse boost intents (optional). IDs are filtered to those that came from
  // parse-query (already sanitized server-side there). We re-validate length
  // bounds only — boost IDs aren't trusted as filter criteria, only as
  // join targets in this scope.
  const boostTagIds = Array.isArray(body && (body as { boost_tag_ids?: unknown }).boost_tag_ids)
    ? ((body as { boost_tag_ids?: unknown[] }).boost_tag_ids as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];
  const boostListIds = Array.isArray(
    body && (body as { boost_list_ids?: unknown }).boost_list_ids
  )
    ? (
        (body as { boost_list_ids?: unknown[] }).boost_list_ids as unknown[]
      ).filter((v): v is string => typeof v === "string")
    : [];
  const boostSubcategoryIds = Array.isArray(
    body && (body as { boost_subcategory_ids?: unknown }).boost_subcategory_ids
  )
    ? (
        (body as { boost_subcategory_ids?: unknown[] })
          .boost_subcategory_ids as unknown[]
      ).filter((v): v is string => typeof v === "string")
    : [];

  // ─── Call Gemini Flash ───
  const { systemPrompt, userPrompt } = buildRankResultsPrompt(
    semanticIntent,
    candidates
  );

  let ranked: RankResultsOutput;
  try {
    const result = await generateText({
      model: aiClient(FLASH_MODEL),
      output: Output.object({ schema: RankResultsSchema }),
      system: systemPrompt,
      prompt: userPrompt,
    });
    ranked = result.output;
  } catch (e) {
    console.error("[ai/rank-results] LLM call failed:", e);
    return NextResponse.json(
      { error: "Ranking failed." },
      { status: 500 }
    );
  }

  // ─── Defense: ensure every output ID was in input ───
  const allowedIds = new Set(candidates.map((c) => c.id));
  const safeRanked = ranked.ranked.filter((r) => allowedIds.has(r.id));

  // ─── Boost post-processing ───
  // Resolve which candidate IDs match each boost criterion, then add a flat
  // BOOST_DELTA to their scores (capped at 1.0). This rewards user-curated
  // relevance signals WITHOUT excluding non-curated candidates — that was
  // the key bug fix in v1.7.1.
  const candidateIds = candidates.map((c) => c.id);
  const boostedIds = new Set<string>();

  // Sub-cat boost: in-memory check, no Supabase query needed.
  if (boostSubcategoryIds.length > 0) {
    const wanted = new Set(boostSubcategoryIds);
    for (const [pid, sid] of candidateSubcat) {
      if (sid && wanted.has(sid)) boostedIds.add(pid);
    }
  }

  // Tag boost: query place_tags scoped to (candidates ∩ wanted tags).
  // RLS scopes by user automatically.
  if (boostTagIds.length > 0) {
    const { data: rows } = await supabase
      .from("place_tags")
      .select("place_id")
      .in("tag_id", boostTagIds)
      .in("place_id", candidateIds);
    for (const r of rows ?? []) {
      if (typeof r.place_id === "string") boostedIds.add(r.place_id);
    }
  }

  // List boost: same pattern against list_places.
  if (boostListIds.length > 0) {
    const { data: rows } = await supabase
      .from("list_places")
      .select("place_id")
      .in("list_id", boostListIds)
      .in("place_id", candidateIds);
    for (const r of rows ?? []) {
      if (typeof r.place_id === "string") boostedIds.add(r.place_id);
    }
  }

  const boostedRanked = safeRanked.map((r) =>
    boostedIds.has(r.id)
      ? { ...r, score: Math.min(1, r.score + BOOST_DELTA) }
      : r
  );

  trackAiUsage(user.id, "ai_rank_results").catch(() => {});

  return NextResponse.json({
    ranked: boostedRanked,
  } satisfies RankResultsOutput);
}
