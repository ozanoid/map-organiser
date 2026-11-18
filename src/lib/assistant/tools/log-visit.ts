import "server-only";
import { z } from "zod";
import { ToolInputError } from "@/lib/assistant/library";
import { placeId } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";
import { visitNotes, visitRating } from "@/lib/visits/schema";
import { editVisit, logVisit } from "@/lib/visits/write";
import type { Visit } from "@/lib/types";

/** A visit as the model sees it. */
export function visitForModel(v: Visit) {
  return {
    visit_id: v.id,
    date: v.visited_on,
    place: v.place ? { id: v.place.id, name: v.place.name, area: v.place.city ?? undefined, maps_url: v.place.maps_url ?? undefined } : undefined,
    rating: v.rating ?? undefined,
    notes: v.notes ?? undefined,
    plan: v.plan ? `${v.plan.name} (day ${v.plan.day_number})` : undefined,
    logged_via: v.created_via,
  };
}

export const logVisitTool = defineTool({
  name: "log_visit",
  title: "Log a visit",
  description:
    "Record that the user went to one of their saved places: the date (default: today at the place), their rating 1–5 and notes in their own words — what they had, how it was. It marks the place visited (a favourite stays a favourite), makes this the place's rating when it is the latest rated visit, and ticks off a planned stop for that place on that day. One visit per place per day: logging the same day again updates that visit and keeps what you leave out. To correct a visit pass visit_id (from get_visits or an earlier result); rating or notes null clears them. Use it when the user tells you they went somewhere.",
  inputSchema: z.object({
    place_id: placeId.optional().describe("The saved place; not needed with visit_id"),
    visit_id: z.uuid().optional().describe("Correct this visit instead of logging a new one"),
    visited_on: z.iso.date().optional().describe("Local date at the place, YYYY-MM-DD; default today there"),
    rating: visitRating.nullable().optional().describe("The user's rating of this visit, 1–5"),
    notes: visitNotes.min(1).nullable().optional().describe("In the user's own words: what they had, how it was"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, input) {
    const { place_id, visit_id, visited_on, rating, notes } = input;
    const fields = {
      ...(visited_on ? { visited_on } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    let result;
    if (visit_id) {
      if (Object.keys(fields).length === 0) {
        throw new ToolInputError("Nothing to correct: give visited_on, rating or notes with visit_id.");
      }
      result = await editVisit(ctx, visit_id, fields);
    } else {
      if (!place_id) throw new ToolInputError("Give place_id (a saved place) or visit_id (to correct a visit).");
      result = await logVisit(ctx, { place_id, ...fields }, { createdVia: "assistant" });
    }
    return {
      ...(visit_id ? { corrected: true } : { logged: result.created ? "new visit" : "updated the visit already logged that day" }),
      visit: visitForModel(result.visit),
      place_now: { status: result.place.visit_status ?? "unknown", rating: result.place.rating ?? undefined },
    };
  },
});
