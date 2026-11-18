import "server-only";
import { z } from "zod";
import { ToolInputError } from "@/lib/assistant/library";
import { visitForModel } from "@/lib/assistant/tools/log-visit";
import { defineTool } from "@/lib/assistant/tools/types";
import { getVisit } from "@/lib/visits/read";
import { deleteVisit } from "@/lib/visits/write";

/**
 * Undoing a visit logged by mistake (Ozan's decision, 18.11.2026). Plans are
 * cancelled, never deleted; a visit has no "cancelled" state — a wrong one is
 * a correction, and removing it is the only way Claude can reopen the stop
 * it ticked off.
 */
export const deleteVisitTool = defineTool({
  name: "delete_visit",
  title: "Delete a visit",
  description:
    "Remove a logged visit for good — only when the user asks: they didn't go after all, or it was logged by mistake. To fix its date, rating or notes use log_visit with visit_id instead. A plan stop the visit ticked off becomes planned again, and the place's rating is worked out again from the visits left. The place keeps its visited status; if the user has never been there, change it with update_places once they confirm. visit_id comes from get_visits, get_plans or log_visit. Returns what was deleted.",
  inputSchema: z.object({
    visit_id: z.uuid().describe("The visit to remove"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, { visit_id }) {
    // Read first, so the answer can say which visit went.
    const visit = await getVisit(ctx, visit_id);
    if (!visit) {
      throw new ToolInputError("No visit with that id. Take visit_id from get_visits, get_plans or log_visit.");
    }
    const result = await deleteVisit(ctx, visit_id);
    return {
      deleted: visitForModel(visit),
      reopened_stop_id: result.reopened_stop_id ?? undefined,
      place_now: { status: result.place.visit_status ?? "unknown", rating: result.place.rating ?? undefined },
    };
  },
});
