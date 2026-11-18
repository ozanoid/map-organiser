import type { ListChanges } from "@/lib/lists/schema";
import type { ListDetail } from "@/lib/types";

/**
 * A list as it will be after `changes` — what the page shows the moment a
 * change is made, before the server answers (useChangeList). It follows
 * save_list's rules for what a page shows at once: the order (moves, a full
 * reorder, removals), notes, the name and description. A place that is added
 * appears with the server's answer, which replaces this copy either way.
 */
export function applyListChanges(list: ListDetail, changes: ListChanges): ListDetail {
  let items = [...list.items];
  const indexOf = (placeId: string) => items.findIndex((i) => i.place_id === placeId);
  const clean = (note: string | null | undefined) => note?.trim() || null;

  for (const op of changes.ops ?? []) {
    switch (op.op) {
      case "remove_place": {
        const at = indexOf(op.place_id);
        if (at >= 0) items.splice(at, 1);
        break;
      }
      case "set_note": {
        const at = indexOf(op.place_id);
        if (at >= 0) items[at] = { ...items[at], note: clean(op.note) };
        break;
      }
      case "move_place": {
        const at = indexOf(op.place_id);
        if (at < 0) break;
        const [item] = items.splice(at, 1);
        items.splice(Math.min(Math.max(op.position, 0), items.length), 0, item);
        break;
      }
      case "reorder": {
        const byId = new Map(items.map((i) => [i.place_id, i]));
        if (op.place_ids.length === items.length && op.place_ids.every((id) => byId.has(id))) {
          items = op.place_ids.map((id) => byId.get(id)!);
        }
        break;
      }
      case "add_place": {
        // On the list already: only a note with words in it replaces its note.
        const at = indexOf(op.place_id);
        if (at >= 0 && clean(op.note)) items[at] = { ...items[at], note: clean(op.note) };
        break;
      }
    }
  }

  const set = changes.set ?? {};
  return {
    ...list,
    ...(set.name !== undefined ? { name: set.name.trim() } : {}),
    ...(set.description !== undefined ? { description: set.description?.trim() || null } : {}),
    items: items.map((item, position) => ({ ...item, sort_order: position })),
  };
}
