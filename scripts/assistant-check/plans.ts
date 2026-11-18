/**
 * Plan checks: the shared module (src/lib/plans) against the live database,
 * on the admin test account. Everything created here is deleted at the end.
 * One Mapbox Directions request (free allowance: 100,000 a month).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatDateRange, planPhase } from "@/lib/plans/dates";
import { dayRoute, getPlan, listPlans, plansUsingPlaces, type PlanContext } from "@/lib/plans/read";
import { routeSignature } from "@/lib/plans/route-signature";
import { planChangesSchema, planCreateSchema } from "@/lib/plans/schema";
import {
  autoPlanStops,
  changePlan,
  createPlan,
  deletePlan,
  PlanInputError,
  PlanNotFoundError,
} from "@/lib/plans/write";

type Expect = (label: string, ok: boolean) => void;

async function rejects(run: () => Promise<unknown>, kind: new (...args: never[]) => Error): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof kind ? (e as Error).message : null;
  }
}

export async function checkPlans(admin: SupabaseClient, expect: Expect, tester: string, owner: string) {
  const ctx: PlanContext = { supabase: admin, userId: tester };
  console.log("\n## plans");

  // ── Pure: dates and input shapes ────────────────────────────────────
  expect("addDays crosses a month", addDays("2026-02-27", 3) === "2026-03-02");
  expect("date range, same month", formatDateRange("2026-03-12", "2026-03-14") === "12 – 14 Mar 2026");
  expect("date range, one day", formatDateRange("2026-03-12", "2026-03-12") === "12 Mar 2026");
  expect(
    "phase: last day today is still upcoming",
    planPhase({ status: "planned", start_date: "2026-03-12", end_date: "2026-03-14" }, "2026-03-14") === "upcoming"
  );
  expect(
    "phase: no date / cancelled",
    planPhase({ status: "planned", start_date: null, end_date: null }, "2026-03-14") === "unscheduled" &&
      planPhase({ status: "cancelled", start_date: "2030-01-01", end_date: "2030-01-01" }, "2026-03-14") === "cancelled"
  );
  expect("changes: empty is refused", !planChangesSchema.safeParse({}).success);
  expect(
    "changes: 25:00 is refused",
    !planChangesSchema.safeParse({ ops: [{ op: "update_stop", stop_id: crypto.randomUUID(), start_time: "25:00" }] }).success
  );
  expect(
    "changes: null clears a time",
    planChangesSchema.safeParse({ ops: [{ op: "update_stop", stop_id: crypto.randomUUID(), start_time: null }] }).success
  );
  expect(
    "changes: a day is named by number or by id, not both and not neither",
    planChangesSchema.safeParse({ ops: [{ op: "remove_day", day: 2 }] }).success &&
      planChangesSchema.safeParse({ ops: [{ op: "remove_day", day_id: crypto.randomUUID() }] }).success &&
      !planChangesSchema.safeParse({ ops: [{ op: "remove_day", day: 2, day_id: crypto.randomUUID() }] }).success &&
      !planChangesSchema.safeParse({ ops: [{ op: "remove_day" }] }).success &&
      !planChangesSchema.safeParse({ ops: [{ op: "swap_days", a: 1, b_id: crypto.randomUUID() }] }).success
  );
  expect(
    "create: a stop needs a place or a title",
    !planCreateSchema.safeParse({ name: "x", days: [{ stops: [{ notes: "nothing" }] }] }).success
  );

  // ── Read: the copied plans ──────────────────────────────────────────
  const { count: dbPlans } = await admin.from("plans").select("id", { count: "exact", head: true }).eq("user_id", tester);
  const before = await listPlans(ctx);
  console.log(`   ${before.length} plans; first: ${JSON.stringify(before[0]).slice(0, 260)}`);
  expect("listPlans returns every plan of the user", before.length === dbPlans && before.length > 0);
  expect("listPlans: day and stop counts", before.every((p) => (p.day_count ?? 0) >= 1 && p.stop_count != null));

  const busiest = [...before].sort((a, b) => (b.stop_count ?? 0) - (a.stop_count ?? 0))[0];
  const started = Date.now();
  const full = await getPlan(ctx, busiest.id);
  const size = JSON.stringify(full).length;
  console.log(`   getPlan "${busiest.name}": ${Date.now() - started} ms, ${Math.round(size / 1024)} KB, ${full?.stop_count} stops`);
  expect("getPlan: stop count matches the list", full?.stop_count === busiest.stop_count);
  expect("getPlan: days in order", (full?.days ?? []).every((d, i) => d.day_number === i + 1));
  expect(
    "getPlan: stops in order",
    (full?.days ?? []).every((d) => (d.stops ?? []).every((s, i) => s.sort_order === i))
  );
  expect(
    "getPlan: day dates follow the start date",
    (full?.days ?? []).every((d) => (full?.start_date ? d.date === addDays(full.start_date, d.day_number - 1) : d.date === null))
  );
  expect("getPlan: light places (under 2 KB a stop)", size / Math.max(full?.stop_count ?? 1, 1) < 2048);
  expect("getPlan: another user's plan is not found", (await getPlan({ supabase: admin, userId: owner }, busiest.id)) === null);

  // ── Write: a temporary plan ─────────────────────────────────────────
  const { data: placeRows } = await admin
    .from("places")
    .select("id,name,price:google_data->price_level")
    .eq("user_id", tester)
    .eq("city", "London")
    .limit(6);
  const places = (placeRows ?? []) as { id: string; name: string; price: number | null }[];
  if (places.length < 4) {
    expect("tester has at least 4 London places for the write checks", false);
    return;
  }
  const priced = places.find((p) => p.price != null);

  let planId: string | null = null;
  try {
    planId = await createPlan(
      ctx,
      {
        name: "check:assistant — temporary plan",
        start_date: "2027-03-12",
        days: [
          {
            stops: [
              { place_id: (priced ?? places[0]).id, day_part: "evening" },
              { title: "Meet at the Old Street exit", start_time: "19:30" },
            ],
          },
          {},
        ],
      },
      { createdVia: "assistant" }
    );
    let plan = (await getPlan(ctx, planId))!;
    const [first, note] = plan.days![0].stops!;
    expect("create: two days, dates derived", plan.days!.length === 2 && plan.days![1].date === "2027-03-13" && plan.end_date === "2027-03-13");
    expect("create: created_via recorded", plan.created_via === "assistant");
    expect("create: free-text stop with an exact time", note.place_id === null && note.title === "Meet at the Old Street exit" && note.start_time === "19:30");
    expect("create: cost default from the price level", priced ? first.cost_estimate != null : first.cost_estimate === null);

    const foreign = await admin.from("places").select("id").eq("user_id", owner).limit(1).single();
    const refused = await rejects(
      () => changePlan(ctx, planId!, { ops: [{ op: "add_stop", day: 1, place_id: foreign.data!.id }] }),
      PlanInputError
    );
    console.log(`   foreign place → ${refused}`);
    expect("change: another user's place is refused", !!refused);

    // Move the plan: every day follows.
    await changePlan(ctx, planId, { set: { start_date: "2027-04-01" } });
    plan = (await getPlan(ctx, planId))!;
    expect("change: moving the start moves the days", plan.days![0].date === "2027-04-01" && plan.days![1].date === "2027-04-02");

    // A batch: add a day in front, a stop on it, an exact time on the evening stop.
    const result = await changePlan(ctx, planId, {
      ops: [
        { op: "add_day", position: 1 },
        { op: "add_stop", day: 1, place_id: places[1].id },
        { op: "update_stop", stop_id: first.id, start_time: "20:15" },
        { op: "move_stop", stop_id: note.id, day: 3 },
      ],
    });
    plan = (await getPlan(ctx, planId))!;
    const moved = plan.days!.flatMap((d) => d.stops!).find((s) => s.id === first.id)!;
    expect("change: batch applied", plan.days!.length === 3 && result.added_stops.length === 1 && plan.days![0].stops!.length === 1);
    expect("change: a time clears the day part", moved.start_time === "20:15" && moved.day_part === null);
    expect("change: stop moved to day 3", plan.days![2].stops!.some((s) => s.id === note.id));

    // All or nothing.
    const stopsBefore = plan.stop_count;
    const atomic = await rejects(
      () =>
        changePlan(ctx, planId!, {
          ops: [
            { op: "add_stop", day: 1, title: "should not survive" },
            { op: "remove_day", day: 2 },
          ],
        }),
      PlanInputError
    );
    console.log(`   non-empty day → ${atomic}`);
    plan = (await getPlan(ctx, planId))!;
    expect("change: a failing batch changes nothing", !!atomic && plan.stop_count === stopsBefore && plan.days!.length === 3);

    // By id: the change lands on the day that was shown, whatever its number is now.
    const [dayA, dayB, dayC] = plan.days!;
    await changePlan(ctx, planId, {
      ops: [
        { op: "swap_days", a_id: dayA.id, b_id: dayC.id },
        { op: "add_stop", day_id: dayA.id, title: "added by day id" },
        { op: "set_day", day_id: dayB.id, notes: "the middle day" },
      ],
    });
    plan = (await getPlan(ctx, planId))!;
    const movedDay = plan.days!.find((d) => d.id === dayA.id)!;
    expect(
      "change by day id: swapped, and the stop followed the day",
      movedDay.day_number === 3 && movedDay.stops!.some((s) => s.title === "added by day id") && plan.days![1].notes === "the middle day"
    );
    await changePlan(ctx, planId, { ops: [{ op: "swap_days", a_id: dayA.id, b_id: dayC.id }] });
    const gone = await rejects(
      () => changePlan(ctx, planId!, { ops: [{ op: "add_stop", day_id: crypto.randomUUID(), title: "nowhere" }] }),
      PlanInputError
    );
    console.log(`   unknown day id → ${gone}`);
    expect("change by day id: a day that isn't in the plan is refused", !!gone);

    // A gap in sort_order (what a deleted place leaves behind): "add at the
    // end" must still be the end, and the day comes out dense.
    plan = (await getPlan(ctx, planId))!;
    const gapDay = plan.days!.find((d) => d.stops!.length >= 2)!;
    await admin.from("plan_stops").update({ sort_order: 7 }).eq("id", gapDay.stops![gapDay.stops!.length - 1].id);
    await admin.from("plan_stops").update({ sort_order: 3 }).eq("id", gapDay.stops![0].id);
    const order = gapDay.stops!.map((s) => s.id);
    const added = await changePlan(ctx, planId, { ops: [{ op: "add_stop", day_id: gapDay.id, title: "after the gap" }] });
    plan = (await getPlan(ctx, planId))!;
    const healed = plan.days!.find((d) => d.id === gapDay.id)!.stops!;
    expect(
      "gap in the order: a new stop still lands at the end, order dense again",
      healed.map((s) => s.id).join() === [...order, added.added_stops[0]].join() && healed.every((s, i) => s.sort_order === i)
    );

    // Unschedule, cancel, restore.
    await changePlan(ctx, planId, { set: { start_date: null, status: "cancelled" } });
    plan = (await getPlan(ctx, planId))!;
    expect("change: unscheduled and cancelled", plan.start_date === null && plan.end_date === null && plan.days![0].date === null && plan.status === "cancelled");
    await changePlan(ctx, planId, { set: { status: "planned", start_date: "2027-04-01" } });

    const using = await plansUsingPlaces(ctx, [places[1].id, places[3].id]);
    expect(
      "plansUsingPlaces finds the plan for the place that is in it",
      using.plans.some((p) => p.id === planId) && using.placeIds.includes(places[1].id) && !using.placeIds.includes(places[3].id)
    );

    // Auto-plan: three more places, then spread over the three days.
    await changePlan(ctx, planId, {
      ops: places.slice(2, 5).map((p) => ({ op: "add_stop" as const, day: 1, place_id: p.id })),
    });
    const beforeAuto = (await getPlan(ctx, planId))!;
    const auto = await autoPlanStops(ctx, planId);
    const layout = auto.days!.map((d) => d.stops!.map((s) => s.place?.name ?? `"${s.title}"`));
    console.log(`   auto-plan → ${JSON.stringify(layout)}`);
    expect("auto-plan: no stop lost", auto.stop_count === beforeAuto.stop_count);
    expect("auto-plan: stops stay densely ordered", auto.days!.every((d) => d.stops!.every((s, i) => s.sort_order === i)));
    expect("auto-plan: the free-text stop stays in the plan", auto.days!.some((d) => d.stops!.some((s) => s.id === note.id)));

    // One route (a day with two or more located stops, if auto-plan left one).
    const routable = auto.days!.find((d) => d.stops!.filter((s) => s.place?.location).length >= 2);
    if (routable) {
      let billed = 0;
      const route = await dayRoute(routable, () => billed++);
      console.log(`   route day ${routable.day_number}: ${route?.distance_km} km, ${route?.duration_min} min, ${route?.legs.length} legs`);
      const ids = new Set(routable.stops!.map((s) => s.id));
      expect("route: one Directions request, legs name their stops", billed === 1 && !!route && route.legs.every((l) => ids.has(l.from_stop_id) && ids.has(l.to_stop_id)));
      const sig = routeSignature(routable);
      const reversed = routeSignature({ ...routable, stops: [...routable.stops!].reverse() });
      const driving = routeSignature({ ...routable, routing_profile: "driving" });
      const recosted = routeSignature({ ...routable, stops: routable.stops!.map((s) => ({ ...s, cost_estimate: 99 })) });
      console.log(`   route signature: ${sig}`);
      expect("route signature: order and profile change it, a cost doesn't", !!sig && sig !== reversed && sig !== driving && sig === recosted);
    } else {
      console.log("   (no day with two located stops after auto-plan — route check skipped)");
    }

    // The limit of days is the database's, not only the form's.
    const room = 60 - auto.days!.length;
    await changePlan(ctx, planId, { ops: Array.from({ length: room }, () => ({ op: "add_day" as const })) });
    const full = await rejects(() => changePlan(ctx, planId!, { ops: [{ op: "add_day" }] }), PlanInputError);
    console.log(`   61st day → ${full}`);
    expect("a plan stops at 60 days", !!full && (await getPlan(ctx, planId))!.days!.length === 60);

    expect(
      "another user can't change the plan",
      !!(await rejects(() => changePlan({ supabase: admin, userId: owner }, planId!, { set: { name: "hijacked" } }), PlanNotFoundError))
    );
  } finally {
    if (planId) {
      await deletePlan(ctx, planId);
      expect("temporary plan deleted", (await getPlan(ctx, planId)) === null);
      expect("deleting again reports not found", !!(await rejects(() => deletePlan(ctx, planId!), PlanNotFoundError)));
    }
  }

  const after = await listPlans(ctx);
  expect("plan count back to where it started", after.length === before.length);
}
