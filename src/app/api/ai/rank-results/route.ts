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

  // Shape + sanitize candidates.
  const candidates: RankCandidate[] = [];
  for (const c of rawCandidates) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" ? obj.name : "";
    const summary =
      typeof obj.searchable_summary === "string"
        ? obj.searchable_summary.slice(0, SUMMARY_CHAR_CAP)
        : "";
    if (!id || !name) continue;
    candidates.push({ id, name, searchable_summary: summary });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "no valid candidates after sanitization" },
      { status: 400 }
    );
  }

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

  trackAiUsage(user.id, "ai_rank_results").catch(() => {});

  return NextResponse.json({ ranked: safeRanked } satisfies RankResultsOutput);
}
