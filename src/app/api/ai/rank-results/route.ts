import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import {
  LlmRankSchema,
  type LlmRankOutput,
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
/** Per-tldr cap. */
const TLDR_CHAR_CAP = 400;

/**
 * POST /api/ai/rank-results
 *
 * LLM-as-judge ranker (Phase 6.5). Called when parse-query returns
 * `requires_semantic_ranking: true`. Each candidate ships with its
 * FULL place_profile (features.* + theme_insights + tldr + pros + cons
 * + searchable_summary); the LLM judges holistically against the rich
 * `semantic_intent`.
 *
 * Body:
 *   {
 *     semantic_intent: string,
 *     candidates: {
 *       id, name, searchable_summary,
 *       features: object,
 *       theme_insights: array | null,
 *       tldr: string | null,
 *       pros: string[] | null,
 *       cons: string[] | null
 *     }[]
 *   }
 *
 * Returns: RankResultsOutput (every input candidate scored 0..1).
 *
 * Phase 6.5 change: BOOST POST-PROCESS REMOVED. The +0.15 score bump
 * for tag/list/sub-cat matches is gone. User curation surfaces as
 * opt-in UI hint chips, not as hidden scoring. Discovery preserved.
 *
 * Gating:
 *   - auth
 *   - profiles.ai_features_enabled
 *   - GOOGLE_GENERATIVE_AI_API_KEY env
 *   - candidates.length ∈ [1, MAX_CANDIDATES]
 *
 * SKU: ai_rank_results — ~$0.005/call at 50 candidates with full payload.
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

  // Shape + sanitize candidates with the FULL payload.
  const candidates: RankCandidate[] = [];
  for (const c of rawCandidates) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" ? obj.name : "";
    if (!id || !name) continue;

    const summary =
      typeof obj.searchable_summary === "string"
        ? obj.searchable_summary.slice(0, SUMMARY_CHAR_CAP)
        : "";
    const features =
      typeof obj.features === "object" && obj.features !== null
        ? (obj.features as Record<string, unknown>)
        : {};
    const theme_insights = Array.isArray(obj.theme_insights)
      ? obj.theme_insights
      : null;
    const tldr =
      typeof obj.tldr === "string" ? obj.tldr.slice(0, TLDR_CHAR_CAP) : null;
    const pros = Array.isArray(obj.pros)
      ? (obj.pros as unknown[]).filter((v): v is string => typeof v === "string")
      : null;
    const cons = Array.isArray(obj.cons)
      ? (obj.cons as unknown[]).filter((v): v is string => typeof v === "string")
      : null;

    candidates.push({
      id,
      name,
      searchable_summary: summary,
      features,
      theme_insights,
      tldr,
      pros,
      cons,
    });
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

  let llmRanked: LlmRankOutput;
  try {
    const result = await generateText({
      model: aiClient(FLASH_MODEL),
      output: Output.object({ schema: LlmRankSchema }),
      system: systemPrompt,
      prompt: userPrompt,
    });
    llmRanked = result.output;
  } catch (e) {
    // Salvage path (v1.8.3, kept). AI SDK throws AI_NoObjectGeneratedError
    // when the LLM output fails strict schema validation. The schema's
    // preprocess (truncate >200-char `why`, clamp score, coerce idx string
    // to number) fixes all observed cases; we re-parse manually so the
    // preprocess can fire.
    const errAny = e as { name?: string; text?: string };
    if (
      errAny?.name === "AI_NoObjectGeneratedError" &&
      typeof errAny.text === "string"
    ) {
      try {
        const rawParsed = JSON.parse(errAny.text);
        llmRanked = LlmRankSchema.parse(rawParsed);
        console.warn(
          "[ai/rank-results] salvaged from validation failure via preprocess re-parse"
        );
      } catch (salvageErr) {
        console.error("[ai/rank-results] LLM call failed:", e);
        console.error("[ai/rank-results] salvage also failed:", salvageErr);
        return NextResponse.json(
          { error: "Ranking failed." },
          { status: 500 }
        );
      }
    } else {
      console.error("[ai/rank-results] LLM call failed:", e);
      return NextResponse.json(
        { error: "Ranking failed." },
        { status: 500 }
      );
    }
  }

  // ─── Map idx → id, detect out-of-range and duplicates ───
  // v1.8.5: LLM references candidates by local idx (0..N-1) instead of
  // UUID, eliminating the 36-char copy errors that caused skipped/
  // hallucinated entries in earlier versions. The mapping below is the
  // only place we ever look up by idx.
  const N = candidates.length;
  const seenIdx = new Set<number>();
  let outOfRangeCount = 0;
  let duplicateCount = 0;
  const safeRanked: RankResultsOutput["ranked"] = [];

  for (const r of llmRanked.ranked) {
    if (r.idx < 0 || r.idx >= N) {
      outOfRangeCount++;
      continue;
    }
    if (seenIdx.has(r.idx)) {
      duplicateCount++;
      continue;
    }
    seenIdx.add(r.idx);
    safeRanked.push({
      id: candidates[r.idx].id,
      score: r.score,
      why: r.why,
    });
  }

  if (outOfRangeCount > 0) {
    console.warn(
      `[ai/rank-results] LLM emitted ${outOfRangeCount} out-of-range idx(es) (N=${N}) — dropped.`
    );
  }
  if (duplicateCount > 0) {
    console.warn(
      `[ai/rank-results] LLM emitted ${duplicateCount} duplicate idx(es) — first kept, rest dropped.`
    );
  }

  // ─── Detect LLM laziness: candidates sent but not returned ───
  // Fill missing with score=0 + sentinel why so place cards don't render
  // with a confusing mixed state (some ranked, some not). Score=0 falls
  // under HIDE_BELOW_SCORE (0.20) so they're cleanly hidden by the same
  // threshold that hides LLM-judged irrelevant matches.
  const missingCandidates = candidates.filter((_, idx) => !seenIdx.has(idx));
  if (missingCandidates.length > 0) {
    console.warn(
      `[ai/rank-results] LLM skipped ${missingCandidates.length}/${N} candidate(s):`,
      missingCandidates.map((c) => `${c.name} (idx=${candidates.indexOf(c)})`).join(", ")
    );
    for (const c of missingCandidates) {
      safeRanked.push({
        id: c.id,
        score: 0,
        why: "Not evaluated by AI in this run.",
      });
    }
  }

  trackAiUsage(user.id, "ai_rank_results").catch(() => {});

  // ─── Diagnostic logging ───
  const top5 = safeRanked
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((r) => {
      const name = candidates.find((c) => c.id === r.id)?.name ?? "?";
      return `${r.score.toFixed(2)} ${name}: ${r.why}`;
    })
    .join(" | ");
  const withProfile = candidates.filter(
    (c) => c.searchable_summary && c.searchable_summary.length > 0
  ).length;
  const hiddenCount = safeRanked.filter((r) => r.score < 0.2).length;
  console.log(
    `[ai/rank-results] intent="${semanticIntent.slice(0, 60)}…" ` +
      `candidates=${N} llm_returned=${llmRanked.ranked.length} ` +
      `safe=${safeRanked.length} skipped=${missingCandidates.length} ` +
      `out_of_range=${outOfRangeCount} duplicates=${duplicateCount} ` +
      `with_profile=${withProfile} hidden_below_0.20=${hiddenCount} ` +
      `top5=[${top5}]`
  );

  // Full ranked dump (id + name + score + why) for one-shot debugging.
  // Verbose but invaluable when triaging "why is X missing/low".
  console.log(
    `[ai/rank-results] full ranked:`,
    safeRanked
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((r) => {
        const name = candidates.find((c) => c.id === r.id)?.name ?? "?";
        return `${r.score.toFixed(2)} ${name}: ${r.why}`;
      })
  );

  return NextResponse.json({
    ranked: safeRanked,
  } satisfies RankResultsOutput);
}
