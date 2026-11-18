import "server-only";
import { z } from "zod";
import { ToolInputError } from "@/lib/assistant/library";
import { savedList } from "@/lib/assistant/tools/get-lists";
import { defineTool } from "@/lib/assistant/tools/types";
import { listChangesSchema, listSetSchema } from "@/lib/lists/schema";
import { changeList, createList, type ListSaveResult } from "@/lib/lists/write";

/** What a save did, in counts the model can repeat. */
function outcome(result: ListSaveResult) {
  return {
    added: result.added.length || undefined,
    already_on_list: result.already.length || undefined,
    removed: result.removed.length || undefined,
    not_on_list: result.absent.length ? result.absent : undefined,
  };
}

export const saveListTool = defineTool({
  name: "save_list",
  title: "Save a list",
  description:
    "Create one of the user's lists or change one (list_id from get_lists); everything in one call is applied together, or nothing is. A list is an undated shortlist of saved places — 'solo dinners to try in November' — each place with a note on why it is there and what to order, in the user's language. Without list_id a new list is made and set.name is required. `set` changes the name and description. `ops` run in order: add_place (place_id from search_places or get_places, an optional note and position; a place already on the list keeps its position and its note unless you give a new one), remove_place (the place stays saved, its note on the list goes), set_note (null clears), move_place, reorder (every place, once). Only saved places go on a list. Lists aren't deleted here. Do what the user asked; a list or notes you put together yourself need their OK first. Returns the list as saved with its link — give the user the link.",
  inputSchema: z.object({
    list_id: z.uuid().optional().describe("The list to change; left out, a new list"),
    // Colour is an app concern; the model leaves it out.
    set: listSetSchema
      .omit({ color: true })
      .optional()
      .describe("The list itself: name (required for a new list) and description"),
    ops: listChangesSchema.shape.ops,
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, { list_id, set, ops }) {
    if (!list_id) {
      if (!set?.name) throw new ToolInputError("A new list needs set.name.");
      const result = await createList(
        ctx,
        { name: set.name, ...(set.description ? { description: set.description } : {}), ops },
        { createdVia: "assistant" }
      );
      return { saved: "new list", ...outcome(result), ...(await savedList(ctx, result.list_id)) };
    }
    const hasSet = !!set && Object.keys(set).length > 0;
    if (!hasSet && !ops?.length) throw new ToolInputError("Nothing to change: give set, ops or both.");
    const result = await changeList(ctx, list_id, { set: hasSet ? set : undefined, ops });
    return { saved: "changes applied", ...outcome(result), ...(await savedList(ctx, list_id)) };
  },
});
