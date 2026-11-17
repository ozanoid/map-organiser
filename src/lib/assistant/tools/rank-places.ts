import "server-only";
import { z } from "zod";
import { getAiClient } from "@/lib/ai/client";
import {
  RANK_HIDE_THRESHOLD,
  capWithGuaranteedSeats,
  placeToRankCandidate,
  runRankLlm,
} from "@/lib/ai/rank-engine";
import { checkAiBudget, trackAiUsage } from "@/lib/ai/track-usage";
import { compactPlace, loadNames, placesByTag, resolveNames } from "@/lib/assistant/library";
import { byRating, filterLibrary, placeFilterShape } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";
import { log } from "@/lib/telemetry/logger";

/**
 * The AI-search ranker (LLM-as-judge over review-derived profiles), the same
 * engine the in-app assistant's rank_places uses — same SKU and budget.
 */
const MCP_RANK_POOL = 30;

export const rankPlaces = defineTool({
  name: "rank_places",
  title: "Rank saved places by a vibe",
  description:
    "Filter the user's saved places like search_places, then have an AI judge rank them against subjective criteria using their review-derived profiles — romantic, quiet, cosy, trendy, good for working, good for a group. Returns the top matches with a score and a one-line reason. Costs an AI call: use it once per question, and use search_places for purely structural questions.",
  inputSchema: z.object({
    intent: z
      .string()
      .min(3)
      .max(300)
      .describe("The subjective criteria in plain ENGLISH, e.g. 'romantic, intimate dinner spot, not loud'. Profiles are in English."),
    ...placeFilterShape,
    boost_tags: z
      .array(z.string().max(60))
      .max(5)
      .optional()
      .describe("Tag names related to the intent (e.g. 'Date Spot'); places carrying them always get judged"),
    limit: z.number().int().min(1).max(15).optional().describe("Default 10"),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, input) {
    const { intent, boost_tags, limit, ...filters } = input;
    const { rows } = await filterLibrary(ctx, filters);
    const take = limit ?? 10;
    if (rows.length === 0) return { total_matches: 0, places: [] };

    const pool = [...rows].sort(byRating);
    const degraded = (notice: string) => ({
      notice,
      total_matches: rows.length,
      places: pool.slice(0, take).map(compactPlace),
    });

    const budget = await checkAiBudget("rank_backstop", ctx.userId, ctx.supabase);
    if (budget.exceeded) return degraded("This month's AI-ranking allowance is used up — results are in Google-rating order.");
    const aiClient = getAiClient();
    if (!aiClient) return degraded("AI ranking is unavailable on the server — results are in Google-rating order.");

    let guaranteed = new Set<string>();
    if (boost_tags?.length) {
      const tags = resolveNames("tag", boost_tags, await loadNames(ctx, "tag"));
      const byTag = await placesByTag(ctx, tags.map((t) => t.id));
      guaranteed = new Set([...byTag.values()].flatMap((s) => [...s]));
    }
    // 30 profiles, not the engine default of 50: on 50 the judge call took
    // ~41 s (17.11.2026), too close to an MCP client's patience.
    const judged = capWithGuaranteedSeats(pool, guaranteed, MCP_RANK_POOL);

    // Profiles only for the judged places (~5 KB each).
    const { data: profiles, error } = await ctx.supabase
      .from("places")
      .select("id,name,profile:google_data->place_profile")
      .eq("user_id", ctx.userId)
      .in("id", judged.map((r) => r.id));
    if (error) throw new Error(error.message);
    const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p.profile as Record<string, unknown> | null]));
    const candidates = judged.map((r) =>
      placeToRankCandidate({ id: r.id, name: r.name, google_data: { place_profile: profileById.get(r.id) ?? null } })
    );

    // Track the attempt, not the success — a failed call still cost tokens.
    await trackAiUsage(ctx.userId, "ai_rank_results", ctx.supabase);
    try {
      const ranked = await runRankLlm({
        aiClient,
        semanticIntent: intent,
        candidates,
        functionId: "ai.mcp.rank",
        metadata: { candidates: candidates.length, totalMatches: rows.length, boosted: guaranteed.size },
      });
      const byId = new Map(judged.map((r) => [r.id, r]));
      const top = ranked
        .filter((r) => r.score >= RANK_HIDE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, take);
      return {
        total_matches: rows.length,
        judged: candidates.length,
        intent,
        places: top.flatMap((r) => {
          const row = byId.get(r.id);
          return row ? [{ ...compactPlace(row), score: Math.round(r.score * 100) / 100, why: r.why }] : [];
        }),
      };
    } catch (e) {
      log.warn("ai.mcp.rank_failed", {
        userId: ctx.userId,
        candidates: candidates.length,
        error: e instanceof Error ? e.message : String(e),
      });
      return degraded("AI ranking failed — results are in Google-rating order.");
    }
  },
});
