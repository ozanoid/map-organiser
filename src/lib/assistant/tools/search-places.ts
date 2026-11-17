import "server-only";
import { z } from "zod";
import { ToolInputError, compactPlace, type LibraryRow } from "@/lib/assistant/library";
import { byRating, filterLibrary, placeFilterShape } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";

export const searchPlaces = defineTool({
  name: "search_places",
  title: "Search saved places",
  description:
    "Search the user's saved places with structured filters: city or country, around a place / point / neighbourhood, category, sub-category, tags, list, visit status, Google rating and review count, price level, open at a given local time, how it was saved and when. Category, tag and list filters take names from get_library_overview. Returns compact results with ids for get_places and read_reviews. For subjective criteria (romantic, quiet, trendy, laptop-friendly) use rank_places instead. Closed places are left out unless include_closed is set.",
  inputSchema: z.object({
    ...placeFilterShape,
    sort: z
      .enum(["rating", "popularity", "distance", "recent"])
      .optional()
      .describe("rating = Google rating; popularity = number of Google reviews; distance needs near; recent = recently saved. Default: distance when near is given, else rating."),
    limit: z.number().int().min(1).max(25).optional().describe("Default 15"),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, input) {
    const { sort, limit, ...filters } = input;
    const { rows, distance, anchor, openAtResult } = await filterLibrary(ctx, filters);

    const order = sort ?? (anchor ? "distance" : "rating");
    if (order === "distance" && !anchor) {
      throw new ToolInputError("sort=distance needs near.");
    }
    const sorted = [...rows].sort((a: LibraryRow, b: LibraryRow) => {
      if (order === "distance") return (distance.get(a.id) ?? Infinity) - (distance.get(b.id) ?? Infinity);
      if (order === "popularity") return (b.g_count ?? 0) - (a.g_count ?? 0);
      if (order === "recent") return b.created_at.localeCompare(a.created_at);
      return byRating(a, b);
    });

    const take = limit ?? 15;
    return {
      total_matches: rows.length,
      returned: Math.min(take, rows.length),
      sort: order,
      anchor: anchor ?? undefined,
      places: sorted.slice(0, take).map((r) => {
        const open = openAtResult.get(r.id);
        return {
          ...compactPlace(r),
          distance_m: distance.get(r.id),
          closes_at: open?.closesAt,
        };
      }),
    };
  },
});
