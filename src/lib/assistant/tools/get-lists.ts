import "server-only";
import { z } from "zod";
import { ToolInputError, type AssistantContext } from "@/lib/assistant/library";
import { defineTool } from "@/lib/assistant/tools/types";
import { getList, listLists } from "@/lib/lists/read";
import { log } from "@/lib/telemetry/logger";
import { fold } from "@/lib/text/fold";
import type { ListDetail } from "@/lib/types";

/**
 * Lists as the model sees them — get_lists here, and the list save_list
 * returns after a write. Field names follow save_list's input (list_id,
 * place_id, note), so what the model reads it can write back.
 */

/** The list's page in the app. */
export function listUrl(ctx: AssistantContext, listId: string): string {
  return `${ctx.appUrl}/lists/${listId}`;
}

/** One list in full: its places in order, each with its note there. */
export function listForModel(ctx: AssistantContext, list: ListDetail) {
  return {
    list_id: list.id,
    name: list.name,
    description: list.description ?? undefined,
    url: listUrl(ctx, list.id),
    places: list.items.map((item) => ({
      place_id: item.place_id,
      name: item.place?.name ?? "(place not found)",
      area: item.place?.city ?? undefined,
      category: item.place?.category?.name,
      google_rating: item.place?.google_data.rating ?? undefined,
      status: item.place?.visit_status ?? "unknown",
      maps_url: item.place?.google_data.url ?? undefined,
      note: item.note ?? undefined,
      added: item.added_at ? item.added_at.slice(0, 10) : undefined,
    })),
  };
}

/**
 * The list after a write. The write has landed by now, so a failed read-back
 * is a note, not an error — a retry would apply it twice.
 */
export async function savedList(ctx: AssistantContext, listId: string) {
  try {
    const list = await getList(ctx, listId, { withPlaces: true });
    if (list) return { list: listForModel(ctx, list) };
  } catch (e) {
    log.warn("assistant.list_read_back_failed", {
      listId,
      userId: ctx.userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return {
    list_id: listId,
    url: listUrl(ctx, listId),
    note: "Saved, but the list couldn't be read back just now — get_lists shows it.",
  };
}

export const getLists = defineTool({
  name: "get_lists",
  title: "Lists",
  description:
    "The user's lists: undated shortlists and collections of saved places, each place with the user's note for that list — why it is there, what to order. Without list_id: every list with its description, place count and link. With list_id, or a name that matches one list: the list in full — its places in order with area, category, Google rating, the user's visit status ('unknown' = never marked), Maps link and the note. Answers 'what's on my November list', 'what was I going to order at X'.",
  inputSchema: z.object({
    list_id: z.uuid().optional().describe("One list in full"),
    name: z.string().trim().min(1).max(80).optional().describe("Part of a list's name; a single match comes back in full"),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, { list_id, name }) {
    if (list_id) {
      const list = await getList(ctx, list_id, { withPlaces: true });
      if (!list) throw new ToolInputError("No list with that id. Take list_id from get_lists.");
      return { list: listForModel(ctx, list) };
    }

    const all = await listLists(ctx);
    const needle = name ? fold(name) : null;
    const matches = needle ? all.filter((l) => fold(l.name).includes(needle)) : all;
    if (needle && matches.length === 1) {
      const list = await getList(ctx, matches[0].id, { withPlaces: true });
      if (list) return { list: listForModel(ctx, list) };
    }
    return {
      lists: matches.map((l) => ({
        list_id: l.id,
        name: l.name,
        description: l.description ?? undefined,
        places: l.place_count ?? 0,
        updated: l.updated_at.slice(0, 10),
        url: listUrl(ctx, l.id),
      })),
      note:
        matches.length === 0
          ? needle
            ? "No list matches that name."
            : "The user has no lists yet; save_list makes one."
          : undefined,
    };
  },
});
