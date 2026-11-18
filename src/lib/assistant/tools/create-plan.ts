import "server-only";
import { savedPlan } from "@/lib/assistant/tools/get-plans";
import { defineTool } from "@/lib/assistant/tools/types";
import { planCreateSchema } from "@/lib/plans/schema";
import { createPlan } from "@/lib/plans/write";

export const createPlanTool = defineTool({
  name: "create_plan",
  title: "Save a plan",
  description:
    "Save an outing or a trip as a plan: a name, the first day's date (leave it out while the dates aren't known — the days keep their order and take dates later), and the days in order, each with its stops in visiting order. A stop is a saved place (place_id from search_places or get_places) or a line of text (title), not both: a meeting point, or a place that isn't saved yet with its maps_url in notes. Give a stop an exact local time (start_time) or a part of the day (day_part). Costs are per person; left out, a saved place's stop gets a US-dollar estimate from its price level. Lay the plan out for the user first and save it once they agree; it is saved in one step. Returns the plan as saved with its link (url) — give the user the link.",
  // Colour and the source list are app concerns; the model leaves them out.
  inputSchema: planCreateSchema.omit({ color: true, list_id: true }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(ctx, input) {
    const planId = await createPlan(ctx, input, { createdVia: "assistant" });
    return { saved: "new plan", ...(await savedPlan(ctx, planId)) };
  },
});
