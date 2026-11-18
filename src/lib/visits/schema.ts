import { z } from "zod";

/**
 * Input shapes for the visit write path — one set for the API routes and the
 * assistant tools. They mirror log_visit / delete_visit
 * (supabase/migrations/…_visit_functions.sql).
 *
 * A visit is one saved place on one day. Logging the same place and day again
 * updates that visit: a key that is left out keeps its value, `null` clears it.
 */

const isoDate = z.iso.date();
export const visitRating = z.number().int().min(1).max(5);
export const visitNotes = z.string().trim().max(2000);

export const visitLogSchema = z
  .object({
    place_id: z.uuid().optional(),
    /** The planned stop this visit fulfils; its place is the visit's place. */
    plan_stop_id: z.uuid().optional(),
    /** Local date at the place. Left out: the stop's day if it is today or
     *  earlier, otherwise today at the place. */
    visited_on: isoDate.optional(),
    rating: visitRating.nullable().optional(),
    notes: visitNotes.nullable().optional(),
  })
  .refine((v) => !!v.place_id || !!v.plan_stop_id, {
    message: "A visit needs a place_id or a plan_stop_id",
  });

export const visitEditSchema = z
  .object({
    visited_on: isoDate.optional(),
    rating: visitRating.nullable().optional(),
    notes: visitNotes.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export type VisitLogInput = z.infer<typeof visitLogSchema>;
export type VisitEditInput = z.infer<typeof visitEditSchema>;
