import "server-only";
import { z } from "zod";
import { ToolInputError } from "@/lib/assistant/library";
import { savedPlan } from "@/lib/assistant/tools/get-plans";
import { defineTool } from "@/lib/assistant/tools/types";
import { planChangesSchema, planSetSchema } from "@/lib/plans/schema";
import { changePlan } from "@/lib/plans/write";

export const updatePlanTool = defineTool({
  name: "update_plan",
  title: "Change a plan",
  description:
    "Change one of the user's plans (plan_id from get_plans). Everything in one call is applied together, or nothing is. `set` changes the plan itself: name, notes, party_size, start_date (every day moves with it; null = not scheduled), status (cancelled cancels the plan — it is kept, and planned restores it). `ops` change days and stops, in order: add_day, remove_day (only an empty day), swap_days, set_day, add_stop, update_stop (start_time or day_part, notes, cost, the text of a text stop; status skipped or planned again), move_stop (to another day or position), remove_stop, reorder_stops. Name a day by number (`day`, 1 = the first) or by `day_id`; a number is read when its op runs, after the ops before it. Unknown fields are refused, not ignored. A stop at a saved place is done when its visit is logged — log_visit with plan_stop_id; a stop with a visit keeps its status until the visit is deleted (delete_visit). Plans aren't deleted here: cancel instead. Do what the user asked; changes you suggest yourself need their OK first. Returns the plan as saved with its link.",
  inputSchema: z.object({
    plan_id: z.uuid(),
    // Colour is an app concern; the model leaves it out.
    set: planSetSchema.omit({ color: true }).optional().describe("Changes to the plan itself"),
    ops: planChangesSchema.shape.ops,
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, { plan_id, set, ops }) {
    const hasSet = !!set && Object.keys(set).length > 0;
    if (!hasSet && !ops?.length) throw new ToolInputError("Nothing to change: give set, ops or both.");
    const added = await changePlan(ctx, plan_id, { set: hasSet ? set : undefined, ops });
    return {
      saved: "changes applied",
      added_days: added.added_days.length ? added.added_days : undefined,
      added_stops: added.added_stops.length ? added.added_stops : undefined,
      ...(await savedPlan(ctx, plan_id)),
    };
  },
});
