/**
 * Visit checks: the shared module (src/lib/visits), the plan link and the
 * assistant tools, against the live database on the admin test account.
 * Everything written here is removed at the end and the two places used get
 * their status, rating and notes back. No paid calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import { addDays, todayIso } from "@/lib/plans/dates";
import { getPlan } from "@/lib/plans/read";
import { changePlan, createPlan, deletePlan, PlanInputError } from "@/lib/plans/write";
import { listVisits } from "@/lib/visits/read";
import { visitLogSchema } from "@/lib/visits/schema";
import { deleteVisit, editVisit, logVisit, VisitInputError, VisitNotFoundError } from "@/lib/visits/write";

type Expect = (label: string, ok: boolean) => void;

async function rejects(run: () => Promise<unknown>, kind: new (...args: never[]) => Error): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof kind ? (e as Error).message : `wrong error: ${(e as Error).message}`;
  }
}

export async function checkVisits(admin: SupabaseClient, expect: Expect, tester: string, owner: string) {
  const ctx = { supabase: admin, userId: tester };
  const tool = async (name: string, input: unknown) => {
    const t = ASSISTANT_TOOLS.find((x) => x.name === name)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed tool output
    return (await t.run(ctx, t.inputSchema.parse(input) as never)) as any;
  };
  console.log("\n## visits");

  // Two London places of the test account, and what they look like now.
  const { data: placeRows } = await admin
    .from("places")
    .select("id,name,visit_status,rating,notes,visited_at,tz:google_data->>tz")
    .eq("user_id", tester)
    .eq("city", "London")
    .order("created_at")
    .limit(2);
  type PlaceRow = { id: string; name: string; visit_status: string | null; rating: number | null; notes: string | null; visited_at: string | null; tz: string | null };
  const [p1, p2] = (placeRows ?? []) as PlaceRow[];
  const { data: foreign } = await admin.from("places").select("id").eq("user_id", owner).limit(1).single();
  const today = todayIso(p1.tz ?? "Europe/London");
  const yesterday = addDays(today, -1);
  const started = new Date().toISOString();
  let planId: string | null = null;

  expect("schema: a visit needs a place or a stop", !visitLogSchema.safeParse({ rating: 3 }).success);
  expect("schema: rating 6 is refused", !visitLogSchema.safeParse({ place_id: p1.id, rating: 6 }).success);

  try {
    await admin.from("places").update({ visit_status: "want_to_go", rating: null }).in("id", [p1.id, p2.id]);
    planId = await createPlan(
      ctx,
      { name: "check:assistant — visits", start_date: yesterday, days: [{ stops: [{ place_id: p1.id }, { title: "Meet" }] }] },
      { createdVia: "app" }
    );
    let plan = (await getPlan(ctx, planId))!;
    const [stop, textStop] = plan.days![0].stops!;

    // Log without a date → today at the place; no planned stop today.
    const first = await logVisit(ctx, { place_id: p1.id, rating: 4, notes: "lamb was great" }, { createdVia: "app" });
    expect("log: default date is today at the place", first.visit.visited_on === today && first.created);
    expect("log: place marked visited, rating follows", first.place.visit_status === "visited" && first.place.rating === 4);

    // Same place, same day → the same visit, notes kept unless given.
    const again = await logVisit(ctx, { place_id: p1.id, rating: 5 }, { createdVia: "app" });
    expect("log: same day updates the visit", !again.created && again.visit.id === first.visit.id && again.visit.notes === "lamb was great" && again.place.rating === 5);

    // Yesterday — the plan's day 1 has a planned stop there: it gets ticked off.
    const planned = await logVisit(ctx, { place_id: p1.id, visited_on: yesterday, rating: 2 }, { createdVia: "app" });
    plan = (await getPlan(ctx, planId))!;
    const ticked = plan.days![0].stops!.find((s) => s.id === stop.id)!;
    console.log(`   auto-link → stop ${ticked.status}, visit ${ticked.visit?.id === planned.visit.id ? "attached" : "missing"}`);
    expect("log: a planned stop that day is ticked off", planned.visit.plan_stop_id === stop.id && ticked.status === "done" && ticked.visit?.rating === 2);
    expect("log: an older visit doesn't change the rating", planned.place.rating === 5);
    expect("read: the visit names its plan", planned.visit.plan?.id === planId && planned.visit.plan?.day_number === 1);

    // The plan can't change a stop's status around its visit.
    expect(
      "plan: 'done' on a place stop needs a visit",
      !!(await rejects(() => changePlan(ctx, planId!, { ops: [{ op: "update_stop", stop_id: textStop.id, status: "done" }, { op: "update_stop", stop_id: stop.id, status: "skipped" }] }), PlanInputError))
    );
    await changePlan(ctx, planId, { ops: [{ op: "update_stop", stop_id: textStop.id, status: "done" }] });
    plan = (await getPlan(ctx, planId))!;
    expect("plan: a free-text stop is ticked off directly", plan.days![0].stops!.find((s) => s.id === textStop.id)!.status === "done");

    // Correcting.
    const moved = await rejects(() => editVisit(ctx, first.visit.id, { visited_on: yesterday }), VisitInputError);
    console.log(`   date onto another visit → ${moved}`);
    expect("edit: two visits can't share a day", !!moved && !moved.startsWith("wrong"));
    const cleared = await editVisit(ctx, first.visit.id, { notes: null });
    expect("edit: null clears notes", cleared.visit.notes === null && cleared.visit.rating === 5);
    expect("edit: future refused", !!(await rejects(() => editVisit(ctx, first.visit.id, { visited_on: addDays(today, 5) }), VisitInputError)));
    expect("log: another user's place refused", !!(await rejects(() => logVisit(ctx, { place_id: foreign!.id }, { createdVia: "app" }), VisitInputError)));
    expect(
      "edit: another user can't touch the visit",
      !!(await rejects(() => editVisit({ supabase: admin, userId: owner }, first.visit.id, { rating: 1 }), VisitNotFoundError))
    );

    // A favourite stays a favourite.
    await admin.from("places").update({ visit_status: "favorite" }).eq("id", p2.id);
    const fav = await logVisit(ctx, { place_id: p2.id, visited_on: yesterday }, { createdVia: "app" });
    expect("log: a favourite stays a favourite", fav.place.visit_status === "favorite");

    // Deleting: latest first, then the planned one.
    const afterLatest = await deleteVisit(ctx, first.visit.id);
    expect("delete: rating falls back to the previous visit", afterLatest.place.rating === 2);
    const afterPlanned = await deleteVisit(ctx, planned.visit.id);
    plan = (await getPlan(ctx, planId))!;
    expect(
      "delete: the stop is planned again, rating cleared, still visited",
      afterPlanned.reopened_stop_id === stop.id &&
        plan.days![0].stops!.find((s) => s.id === stop.id)!.status === "planned" &&
        afterPlanned.place.rating === null &&
        afterPlanned.place.visit_status === "visited"
    );
    expect("delete: twice is not found", !!(await rejects(() => deleteVisit(ctx, planned.visit.id), VisitNotFoundError)));

    // ── Through the tools, as the assistant ──
    const viaTool = await tool("log_visit", { place_id: p1.id, visited_on: yesterday, rating: 3, notes: "busy, still good" });
    console.log(`   log_visit → ${JSON.stringify(viaTool).slice(0, 260)}`);
    expect("tool log_visit: logged, plan named, created_via assistant", viaTool.visit.plan?.startsWith("check:assistant") && viaTool.visit.logged_via === "assistant");
    const corrected = await tool("log_visit", { visit_id: viaTool.visit.visit_id, rating: 4 });
    expect("tool log_visit: correct by visit_id", corrected.corrected && corrected.visit.rating === 4 && corrected.place_now.rating === 4);
    const history = await tool("get_visits", { area: "london", min_rating: 4 });
    expect("tool get_visits: area and rating filter", history.visits.some((v: { visit_id: string }) => v.visit_id === viaTool.visit.visit_id));
    const none = await tool("get_visits", { area: "london", min_rating: 5 });
    expect("tool get_visits: nothing matches → a note", none.visits.every((v: { rating?: number }) => (v.rating ?? 0) >= 5));
    const details = await tool("get_places", { place_ids: [p1.id] });
    const user = details.places[0].user;
    console.log(`   get_places user → ${JSON.stringify({ visits: user.visits, upcoming_plans: user.upcoming_plans })}`);
    expect("tool get_places: last visits", user.visits?.count === 1 && user.visits.last[0].notes === "busy, still good");
    // A plan still ahead with a planned stop at the place shows up in get_places.
    await changePlan(ctx, planId, { set: { start_date: addDays(today, 7) }, ops: [{ op: "add_stop", day: 1, place_id: p2.id }] });
    const ahead = await tool("get_places", { place_ids: [p2.id] });
    console.log(`   upcoming → ${JSON.stringify(ahead.places[0].user.upcoming_plans)}`);
    expect(
      "tool get_places: upcoming plans with their date",
      ahead.places[0].user.upcoming_plans?.some((u: { plan_id: string; date?: string }) => u.plan_id === planId && u.date === addDays(today, 7))
    );
    const overview = await tool("get_library_overview", {});
    expect("tool overview: visit counts", overview.visits.logged >= 2 && overview.visits.places >= 2);
    const noted = await tool("update_places", { place_ids: [p1.id], note: "ask for the window table" });
    const { data: noteRow } = await admin.from("places").select("notes").eq("id", p1.id).single();
    expect("tool update_places: note appended without a date", !!noted && (noteRow?.notes ?? "").endsWith("ask for the window table") && !/\[\d{4}-\d{2}-\d{2}\]/.test(noteRow?.notes ?? ""));
  } finally {
    // Remove what this run wrote and give the places back their values.
    const { data: leftover } = await admin
      .from("visits")
      .select("id")
      .eq("user_id", tester)
      .in("place_id", [p1.id, p2.id])
      .gte("created_at", started);
    for (const v of (leftover ?? []) as { id: string }[]) await deleteVisit(ctx, v.id).catch(() => {});
    if (planId) await deletePlan(ctx, planId).catch(() => {});
    for (const p of [p1, p2]) {
      await admin
        .from("places")
        .update({ visit_status: p.visit_status, rating: p.rating, notes: p.notes, visited_at: p.visited_at })
        .eq("id", p.id);
    }
    const left = await listVisits(ctx, { placeIds: [p1.id, p2.id] });
    const { data: restored } = await admin.from("places").select("id,visit_status,rating,notes").in("id", [p1.id, p2.id]);
    const same = [p1, p2].every((p) => {
      const r = (restored ?? []).find((x) => x.id === p.id);
      return r && r.visit_status === p.visit_status && r.rating === p.rating && r.notes === p.notes;
    });
    expect("cleanup: no visit left, places as they were", left.filter((v) => v.created_at >= started).length === 0 && same);
  }
}
