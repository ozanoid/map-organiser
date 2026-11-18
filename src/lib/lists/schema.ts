import { z } from "zod";

/**
 * Input shapes for the list write path — the API routes and the assistant
 * tools share them: listChangesSchema → save_list(p_list). They mirror the
 * SQL in supabase/migrations/…_list_functions.sql, which applies a batch in
 * one transaction: it lands completely or not at all.
 *
 * Every object is strict — a key it doesn't know is an error, not silently
 * dropped. The descriptions are what Claude's save_list tool shows the
 * model; keep them true for both callers.
 */

/** Upper bounds; save_list enforces the same numbers. */
export const MAX_LIST_PLACES = 1000;
const MAX_LIST_OPS = 1000;

const listName = z.string().trim().min(1).max(120);
const listDescription = z.string().max(2000);
const listColor = z.string().min(1).max(20);
export const listNote = z.string().trim().max(2000);
const position = z.number().int().min(0);

export const listSetSchema = z.strictObject({
  name: listName.optional().describe("e.g. 'Solo dinners — November'"),
  description: listDescription.nullable().optional().describe("What the list is for; null clears it"),
  color: listColor.optional(),
});

/** One change to a list's places. Ops run in order. */
export const listOpSchema = z.discriminatedUnion("op", [
  z
    .strictObject({
      op: z.literal("add_place"),
      place_id: z.uuid().describe("A saved place"),
      note: listNote
        .optional()
        .describe(
          "Why it is on the list, what to order there. For a place already on it, a note with words in it replaces its note; leave it out to keep the note"
        ),
      position: position.optional().describe("0-based; left out, at the end"),
    })
    .describe("Put a place on the list; one that is on it already keeps its position"),
  z
    .strictObject({ op: z.literal("remove_place"), place_id: z.uuid() })
    .describe("Take a place off the list (the place itself stays saved)"),
  z
    .strictObject({
      op: z.literal("set_note"),
      place_id: z.uuid(),
      note: listNote.nullable().describe("null clears it"),
    })
    .describe("Write or clear the note of a place on this list"),
  z
    .strictObject({ op: z.literal("move_place"), place_id: z.uuid(), position: position.describe("0-based") })
    .describe("Move a place to a position"),
  z
    .strictObject({
      op: z.literal("reorder"),
      place_ids: z.array(z.uuid()).min(1).max(MAX_LIST_PLACES).describe("Every place of the list, in the new order"),
    })
    .describe("Put the whole list in this order"),
]);

export const listChangesSchema = z
  .strictObject({
    set: listSetSchema.optional().describe("Changes to the list itself"),
    ops: z.array(listOpSchema).max(MAX_LIST_OPS).optional().describe("Changes to its places, applied in order after set"),
  })
  .refine((c) => (c.set && Object.keys(c.set).length > 0) || (c.ops?.length ?? 0) > 0, {
    message: "Nothing to change",
  });

/** A new list from the app: a name, optionally a description and colour. */
export const listCreateSchema = z.strictObject({
  name: listName,
  description: listDescription.optional(),
  color: listColor.optional(),
});

export type ListSet = z.infer<typeof listSetSchema>;
export type ListOp = z.infer<typeof listOpSchema>;
export type ListChanges = z.infer<typeof listChangesSchema>;
export type ListCreateInput = z.infer<typeof listCreateSchema>;
