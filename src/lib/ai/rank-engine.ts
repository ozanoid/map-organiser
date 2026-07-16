import "server-only";
import { generateText, Output } from "ai";
import { FLASH_MODEL, type getAiClient } from "@/lib/ai/client";
import {
  buildRankResultsPrompt,
  type RankCandidate,
} from "@/lib/ai/prompts/rank-results";
import { LlmRankSchema } from "@/lib/ai/schemas/rank-results";

/**
 * v1.23.0 (assistant↔AI-search parity): SERVER-side twin of the
 * client-side rerank assembly in use-ai-search.ts (runRerank). The AI
 * search pipeline assembles candidates in the browser and POSTs them to
 * /api/ai/rank-results; the assistant's rank_places tool runs inside
 * the chat route and needs the same assembly + LLM judging server-side.
 *
 * The prompt (buildRankResultsPrompt) and output schema (LlmRankSchema)
 * are ALREADY shared with the route — this module only mirrors the
 * assembly constants and the idx→id sanitization. If you change TOP_N /
 * char caps here or in use-ai-search.ts / rank-results/route.ts, change
 * BOTH (drift between the two surfaces is exactly what v1.22.1 fixed
 * for place previews).
 */

/** Mirrors use-ai-search.ts TOP_N. */
export const RANK_TOP_N = 50;
/** Mirror of rank-results/route.ts caps. */
const SUMMARY_CHAR_CAP = 3000;
const TLDR_CHAR_CAP = 400;
/** Mirror of ai-search-store's HIDE_BELOW_SCORE (client module — can't be
 *  imported server-side). Keep in sync. */
export const RANK_HIDE_THRESHOLD = 0.2;

/**
 * Cap the (google_rating_desc-sorted) place list to TOP_N with
 * GUARANTEED SEATS: places in `guaranteedIds` (e.g. carrying a
 * semantically-relevant user tag like "Date Spot") stay in the judging
 * pool even when they'd fall below the rating cut. Guarantees only
 * ever ADD recall — the final say stays with the rank LLM.
 *
 * At today's library size (~130 places) the cap rarely binds and this
 * is a no-op; it exists so scale doesn't silently reintroduce the
 * "hidden gem below the cut" problem.
 */
export function capWithGuaranteedSeats<T extends { id: string }>(
  places: T[],
  guaranteedIds: Set<string>,
  topN: number = RANK_TOP_N
): T[] {
  if (places.length <= topN) return places;
  const seats: T[] = [];
  const overflow: T[] = [];
  for (const p of places) {
    if (seats.length < topN) {
      seats.push(p);
    } else if (guaranteedIds.has(p.id)) {
      overflow.push(p); // guaranteed but below the cut
    }
  }
  // Guaranteed overflow replaces the lowest-rated non-guaranteed seats —
  // bounded to half the pool so an over-applied boost tag ("Date Spot"
  // covers 51% of the library) can never evict the top-rated majority.
  const maxSwaps = Math.floor(topN / 2);
  let swaps = 0;
  for (const g of overflow) {
    if (swaps >= maxSwaps) break;
    const swapIdx = seats
      .map((s, i) => ({ s, i }))
      .reverse()
      .find(({ s }) => !guaranteedIds.has(s.id))?.i;
    if (swapIdx === undefined) break; // everything guaranteed already
    seats[swapIdx] = g;
    swaps++;
  }
  return seats;
}

/** Row → RankCandidate, mirroring use-ai-search's client assembly plus
 *  the route's char-cap sanitization. */
export function placeToRankCandidate(p: {
  id: string;
  name: string;
  google_data?: { place_profile?: Record<string, unknown> | null } | null;
}): RankCandidate {
  const profile = (p.google_data?.place_profile ?? null) as {
    searchable_summary?: string | null;
    features?: Record<string, unknown> | null;
    theme_insights?: unknown[] | null;
    tldr?: string | null;
    pros?: string[] | null;
    cons?: string[] | null;
  } | null;
  return {
    id: p.id,
    name: p.name,
    searchable_summary: (profile?.searchable_summary ?? "").slice(
      0,
      SUMMARY_CHAR_CAP
    ),
    features: profile?.features ?? {},
    theme_insights: profile?.theme_insights ?? null,
    tldr:
      typeof profile?.tldr === "string"
        ? profile.tldr.slice(0, TLDR_CHAR_CAP)
        : null,
    pros: profile?.pros ?? null,
    cons: profile?.cons ?? null,
  };
}

export interface RankedRow {
  id: string;
  score: number;
  why: string;
}

/**
 * Run the LLM-as-judge over the candidates. Returns EVERY candidate
 * scored 0..1 (same contract as the rank-results route): LLM rows are
 * idx-sanitized (out-of-range dropped, duplicate idx first occurrence
 * wins), and candidates the LLM skipped are backfilled with score 0 —
 * without the backfill, a lazy LLM run pushed to the map would SHOW
 * unjudged places that the AI search bar hides. Throws on LLM/parse
 * failure — callers decide the fallback.
 */
export async function runRankLlm({
  aiClient,
  semanticIntent,
  candidates,
  functionId,
  metadata,
}: {
  aiClient: NonNullable<ReturnType<typeof getAiClient>>;
  semanticIntent: string;
  candidates: RankCandidate[];
  functionId: string;
  metadata: Record<string, string | number | boolean>;
}): Promise<RankedRow[]> {
  const { systemPrompt, userPrompt } = buildRankResultsPrompt(
    semanticIntent,
    candidates
  );

  const result = await generateText({
    model: aiClient(FLASH_MODEL),
    output: Output.object({ schema: LlmRankSchema }),
    system: systemPrompt,
    prompt: userPrompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId,
      metadata,
    },
  });

  const seen = new Set<number>();
  const ranked: RankedRow[] = [];
  for (const row of result.output.ranked) {
    if (row.idx < 0 || row.idx >= candidates.length || seen.has(row.idx))
      continue;
    seen.add(row.idx);
    ranked.push({
      id: candidates[row.idx].id,
      score: row.score,
      why: row.why,
    });
  }
  // Laziness backfill — sentinel string mirrors rank-results/route.ts.
  for (let i = 0; i < candidates.length; i++) {
    if (!seen.has(i)) {
      ranked.push({
        id: candidates[i].id,
        score: 0,
        why: "Not evaluated by AI in this run.",
      });
    }
  }
  return ranked;
}
