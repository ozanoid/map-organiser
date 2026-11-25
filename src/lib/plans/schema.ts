import { z } from "zod";

/**
 * Input shapes for the plan write path — the same two shapes for the API
 * routes and the assistant tools:
 *
 *   planCreateSchema   → create_plan(p_plan)
 *   planChangesSchema  → apply_plan_changes(p_changes)
 *
 * The descriptions are what the assistant's create_plan / update_plan tools
 * show the model (src/lib/assistant/tools); keep them true for both callers.
 *
 * They mirror the SQL in supabase/migrations/…_plan_functions.sql. The
 * database applies a batch of changes in one transaction, so a batch either
 * lands completely or not at all.
 *
 * `null` clears a field, a missing key leaves it alone. Every object is
 * strict: a key it doesn't know is an error, not silently dropped — a model
 * that writes `time` for `start_time` hears about it instead of saving a
 * stop without its time.
 *
 * A day is named by its number (`day`, 1-based) or by its id (`day_id`). A
 * screen that shows a plan sends ids: if the days were renumbered meanwhile
 * the change still lands on the day that was shown, and a day that is gone
 * is an error instead of a write to another day. Numbers are for callers
 * that think in dates ("day 2 is the Saturday") — the assistant.
 */

export const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
export const ROUTING_PROFILES = ["walking", "driving", "cycling"] as const;
export const STOP_STATUSES = ["planned", "done", "skipped"] as const;
export const PLAN_STATUSES = ["planned", "cancelled"] as const;

/** Upper bounds — generous for a real trip, small enough to stop an accident.
 *  apply_plan_changes enforces the same two numbers. */
export const MAX_PLAN_DAYS = 60;
export const MAX_STOPS_PER_DAY = 200;
const MAX_OPS = 500;

const isoDate = z.iso.date();
/** "HH:MM", 24-hour, local time at the place. */
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 19:30");
const dayNumber = z.number().int().min(1).max(MAX_PLAN_DAYS);
const planName = z.string().trim().min(1).max(120);
const stopTitle = z.string().trim().min(1).max(160);
const stopNotes = z.string().max(2000);
const dayNotes = z.string().max(2000);
const cost = z.number().min(0).max(100000);
const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");

/** A stop is a saved place or, without one, a line of text ("Meet at the
 *  Old Street exit"). An exact time wins over a part of the day. */
const stopShape = {
  place_id: z.uuid().optional().describe("A saved place"),
  title: stopTitle
    .optional()
    .describe("Only for a stop that isn't a saved place: what it is, e.g. 'Meet at the Old Street exit'"),
  start_time: clock.optional().describe("Exact local time at the place, 24-hour 'HH:MM'"),
  day_part: z.enum(DAY_PARTS).optional().describe("Part of the day, when there is no exact time"),
  notes: stopNotes.optional().describe("What to order, a booking reference, a link"),
  /** Per person. Left out, a stop at a saved place in US dollars gets the
   *  dollar default for the place's price level; null means "no estimate"
   *  and stays empty. */
  cost_estimate: cost
    .nullable()
    .optional()
    .describe("Cost per person. Left out, a saved place's stop gets an estimate in US dollars from its price level"),
  currency: currency.optional().describe("3-letter code; default USD"),
};

/** One of the two: a saved place shows the place's own name. */
const hasPlaceOrTitle = (s: { place_id?: string; title?: string }) => !!s.place_id !== !!s.title;
const PLACE_OR_TITLE = { message: "A stop is a saved place (place_id) or a line of text (title) — one of the two" };

/** The day an op is about: its number or its id, one of the two. */
const dayRef = {
  day: dayNumber.optional().describe("Day number, 1 = the first day"),
  day_id: z.uuid().optional().describe("Or the day's id"),
};
const hasOneDay = (o: { day?: number; day_id?: string }) => (o.day != null) !== (o.day_id != null);
const ONE_DAY = { message: "Name the day by `day` (its number) or by `day_id` — one of the two" };

export const stopInputSchema = z.strictObject(stopShape).refine(hasPlaceOrTitle, PLACE_OR_TITLE);

export const planCreateSchema = z.strictObject({
  name: planName.describe("e.g. 'Saturday in Shoreditch', 'Barcelona'"),
  /** Left out or null: the plan is not scheduled yet. */
  start_date: isoDate
    .nullable()
    .optional()
    .describe("The first day, YYYY-MM-DD; leave it out while the dates aren't known"),
  party_size: z.number().int().min(1).max(50).optional().describe("How many people go"),
  notes: z.string().max(5000).optional(),
  color: z.string().max(20).optional(),
  /** The list this plan was built from. */
  list_id: z.uuid().optional(),
  /** In order: the first entry is day 1. Left out: one empty day. */
  days: z
    .array(
      z.strictObject({
        notes: dayNotes.optional(),
        routing_profile: z
          .enum(ROUTING_PROFILES)
          .optional()
          .describe("How the day's route is drawn; default walking"),
        stops: z.array(stopInputSchema).max(MAX_STOPS_PER_DAY).optional().describe("In visiting order"),
      })
    )
    .min(1)
    .max(MAX_PLAN_DAYS)
    .optional()
    .describe("In order: the first entry is day 1"),
});

/** One change to a plan. Ops run in order; a day number is read when its op
 *  runs, after the ops before it (an add_day before it shifts the numbers). */
export const planOpSchema = z.discriminatedUnion("op", [
  /** position is 1-based; left out, the day goes after the last one. */
  z
    .strictObject({
      op: z.literal("add_day"),
      position: dayNumber.optional().describe("1-based; left out, after the last day"),
      notes: dayNotes.optional(),
      routing_profile: z.enum(ROUTING_PROFILES).optional(),
    })
    .describe("Add a day; the days after it move one later"),
  /** Only an empty day can be removed; a plan keeps at least one day. */
  z
    .strictObject({ op: z.literal("remove_day"), ...dayRef })
    .refine(hasOneDay, ONE_DAY)
    .describe("Remove an empty day (move or remove its stops first); a plan keeps at least one day"),
  /** Two days by number (`a`, `b`) or by id (`a_id`, `b_id`). */
  z
    .strictObject({
      op: z.literal("swap_days"),
      a: dayNumber.optional(),
      b: dayNumber.optional(),
      a_id: z.uuid().optional(),
      b_id: z.uuid().optional(),
    })
    .refine(
      (o) =>
        (o.a != null && o.b != null && o.a_id == null && o.b_id == null) ||
        (o.a_id != null && o.b_id != null && o.a == null && o.b == null),
      { message: "swap_days takes `a` and `b` (day numbers) or `a_id` and `b_id`" }
    )
    .describe("Swap two days with their stops: `a` and `b` (day numbers) or `a_id` and `b_id`"),
  z
    .strictObject({
      op: z.literal("set_day"),
      ...dayRef,
      notes: dayNotes.nullable().optional(),
      routing_profile: z.enum(ROUTING_PROFILES).optional(),
    })
    .refine(hasOneDay, ONE_DAY)
    .describe("Change a day's notes or how its route is drawn"),
  /** position is 0-based; left out, the stop goes to the end of the day. */
  z
    .strictObject({
      op: z.literal("add_stop"),
      ...dayRef,
      position: z.number().int().min(0).optional().describe("0-based; left out, at the end of the day"),
      ...stopShape,
    })
    .refine(hasPlaceOrTitle, PLACE_OR_TITLE)
    .refine(hasOneDay, ONE_DAY)
    .describe("Add a stop: a saved place (place_id) or a line of text (title)"),
  /** Setting a time clears the day part and the other way round. */
  z
    .strictObject({
      op: z.literal("update_stop"),
      stop_id: z.uuid(),
      title: stopTitle.optional().describe("New text of a stop without a saved place (ignored for a saved place)"),
      start_time: clock.nullable().optional(),
      day_part: z.enum(DAY_PARTS).nullable().optional(),
      notes: stopNotes.nullable().optional(),
      cost_estimate: cost.nullable().optional(),
      currency: currency.optional(),
      status: z
        .enum(STOP_STATUSES)
        .optional()
        .describe(
          "skipped, or planned again. done only for a stop without a saved place: a saved place's stop is done when its visit is logged (log_visit), and a stop with a visit keeps its status until the visit is deleted"
        ),
    })
    .describe("Change a stop; null clears a field. A time clears the part of the day and the other way round"),
  z
    .strictObject({
      op: z.literal("move_stop"),
      stop_id: z.uuid(),
      ...dayRef,
      position: z.number().int().min(0).optional().describe("0-based; left out, at the end of the day"),
    })
    .refine(hasOneDay, ONE_DAY)
    .describe("Move a stop to a day — the same or another — and a position"),
  z.strictObject({ op: z.literal("remove_stop"), stop_id: z.uuid() }).describe("Remove a stop"),
  /** stop_ids lists every stop of the day, in the new order. */
  z
    .strictObject({
      op: z.literal("reorder_stops"),
      ...dayRef,
      stop_ids: z.array(z.uuid()).min(1).max(MAX_STOPS_PER_DAY),
    })
    .refine(hasOneDay, ONE_DAY)
    .describe("Put a day's stops in this order; stop_ids lists every stop of the day"),
]);

export const planSetSchema = z.strictObject({
  name: planName.optional(),
  notes: z.string().max(5000).nullable().optional(),
  party_size: z.number().int().min(1).max(50).optional(),
  /** null: the plan goes back to "not scheduled". Every day's date follows. */
  start_date: isoDate
    .nullable()
    .optional()
    .describe("The first day, YYYY-MM-DD; every day moves with it. null: not scheduled"),
  /** Cancelling keeps the plan; "planned" restores it. */
  status: z
    .enum(PLAN_STATUSES)
    .optional()
    .describe("cancelled cancels the plan — it is kept and can be restored with planned"),
  color: z.string().max(20).optional(),
});

export const planChangesSchema = z
  .strictObject({
    set: planSetSchema.optional().describe("Changes to the plan itself"),
    /** Applied in order, after `set`. */
    ops: z.array(planOpSchema).max(MAX_OPS).optional().describe("Changes to days and stops, applied in order after set"),
  })
  .refine((c) => (c.set && Object.keys(c.set).length > 0) || (c.ops?.length ?? 0) > 0, {
    message: "Nothing to change",
  });

export type StopInput = z.infer<typeof stopInputSchema>;
export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanOp = z.infer<typeof planOpSchema>;
export type PlanSet = z.infer<typeof planSetSchema>;
export type PlanChanges = z.infer<typeof planChangesSchema>;
