import "server-only";
import { z } from "zod";
import { placeId } from "@/lib/assistant/place-filters";
import { visitForModel } from "@/lib/assistant/tools/log-visit";
import { defineTool } from "@/lib/assistant/tools/types";
import { fold } from "@/lib/text/fold";
import { listVisits } from "@/lib/visits/read";

export const getVisits = defineTool({
  name: "get_visits",
  title: "Visit history",
  description:
    "The user's logged visits, newest first: where they went and when, their rating and notes for that visit (what they had, how it was), and the plan it was part of. Filter by places, a date range, an area (city, district or country) or a minimum rating. Answers 'where did I go last month', 'what did I have at X', 'which places did I love'. A place can be marked visited without any logged visit — check get_places for its status.",
  inputSchema: z.object({
    place_ids: z.array(placeId).min(1).max(25).optional(),
    from: z.iso.date().optional().describe("Inclusive, YYYY-MM-DD"),
    to: z.iso.date().optional().describe("Inclusive, YYYY-MM-DD"),
    area: z.string().min(1).max(80).optional().describe("City, district or country, as get_library_overview names them"),
    min_rating: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, { place_ids, from, to, area, min_rating, limit }) {
    let visits = await listVisits(ctx, {
      placeIds: place_ids,
      from,
      to,
      minRating: min_rating,
      // An area is matched here, after the query; read enough to fill `limit`.
      limit: area ? 500 : limit,
    });
    if (area) {
      const needle = fold(area);
      visits = visits.filter((v) =>
        [v.place?.city, v.place?.country].some((s) => s && fold(s).includes(needle))
      );
    }
    const shown = visits.slice(0, limit);
    return {
      visits: shown.map(visitForModel),
      more: visits.length > shown.length ? visits.length - shown.length : undefined,
      note:
        shown.length === 0
          ? "No logged visits match. Visits are recorded with log_visit when the user says they went somewhere; older ones may only show as a 'visited' status on the place."
          : undefined,
    };
  },
});
