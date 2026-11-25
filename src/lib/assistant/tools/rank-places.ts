import "server-only";
import { z } from "zod";
import { compactPlace, loadNames, placesByTag, resolveNames } from "@/lib/assistant/library";
import { byRating, capWithGuaranteedSeats, filterLibrary, placeFilterShape } from "@/lib/assistant/place-filters";
import { profileForModel, type StoredProfile } from "@/lib/assistant/profile";
import { defineTool } from "@/lib/assistant/tools/types";

/**
 * Candidates for a subjective question, with what their reviews say, for
 * the model to judge — Claude ranks them itself, in the conversation (Phase 2,
 * decision 6, 24.11.2026). Until then a separate AI call (Gemini) ranked
 * them inside the tool: the longest wait in a turn (15–64 s), a second
 * brain, and its own bill.
 */

/** Candidates per call: the best-rated 30, as the AI ranking judged before. */
const POOL = 30;

export const rankPlaces = defineTool({
  name: "rank_places",
  title: "Rank saved places by a vibe",
  description:
    "For subjective criteria — romantic, quiet, cosy, trendy, good for working, good for a group: filters the user's saved places like search_places and returns the candidates with what their reviews say — pros, cons, the most talked-about themes and what each place is good for (crowd, atmosphere, occasions, seating, music, standouts). Judge and rank them yourself against the criteria; look closer at your finalists with get_places or read_reviews. Returns the best-rated 30 by default; places carrying a boost tag are always among them. Use search_places for purely structural questions.",
  inputSchema: z.object({
    intent: z
      .string()
      .min(3)
      .max(300)
      .optional()
      .describe("The criteria you will judge against, e.g. 'romantic, intimate dinner spot, not loud' — returned with the candidates"),
    ...placeFilterShape,
    boost_tags: z
      .array(z.string().max(60))
      .max(5)
      .optional()
      .describe("Tag names that fit the criteria (e.g. 'Date Spot'); places carrying them are always among the candidates"),
    limit: z.number().int().min(1).max(POOL).optional().describe(`How many candidates, default ${POOL}`),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, input) {
    const { intent, boost_tags, limit, ...filters } = input;
    const { rows } = await filterLibrary(ctx, filters);
    if (rows.length === 0) return { ...(intent ? { intent } : {}), total_matches: 0, places: [] };

    let guaranteed = new Set<string>();
    if (boost_tags?.length) {
      const tags = resolveNames("tag", boost_tags, await loadNames(ctx, "tag"));
      const byTag = await placesByTag(ctx, tags.map((t) => t.id));
      guaranteed = new Set([...byTag.values()].flatMap((s) => [...s]));
    }
    const pool = capWithGuaranteedSeats([...rows].sort(byRating), guaranteed, limit ?? POOL);

    // Profiles only for the candidates (a full one is ~3.5 KB).
    const { data, error } = await ctx.supabase
      .from("places")
      .select("id,profile:google_data->place_profile")
      .eq("user_id", ctx.userId)
      .in("id", pool.map((r) => r.id));
    if (error) throw new Error(error.message);
    const profiles = new Map(
      (data ?? []).map((p) => [p.id as string, p.profile as StoredProfile | null])
    );

    return {
      ...(intent ? { intent } : {}),
      total_matches: rows.length,
      candidates: pool.length,
      places: pool.map((r) => {
        const profile = profiles.get(r.id);
        // A place without a profile (not enriched yet) comes with its row only.
        return { ...compactPlace(r), ...(profile ? { profile: profileForModel(profile, "shortlist") } : {}) };
      }),
    };
  },
});
