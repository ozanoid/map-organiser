/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely typed tool output */
/**
 * Plan tool checks: get_plans, create_plan, update_plan — and log_visit with
 * a plan stop — called the way the MCP server calls them, against the live
 * database on the admin test account. Everything created here is deleted at
 * the end and the places used get their status, rating and visit date back.
 * One Mapbox Directions request (free allowance: 100,000 a month); no paid
 * calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import type { AssistantContext } from "@/lib/assistant/library";
import { defaultCostEstimate } from "@/lib/plans/cost-defaults";
import { addDays, planPhase, todayAt, todayIso, weekdayName } from "@/lib/plans/dates";
import { deletePlan } from "@/lib/plans/write";
import { deleteVisit } from "@/lib/visits/write";
import { CHECK_APP_URL } from "./context";

type Expect = (label: string, ok: boolean) => void;

const NAME = "check:assistant — plan tools";

export async function checkPlanTools(admin: SupabaseClient, expect: Expect, tester: string, owner: string) {
  const ctx: AssistantContext = { supabase: admin, userId: tester, appUrl: CHECK_APP_URL };
  const find = (name: string) => {
    const t = ASSISTANT_TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };
  /** Parses the input with the tool's schema first, as the MCP server does. */
  const tool = async (name: string, input: unknown): Promise<any> => {
    const t = find(name);
    return t.run(ctx, t.inputSchema.parse(input) as never);
  };
  /** The error message a call ends with, or null when it succeeds. */
  const failure = async (name: string, input: unknown): Promise<string | null> => {
    try {
      await tool(name, input);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const refuses = (name: string, input: unknown) => !find(name).inputSchema.safeParse(input).success;
  console.log("\n## plan tools");

  // ── Schemas: what clients see ──────────────────────────────────────
  // The MCP SDK converts each input schema with zod's Standard JSON Schema
  // (draft 2020-12) and needs an object at the root.
  for (const t of ASSISTANT_TOOLS) {
    let ok = false;
    try {
      const std = (t.inputSchema as any)["~standard"];
      const json = std.jsonSchema.input({ target: "draft-2020-12" });
      ok = (json.type === "object" || json.type === undefined) && json.additionalProperties === false;
      if (["create_plan", "update_plan", "get_plans"].includes(t.name)) {
        console.log(`   ${t.name}: input schema ${Math.round(JSON.stringify(json).length / 100) / 10} KB`);
      }
    } catch (e) {
      console.log(`   ${t.name}: ${(e as Error).message}`);
    }
    expect(`schema converts, unknown keys refused: ${t.name}`, ok);
  }
  const anId = crypto.randomUUID();
  expect("strict: a day by number and id at once", refuses("update_plan", { plan_id: anId, ops: [{ op: "remove_day", day: 1, day_id: anId }] }));
  expect("strict: an unknown key in an op ('day' on update_stop)", refuses("update_plan", { plan_id: anId, ops: [{ op: "update_stop", stop_id: anId, day: 2 }] }));
  expect("strict: an unknown key at the top", refuses("update_plan", { plan_id: anId, name: "x" }));
  expect("strict: colour isn't Claude's", refuses("update_plan", { plan_id: anId, set: { color: "#000000" } }) && refuses("create_plan", { name: "x", color: "#000000" }));
  expect("strict: 'time' for start_time", refuses("create_plan", { name: "x", days: [{ stops: [{ title: "Meet", time: "19:30" }] }] }));
  expect("strict: a stop is a place or a text, not both", refuses("create_plan", { name: "x", days: [{ stops: [{ place_id: anId, title: "Dinner" }] }] }));
  expect("strict: log_visit refuses 'date' for visited_on", refuses("log_visit", { place_id: anId, date: "2026-11-17" }));

  // ── "Today" where the plan takes place ─────────────────────────────
  // A zone whose date differs from UTC right now: UTC−12 before noon UTC,
  // UTC+14 after. The plan's phase follows the zone, not UTC.
  const behind = todayIso("Etc/GMT+12") !== todayIso("UTC");
  const zone = behind ? "Etc/GMT+12" : "Etc/GMT-14";
  const lastDay = behind ? todayIso("Etc/GMT+12") : todayIso("UTC");
  const onePlan = { status: "planned" as const, start_date: lastDay, end_date: lastDay };
  expect(
    `today: a plan's phase follows its zone (${zone})`,
    planPhase(onePlan, todayAt(zone)) === (behind ? "upcoming" : "past") &&
      planPhase(onePlan, todayIso("UTC")) === (behind ? "past" : "upcoming")
  );
  expect("today: no zone or an unknown one is UTC", todayAt(null) === todayIso("UTC") && todayAt("Not/AZone") === todayIso("UTC"));

  // Located London places of the test account, and their state now.
  const { data: placeRows } = await admin
    .from("places")
    .select("id,name,visit_status,rating,visited_at")
    .eq("user_id", tester)
    .eq("city", "London")
    .not("location", "is", null)
    .is("google_data->price_level", null)
    .order("created_at")
    .limit(2);
  const { data: pricedRow } = await admin
    .from("places")
    .select("id,name,visit_status,rating,visited_at,price:google_data->price_level")
    .eq("user_id", tester)
    .eq("city", "London")
    .not("location", "is", null)
    .not("google_data->price_level", "is", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  type PlaceRow = { id: string; name: string; visit_status: string | null; rating: number | null; visited_at: string | null };
  const unpriced = (placeRows ?? []) as PlaceRow[];
  const priced = pricedRow as (PlaceRow & { price: number }) | null;
  if (unpriced.length < 2 || !priced) {
    expect("the test account has located London places with and without a price level", false);
    return;
  }
  const [p1, p3] = unpriced;
  const places: PlaceRow[] = [p1, priced, p3];
  const { data: foreign } = await admin.from("places").select("id").eq("user_id", owner).limit(1).single();
  const today = todayIso("UTC");
  const start = addDays(today, 10);
  const started = new Date().toISOString();
  const created: string[] = [];

  try {
    // ── create_plan ──────────────────────────────────────────────────
    const made = await tool("create_plan", {
      name: NAME,
      start_date: start,
      party_size: 2,
      days: [
        {
          stops: [
            { title: "Meet at the Old Street exit", day_part: "morning" },
            { place_id: p1.id, start_time: "12:30", notes: "book a table" },
            { place_id: priced.id },
          ],
        },
        { stops: [{ place_id: p3.id, day_part: "evening" }] },
      ],
    });
    const plan = made.plan;
    if (plan?.plan_id) created.push(plan.plan_id);
    console.log(`   created ${plan?.plan_id} → ${plan?.url}`);
    expect("create: saved, link on the app origin", made.saved === "new plan" && plan.url === `${CHECK_APP_URL}/plans/${plan.plan_id}`);
    expect(
      "create: days carry dates and weekdays",
      plan.days.length === 2 &&
        plan.days[0].date === start &&
        plan.days[0].weekday === weekdayName(start) &&
        plan.days[1].date === addDays(start, 1) &&
        plan.end_date === addDays(start, 1)
    );
    const [meet, s1, s2] = plan.days[0].stops;
    const s3 = plan.days[1].stops[0];
    expect(
      "create: a text stop, a place at a time, a part of the day — named as the input names them",
      meet.title === "Meet at the Old Street exit" && !meet.place_id && meet.day_part === "morning" &&
        s1.place_id === p1.id && s1.start_time === "12:30" && s1.notes === "book a table" &&
        s3.place?.name === p3.name && s3.day_part === "evening" && s1.status === "planned"
    );
    expect(
      "create: a priced place gets the dollar default",
      s2.place_id === priced.id && s2.cost_estimate === defaultCostEstimate({ price_level: priced.price }) && s2.currency === "USD"
    );
    const { data: row } = await admin.from("plans").select("created_via,party_size").eq("id", plan.plan_id).single();
    expect("create: recorded as the assistant's", row?.created_via === "assistant" && row?.party_size === 2);

    const countBefore = (await admin.from("plans").select("id", { count: "exact", head: true }).eq("user_id", tester)).count;
    const refused = await failure("create_plan", { name: `${NAME} (foreign)`, days: [{ stops: [{ place_id: foreign!.id }] }] });
    const countAfter = (await admin.from("plans").select("id", { count: "exact", head: true }).eq("user_id", tester)).count;
    console.log(`   foreign place → ${refused}`);
    expect("create: another user's place is refused, nothing saved", !!refused && countBefore === countAfter);

    // ── get_plans ────────────────────────────────────────────────────
    const listed = await tool("get_plans", {});
    const mine = listed.plans.find((p: any) => p.plan_id === plan.plan_id);
    console.log(`   default list: ${listed.plans.length} plan(s); ours → ${JSON.stringify(mine)?.slice(0, 400)}`);
    expect("list: upcoming by default, with counts", mine?.phase === "upcoming" && listed.all_plans.upcoming >= 1);
    expect(
      "list: preview names the first stops in order",
      mine?.stops_preview?.[0] === "Day 1: Meet at the Old Street exit (morning)" &&
        mine?.stops_preview?.[1] === `Day 1: ${p1.name} 12:30` &&
        mine?.days === 2 && mine?.stops === 4 && mine?.party_size === 2
    );
    const byName = await tool("get_plans", { name: "PLAN TOOLS" });
    expect("list: name filter, any case", byName.plans.length === 1 && byName.plans[0].plan_id === plan.plan_id);
    const past = await tool("get_plans", { phase: "past", name: "plan tools" });
    expect("list: not among past plans", past.plans.length === 0 && !!past.note);
    const inRange = await tool("get_plans", { from: addDays(start, 1), to: addDays(start, 1), name: "plan tools" });
    const outOfRange = await tool("get_plans", { from: addDays(start, 2), name: "plan tools" });
    expect("list: a date range catches any day of the plan", inRange.plans.length === 1 && outOfRange.plans.length === 0);

    const full = await tool("get_plans", { plan_id: plan.plan_id, with_routes: true });
    const route = full.plan.days[0].route;
    console.log(`   day 1 route → ${JSON.stringify(route)?.slice(0, 300)}`);
    expect(
      "detail: a route for the day with two places, none for the day with one",
      (route === "unavailable" || (route?.km > 0 && route?.legs?.[0]?.from === p1.name && route?.legs?.[0]?.to === priced.name)) &&
        full.plan.days[1].route === undefined
    );
    expect("detail: unknown plan id is a clear error", /No plan with that id/.test((await failure("get_plans", { plan_id: crypto.randomUUID() })) ?? ""));

    // ── update_plan ──────────────────────────────────────────────────
    const changed = await tool("update_plan", {
      plan_id: plan.plan_id,
      set: { start_date: addDays(start, 1), name: `${NAME} (moved)` },
      ops: [
        { op: "swap_days", a: 1, b: 2 },
        // Read after the swap: day 1 is now the evening day.
        { op: "add_stop", day: 1, title: "Dessert", day_part: "night" },
        // In pounds: the dollar table doesn't apply.
        { op: "add_stop", day: 1, place_id: priced.id, currency: "GBP" },
        { op: "update_stop", stop_id: s2.stop_id, status: "skipped" },
      ],
    });
    const after = changed.plan;
    console.log(`   changed → days ${after.days.map((d: any) => `${d.day}:${d.date}:${d.stops.map((s: any) => s.place?.name ?? s.title).join("+")}`).join(" | ")}`);
    expect(
      "update: dates move with the start, numbers read after the swap",
      after.name === `${NAME} (moved)` &&
        after.days[0].date === addDays(start, 1) &&
        after.days[0].stops.map((s: any) => s.place_id ?? s.title).join() === `${p3.id},Dessert,${priced.id}` &&
        after.days[1].stops.length === 3 &&
        changed.added_stops?.length === 2
    );
    const inPounds = after.days[0].stops[2];
    expect("update: a stop in another currency gets no dollar estimate", inPounds.cost_estimate === undefined);
    expect("update: a stop skipped", after.days[1].stops.find((s: any) => s.stop_id === s2.stop_id)?.status === "skipped");

    const doneRefused = await failure("update_plan", {
      plan_id: plan.plan_id,
      set: { name: "SHOULD NOT LAND" },
      ops: [{ op: "update_stop", stop_id: s1.stop_id, status: "done" }],
    });
    const stillNamed = (await tool("get_plans", { plan_id: plan.plan_id })).plan.name;
    console.log(`   done at a saved place → ${doneRefused}`);
    expect("update: a saved place's stop isn't marked done here — and nothing else lands", /visit/.test(doneRefused ?? "") && stillNamed === `${NAME} (moved)`);
    expect("update: nothing to change is refused", /Nothing to change/.test((await failure("update_plan", { plan_id: plan.plan_id, set: {} })) ?? ""));
    expect("update: unknown plan", /not found/i.test((await failure("update_plan", { plan_id: crypto.randomUUID(), set: { name: "x" } })) ?? ""));

    // ── log_visit with a plan stop ───────────────────────────────────
    // The stop's day is ahead, so the visit takes today's date.
    const logged = await tool("log_visit", { plan_stop_id: s1.stop_id, notes: "check: plan stop" });
    const withVisit = await tool("get_plans", { plan_id: plan.plan_id });
    const ticked = withVisit.plan.days.flatMap((d: any) => d.stops).find((s: any) => s.stop_id === s1.stop_id);
    console.log(`   log_visit(plan_stop_id) → ${logged.visit?.date}, stop ${ticked?.status}`);
    expect(
      "log_visit: the named stop is ticked off and shows its visit",
      logged.visit?.place?.id === p1.id && ticked?.status === "done" && ticked?.visit?.visit_id === logged.visit.visit_id
    );
    const listedDone = await tool("get_plans", { name: "plan tools" });
    expect("list: preview marks a done stop", listedDone.plans[0]?.stops_preview?.some((s: string) => s.includes(`${p1.name} 12:30 [done]`)));
    const undoRefused = await failure("update_plan", { plan_id: plan.plan_id, ops: [{ op: "update_stop", stop_id: s1.stop_id, status: "planned" }] });
    expect("update: a stop with a visit keeps its status", /visit/.test(undoRefused ?? ""));
    expect("log_visit: needs a place, a stop or a visit", /place_id/.test((await failure("log_visit", { rating: 3 })) ?? ""));
    await deleteVisit(ctx, logged.visit.visit_id);

    // ── cancel, restore, unschedule, past ────────────────────────────
    await tool("update_plan", { plan_id: plan.plan_id, set: { status: "cancelled" } });
    const hidden = (await tool("get_plans", {})).plans.some((p: any) => p.plan_id === plan.plan_id);
    const cancelled = await tool("get_plans", { phase: "cancelled", name: "plan tools" });
    const cancelledByName = await tool("get_plans", { name: "plan tools" });
    expect(
      "cancel: off the default list, kept as cancelled, found by name",
      !hidden && cancelled.plans[0]?.phase === "cancelled" && cancelledByName.plans[0]?.phase === "cancelled"
    );
    await tool("update_plan", { plan_id: plan.plan_id, set: { status: "planned" } });
    const unscheduled = await tool("update_plan", { plan_id: plan.plan_id, set: { start_date: null } });
    const back = (await tool("get_plans", {})).plans.find((p: any) => p.plan_id === plan.plan_id);
    expect(
      "restore and unschedule: listed again, without dates",
      unscheduled.plan.phase === "unscheduled" && unscheduled.plan.days.every((d: any) => d.date === undefined) && back?.phase === "unscheduled"
    );
    await tool("update_plan", { plan_id: plan.plan_id, set: { start_date: addDays(today, -10) } });
    const pastDefault = (await tool("get_plans", {})).plans.some((p: any) => p.plan_id === plan.plan_id);
    const pastByName = await tool("get_plans", { name: "plan tools" });
    expect("past: off the default list, found by name", !pastDefault && pastByName.plans[0]?.phase === "past");
  } finally {
    const { data: leftover } = await admin
      .from("visits")
      .select("id")
      .eq("user_id", tester)
      .in("place_id", places.map((p) => p.id))
      .gte("created_at", started);
    for (const v of (leftover ?? []) as { id: string }[]) await deleteVisit(ctx, v.id).catch(() => {});
    const { data: strays } = await admin.from("plans").select("id").eq("user_id", tester).like("name", `${NAME}%`);
    for (const id of new Set([...created, ...((strays ?? []) as { id: string }[]).map((p) => p.id)])) {
      await deletePlan(ctx, id).catch(() => {});
    }
    for (const p of places) {
      await admin.from("places").update({ visit_status: p.visit_status, rating: p.rating, visited_at: p.visited_at }).eq("id", p.id);
    }
    const { data: restored } = await admin.from("places").select("id,visit_status,rating,visited_at").in("id", places.map((p) => p.id));
    const same = places.every((p) => {
      const r = (restored ?? []).find((x) => x.id === p.id);
      return r && r.visit_status === p.visit_status && r.rating === p.rating && r.visited_at === p.visited_at;
    });
    const { count: plansLeft } = await admin.from("plans").select("id", { count: "exact", head: true }).eq("user_id", tester).like("name", `${NAME}%`);
    expect("cleanup: no test plan or visit left, places as they were", same && plansLeft === 0);
  }
}
