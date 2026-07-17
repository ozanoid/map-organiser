import "server-only";
import { z } from "zod";
import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queryPlaces, type PlaceQueryFilters } from "@/lib/places/query-places";
import { computeUserStats } from "@/lib/places/user-stats";
import { isOpenNow } from "@/lib/places/open-now";
import type { UserContext } from "@/lib/ai/context-builder";
import { getAiClient } from "@/lib/ai/client";
import { checkAiBudget, trackAiUsage } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";
import {
  capWithGuaranteedSeats,
  placeToRankCandidate,
  runRankLlm,
  RANK_TOP_N,
  RANK_HIDE_THRESHOLD,
} from "@/lib/ai/rank-engine";

/**
 * v1.21.0 (S3 AI-02): the assistant's tool belt. Every tool is a thin
 * wrapper over existing server code, executed under the VIEWER's
 * cookie-scoped Supabase client — RLS is the ownership boundary, so a
 * hallucinated or foreign id simply comes back "not found" instead of
 * leaking. Mutating tools carry `needsApproval: true`: the AI SDK pauses
 * the loop, the chat UI renders a confirm card, and the tool only
 * executes after the user approves (v6 built-in approval flow).
 *
 * Outputs are COMPACT projections, not full rows — full google_data
 * (timetable, review-derived profile, photos meta) would blow up the
 * agent-loop context on every search turn (the rank-results pipeline
 * measured ~30k input tokens at 50 full candidates).
 */

// ── Compact projections the LLM sees ────────────────────────────────

export interface ChatPlaceHit {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  category: string | null;
  google_rating: number | null;
  ratings_count: number | null;
  my_rating: number | null;
  visit_status: string | null;
  open_now: boolean | null;
  tldr: string | null;
}

function toHit(p: any): ChatPlaceHit {
  const gd = p.google_data ?? {};
  return {
    id: p.id,
    name: p.name,
    city: p.city ?? null,
    country: p.country ?? null,
    category: p.category?.name ?? null,
    google_rating: gd.rating ?? null,
    ratings_count: gd.user_ratings_total ?? null,
    my_rating: p.rating ?? null,
    visit_status: p.visit_status ?? null,
    open_now: isOpenNow(gd.work_timetable, gd.tz),
    tldr: gd.place_profile?.tldr ?? null,
  };
}

const VISIT_STATUSES = ["want_to_go", "booked", "visited", "favorite"] as const;

/** Shared filter args for search_places / rank_places. */
const FILTER_FIELDS = {
  city: z.string().optional().describe("City name, e.g. 'London'"),
  country: z.string().optional(),
  category_ids: z
    .array(z.string())
    .optional()
    .describe("Category ids from the taxonomy block"),
  tag_ids: z.array(z.string()).optional(),
  list_id: z.string().optional(),
  visit_status: z.enum(VISIT_STATUSES).optional(),
  google_rating_min: z.number().min(0).max(5).optional(),
  open_now: z
    .boolean()
    .optional()
    .describe("Only places open right now (their local time)"),
  query: z
    .string()
    .optional()
    .describe(
      "Keyword search over names, addresses, notes and review-derived summaries (e.g. 'matcha', 'rooftop')"
    ),
} as const;

type FilterInput = {
  city?: string;
  country?: string;
  category_ids?: string[];
  tag_ids?: string[];
  list_id?: string;
  visit_status?: (typeof VISIT_STATUSES)[number];
  google_rating_min?: number;
  open_now?: boolean;
  query?: string;
};

function toQueryFilters(input: FilterInput): PlaceQueryFilters {
  return {
    city: input.city,
    country: input.country,
    categoryIds: input.category_ids,
    tagIds: input.tag_ids,
    listId: input.list_id,
    visitStatus: input.visit_status,
    googleRatingMin: input.google_rating_min,
    openNow: input.open_now,
    search: input.query,
    sort: "google_rating_desc",
  };
}

/**
 * PlaceFilters-shaped echo of the filters a tool applied. The panel's
 * "show on map / list" push buttons rebuild the URL from this — key
 * names deliberately match PlaceFilters (query→search).
 */
function appliedFiltersEcho(input: FilterInput) {
  return {
    city: input.city ?? null,
    country: input.country ?? null,
    category_ids: input.category_ids ?? null,
    tag_ids: input.tag_ids ?? null,
    list_id: input.list_id ?? null,
    visit_status: input.visit_status ?? null,
    google_rating_min: input.google_rating_min ?? null,
    open_now: input.open_now ?? null,
    search: input.query ?? null,
  };
}

export type AppliedFilters = ReturnType<typeof appliedFiltersEcho>;

/** Of the given ids, the ones that are the user's own places. */
async function ownedPlaceIds(
  supabase: SupabaseClient,
  userId: string,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("places")
    .select("id")
    .eq("user_id", userId)
    .in("id", ids);
  return (data ?? []).map((r) => r.id);
}

// ── Tool factory ────────────────────────────────────────────────────

/**
 * Tools close over the request's supabase client + userId. `ctx` (the
 * user taxonomy) is only used for friendlier not-found messages — id
 * enforcement itself is RLS.
 */
export function buildChatTools(
  supabase: SupabaseClient,
  userId: string,
  ctx: UserContext
) {
  const search_places = tool({
    description:
      "Search the user's saved places with structured filters. Returns compact place summaries with ids. Use ids from these results for other tools. Prefer ONE well-filtered call over many broad ones. For queries with SUBJECTIVE/soft criteria (romantic, quiet, cozy, good-for-work…) use rank_places instead — never call both for the same query.",
    inputSchema: z.object({
      ...FILTER_FIELDS,
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async (input) => {
      const { places } = await queryPlaces(
        supabase,
        userId,
        toQueryFilters(input)
      );
      const limit = input.limit ?? 15;
      return {
        total_matches: places.length,
        returned: Math.min(limit, places.length),
        places: places.slice(0, limit).map(toHit),
        applied_filters: appliedFiltersEcho(input),
      };
    },
  });

  // v1.23.0 (assistant↔AI-search parity): the LLM-as-judge ranker from
  // the AI search pipeline, exposed as a tool. Judges ALL matching
  // places semantically (not just the top-rated window search_places
  // returns), so "romantic date night" quality matches AI search. Rides
  // the same ai_rank_results SKU + 3× backstop; the chat turn itself is
  // already the charged unit.
  const rank_places = tool({
    description:
      "Search + SEMANTICALLY RANK the user's places against subjective criteria (romantic, quiet, good for working, cozy…). Judges every match holistically using review-derived profiles — use this INSTEAD of search_places when the query has soft/vibe criteria. More expensive; never call both for one query, and don't use it for purely structural queries (city/category/rating/open-now only).",
    inputSchema: z.object({
      ...FILTER_FIELDS,
      // Override the shared describe: putting the soft criterion here
      // would keyword-PREFILTER the pool and starve the judge — the
      // exact anti-pattern the parse-query pipeline trains against.
      query: FILTER_FIELDS.query.describe(
        "HARD keyword prefilter only — words that MUST literally appear (e.g. 'matcha'). NEVER put the soft criterion here; that belongs in semantic_intent."
      ),
      semantic_intent: z
        .string()
        .min(3)
        .describe(
          "The full soft intent in natural language, e.g. 'romantic, intimate spot for a date night — candlelit or cozy, not loud'. Write it in ENGLISH regardless of the user's language (place profiles are English)."
        ),
      boost_tag_ids: z
        .array(z.string())
        .optional()
        .describe(
          "OPTIONAL: ids of the user's tags (from the taxonomy block) semantically related to the intent (e.g. a 'Date Spot' tag for romantic queries). Places carrying them get guaranteed seats in the judging pool — they can still rank low."
        ),
    }),
    execute: async (input) => {
      // Shared with AI search's rank leg: 1500/mo runaway guard. Two
      // legitimate consumers still fit comfortably (chat ranks ≤ chat
      // cap 200 + search ranks ≤ search cap 500) — see gemini.md note.
      const backstop = await checkAiBudget("rank_backstop", userId, supabase);
      const aiClient = getAiClient();

      const { places } = await queryPlaces(
        supabase,
        userId,
        toQueryFilters(input)
      );
      if (places.length === 0) {
        return {
          total_matches: 0,
          places: [],
          applied_filters: appliedFiltersEcho(input),
        };
      }

      // Degraded mode (no judging possible): rating-order results with a
      // `notice`, NOT `error` — the panel renders notice + rows + push
      // buttons; an `error` key would swallow them.
      const degraded = (notice: string) => ({
        notice,
        total_matches: places.length,
        places: places.slice(0, 10).map(toHit),
        applied_filters: appliedFiltersEcho(input),
      });

      if (backstop.exceeded)
        return degraded(
          "Monthly semantic-ranking allowance is exhausted — results are in rating order (no extra cost)."
        );
      if (!aiClient) return degraded("AI ranking unavailable — rating order.");

      // Guaranteed seats: places carrying the intent-related tags stay
      // in the judging pool even below the rating cut (recall guard —
      // only matters once the library outgrows RANK_TOP_N).
      let guaranteedIds = new Set<string>();
      if (input.boost_tag_ids?.length && places.length > RANK_TOP_N) {
        const { data: taggedRows } = await supabase
          .from("place_tags")
          .select("place_id")
          .in("tag_id", input.boost_tag_ids);
        guaranteedIds = new Set((taggedRows ?? []).map((r) => r.place_id));
      }

      const pool = capWithGuaranteedSeats(places, guaranteedIds);
      const candidates = pool.map((p: any) => placeToRankCandidate(p));

      // Track the ATTEMPT, not the success: a failed call consumed the
      // full candidate payload, and untracked failures would also let a
      // failing rank loop slip past the backstop.
      trackAiUsage(userId, "ai_rank_results", supabase).catch(() => {});

      try {
        const ranked = await runRankLlm({
          aiClient,
          semanticIntent: input.semantic_intent,
          candidates,
          functionId: "ai.chat.rank",
          metadata: {
            candidates: candidates.length,
            totalMatches: places.length,
            boosted: guaranteedIds.size,
          },
        });

        ranked.sort((a, b) => b.score - a.score);
        const byId = new Map(pool.map((p: any) => [p.id, p]));
        return {
          total_matches: places.length,
          judged: candidates.length,
          semantic_intent: input.semantic_intent,
          applied_filters: appliedFiltersEcho(input),
          // Top picks for YOUR answer — judge-hidden (<0.2) rows are
          // excluded so chat never shows what the map would hide.
          places: ranked
            .filter((r) => r.score >= RANK_HIDE_THRESHOLD)
            .slice(0, 10)
            .map((r) => ({
              ...toHit(byId.get(r.id)),
              score: r.score,
              why: r.why,
            })),
          // Full scored list — powers the user's "show on map/list"
          // buttons; you don't need to repeat it in text.
          all_ranked: ranked,
        };
      } catch (e) {
        log.warn("ai.chat.rank_failed", {
          userId,
          candidates: candidates.length,
          error: e instanceof Error ? e.message : String(e),
        });
        return degraded(
          "Semantic ranking failed; results below are in rating order."
        );
      }
    },
    // The model never needs the full scored list back in its context —
    // all_ranked exists solely for the client's push buttons. Stripping
    // it here saves ~3-4k tokens per subsequent step/turn.
    toModelOutput: ({ output }) => {
      const { all_ranked: _a, ...forModel } = output as Record<string, unknown>;
      return { type: "json", value: forModel as never };
    },
  });

  const get_place_details = tool({
    description:
      "Get full details for ONE place by id (from search results): profile summary, pros/cons, opening hours today, links, tags, lists, notes.",
    inputSchema: z.object({ place_id: z.string() }),
    execute: async ({ place_id }) => {
      const { data: place } = await supabase
        .from("places")
        .select("*, category:categories(name, color)")
        .eq("id", place_id)
        .single();
      if (!place) return { error: "Place not found" };

      const [{ data: placeTags }, { data: placeLists }] = await Promise.all([
        supabase
          .from("place_tags")
          .select("tags(name)")
          .eq("place_id", place_id),
        supabase
          .from("list_places")
          .select("lists(id, name)")
          .eq("place_id", place_id),
      ]);

      const gd = place.google_data ?? {};
      const profile = gd.place_profile ?? {};
      return {
        ...toHit(place),
        address: place.address ?? null,
        notes: place.notes ?? null,
        website: gd.website ?? null,
        maps_url: gd.url ?? null,
        price_level: gd.price_level ?? null,
        opening_hours: gd.opening_hours?.weekday_text ?? null,
        profile: {
          tldr: profile.tldr ?? null,
          pros: profile.pros ?? null,
          cons: profile.cons ?? null,
          theme_insights: profile.theme_insights ?? null,
        },
        tags: (placeTags ?? []).map((t: any) => t.tags?.name).filter(Boolean),
        lists: (placeLists ?? [])
          .map((l: any) => l.lists)
          .filter(Boolean)
          .map((l: any) => ({ id: l.id, name: l.name })),
      };
    },
  });

  const compare_places = tool({
    description:
      "Fetch side-by-side data for 2-4 places (by id) so you can compare them for the user: ratings, price, profile pros/cons and theme insights. YOU write the comparison from the returned data.",
    inputSchema: z.object({
      place_ids: z.array(z.string()).min(2).max(4),
    }),
    execute: async ({ place_ids }) => {
      const { places } = await queryPlaces(supabase, userId, {
        ids: place_ids,
      });
      if (places.length < 2)
        return { error: "Fewer than 2 of those places were found" };
      return {
        places: places.map((p: any) => {
          const profile = p.google_data?.place_profile ?? {};
          return {
            ...toHit(p),
            price_level: p.google_data?.price_level ?? null,
            pros: profile.pros ?? null,
            cons: profile.cons ?? null,
            theme_insights: profile.theme_insights ?? null,
          };
        }),
      };
    },
  });

  const get_stats = tool({
    description:
      "Get the user's library statistics: totals, visit-status breakdown, top categories and cities, monthly trend, rating distribution.",
    inputSchema: z.object({}),
    execute: async () => computeUserStats(supabase, userId),
  });

  const add_to_list = tool({
    description:
      "Add one or more places (by id) to one of the user's lists. Requires user approval. Use list ids from the taxonomy block or create_list.",
    inputSchema: z.object({
      list_id: z.string(),
      place_ids: z.array(z.string()).min(1).max(20),
    }),
    needsApproval: true,
    execute: async ({ list_id, place_ids }) => {
      // RLS on list_places derives ownership from lists.user_id — a
      // foreign/hallucinated list_id fails the insert, never leaks.
      const { data: list } = await supabase
        .from("lists")
        .select("id, name")
        .eq("id", list_id)
        .single();
      if (!list) return { error: "List not found" };

      // list_places RLS checks only LIST ownership — a foreign place id
      // would insert "successfully" yet never render (places reads are
      // user-scoped). Pre-filter to the user's own places so counts are
      // honest and no junk rows land.
      const owned = await ownedPlaceIds(supabase, userId, place_ids);

      const added: string[] = [];
      const already: string[] = [];
      for (const placeId of owned) {
        const { error } = await supabase
          .from("list_places")
          .insert({ list_id, place_id: placeId });
        if (!error) added.push(placeId);
        else if (error.code === "23505") already.push(placeId);
      }
      return {
        list_name: list.name,
        added_count: added.length,
        already_in_list: already.length,
        unknown_ids: place_ids.length - owned.length,
      };
    },
  });

  const create_list = tool({
    description:
      "Create a new list for the user, optionally adding places (by id) to it immediately. Requires user approval.",
    inputSchema: z.object({
      name: z.string().min(1).max(60),
      description: z.string().max(200).optional(),
      place_ids: z.array(z.string()).max(20).optional(),
    }),
    needsApproval: true,
    execute: async ({ name, description, place_ids }) => {
      const { data: newList, error } = await supabase
        .from("lists")
        .insert({
          user_id: userId,
          name,
          description: description ?? null,
        })
        .select("id, name")
        .single();
      if (error || !newList)
        return { error: error?.message ?? "Failed to create list" };

      // Same ownership pre-filter as add_to_list.
      const owned = await ownedPlaceIds(supabase, userId, place_ids ?? []);
      let addedCount = 0;
      for (const placeId of owned) {
        const { error: addErr } = await supabase
          .from("list_places")
          .insert({ list_id: newList.id, place_id: placeId });
        if (!addErr) addedCount++;
      }
      return { list_id: newList.id, list_name: newList.name, added_count: addedCount };
    },
  });

  const set_visit_status = tool({
    description:
      "Set a place's visit status (want_to_go / booked / visited / favorite) or clear it (null). Requires user approval.",
    inputSchema: z.object({
      place_id: z.string(),
      status: z.enum(VISIT_STATUSES).nullable(),
    }),
    needsApproval: true,
    execute: async ({ place_id, status }) => {
      // Mirrors PATCH /api/places/[id] visit-status logic: stamp
      // visited_at/booked_at once; clearing or want_to_go resets both.
      const updates: Record<string, unknown> = {
        visit_status: status,
        updated_at: new Date().toISOString(),
      };
      const { data: current } = await supabase
        .from("places")
        .select("id, name, visited_at, booked_at")
        .eq("id", place_id)
        .single();
      if (!current) return { error: "Place not found" };

      if (status === "visited" && !current.visited_at) {
        updates.visited_at = new Date().toISOString();
      } else if (status === "booked" && !current.booked_at) {
        updates.booked_at = new Date().toISOString();
      } else if (status === null || status === "want_to_go") {
        updates.visited_at = null;
        updates.booked_at = null;
      }

      const { error } = await supabase
        .from("places")
        .update(updates)
        .eq("id", place_id);
      if (error) return { error: error.message };
      return { place_name: current.name, status };
    },
  });

  // ctx is threaded for future taxonomy-aware validation; RLS already
  // guards ids today.
  void ctx;

  return {
    search_places,
    rank_places,
    get_place_details,
    compare_places,
    get_stats,
    add_to_list,
    create_list,
    set_visit_status,
  };
}

export type ChatTools = ReturnType<typeof buildChatTools>;
