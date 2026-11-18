/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely typed tool output */
/**
 * List checks: the shared module (src/lib/lists) and the assistant tools
 * get_lists / save_list / get_places, against the live database on the
 * admin test account. Every list made here is deleted at the end. The
 * places used are on none of the account's own lists — setPlaceLists sets
 * ALL of a place's lists — and the last check compares the account's own
 * lists item by item with how they were before. No paid calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import type { AssistantContext } from "@/lib/assistant/library";
import { applyListChanges } from "@/lib/lists/local";
import { getList, listsOfPlaces } from "@/lib/lists/read";
import { listChangesSchema } from "@/lib/lists/schema";
import {
  addPlacesToList,
  addPlaceToLists,
  createList,
  deleteList,
  ListInputError,
  ListNotFoundError,
  setPlaceLists,
} from "@/lib/lists/write";
import { CHECK_APP_URL } from "./context";

type Expect = (label: string, ok: boolean) => void;

const NAME = "check:assistant — lists";

async function rejects(run: () => Promise<unknown>, kind: new (...args: never[]) => Error): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof kind ? (e as Error).message : `wrong error: ${(e as Error).message}`;
  }
}

export async function checkLists(admin: SupabaseClient, expect: Expect, tester: string, owner: string) {
  const ctx: AssistantContext = { supabase: admin, userId: tester, appUrl: CHECK_APP_URL };
  const find = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)!;
  const tool = async (name: string, input: unknown): Promise<any> => {
    const t = find(name);
    return t.run(ctx, t.inputSchema.parse(input) as never);
  };
  const failure = async (name: string, input: unknown): Promise<string | null> => {
    try {
      await tool(name, input);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  console.log("\n## lists");

  // ── Pure: input shapes ─────────────────────────────────────────────
  const anId = crypto.randomUUID();
  expect("schema: nothing to change is refused", !listChangesSchema.safeParse({}).success);
  expect("schema: 'notes' for note is refused", !listChangesSchema.safeParse({ ops: [{ op: "add_place", place_id: anId, notes: "x" }] }).success);
  expect("schema: a note over 2000 characters is refused", !listChangesSchema.safeParse({ ops: [{ op: "set_note", place_id: anId, note: "a".repeat(2001) }] }).success);
  expect("tool: save_list refuses an unknown key", !find("save_list").inputSchema.safeParse({ name: "x" }).success);
  expect("schema: add_place takes no null note (clearing is set_note's)", !listChangesSchema.safeParse({ ops: [{ op: "add_place", place_id: anId, note: null }] }).success);

  // The account's own lists, item by item, to compare at the end.
  const snapshot = async () => {
    const { data } = await admin
      .from("list_places")
      .select("place_id,sort_order,note,lists!inner(id,name,user_id)")
      .eq("lists.user_id", tester)
      .not("lists.name", "like", `${NAME}%`);
    return ((data ?? []) as unknown as { place_id: string; sort_order: number; note: string | null; lists: { id: string } }[])
      .map((r) => `${r.lists.id}:${r.place_id}:${r.sort_order}:${r.note ?? ""}`)
      .sort()
      .join("|");
  };
  const ownBefore = await snapshot();

  // Five places that are on none of the account's lists.
  const { data: onLists } = await admin.from("list_places").select("place_id,lists!inner(user_id)").eq("lists.user_id", tester);
  const listed = new Set(((onLists ?? []) as { place_id: string }[]).map((r) => r.place_id));
  const { data: placeRows } = await admin
    .from("places")
    .select("id,name")
    .eq("user_id", tester)
    .order("created_at")
    .limit(400);
  const p = ((placeRows ?? []) as { id: string; name: string }[]).filter((x) => !listed.has(x.id)).slice(0, 5);
  if (p.length < 5) {
    expect("the test account has five places on no list", false);
    return;
  }
  const { data: foreign } = await admin.from("places").select("id").eq("user_id", owner).limit(1).single();
  const made: string[] = [];
  const order = async (listId: string) =>
    ((await getList(ctx, listId))?.items ?? []).map((i) => `${p.findIndex((x) => x.id === i.place_id) + 1}${i.note ? `:${i.note}` : ""}`).join(",");

  try {
    // ── save_list: a new list with places and notes ─────────────────
    const created = await tool("save_list", {
      set: { name: `${NAME} — November`, description: "solo dinners" },
      ops: [
        { op: "add_place", place_id: p[0].id, note: "order the lamb" },
        { op: "add_place", place_id: p[1].id },
        { op: "add_place", place_id: p[2].id, note: "bar seats" },
      ],
    });
    const list = created.list;
    if (list?.list_id) made.push(list.list_id);
    console.log(`   created ${list?.list_id} → ${list?.url}`);
    expect(
      "create: saved with its places in order, notes and link",
      created.saved === "new list" &&
        created.added === 3 &&
        list.url === `${CHECK_APP_URL}/lists/${list.list_id}` &&
        list.places.map((x: any) => x.place_id).join() === [p[0].id, p[1].id, p[2].id].join() &&
        list.places[0].note === "order the lamb" &&
        list.places[1].note === undefined &&
        list.description === "solo dinners"
    );
    const { data: row } = await admin.from("lists").select("created_via").eq("id", list.list_id).single();
    expect("create: recorded as the assistant's", row?.created_via === "assistant");
    expect("create: a new list needs a name", /set\.name/.test((await failure("save_list", { ops: [] })) ?? ""));

    // ── get_lists ────────────────────────────────────────────────────
    const all = await tool("get_lists", {});
    const mine = all.lists?.find((l: any) => l.list_id === list.list_id);
    expect("list: every list with counts and a link", mine?.places === 3 && mine?.url === list.url);
    const byName = await tool("get_lists", { name: "LISTS — nov" });
    expect("list: one name match comes back in full", byName.list?.list_id === list.list_id && byName.list.places.length === 3);
    expect("list: unknown id is a clear error", /No list with that id/.test((await failure("get_lists", { list_id: anId })) ?? ""));

    // ── save_list: changes in one call ───────────────────────────────
    const changed = await tool("save_list", {
      list_id: list.list_id,
      set: { name: `${NAME} — November (2)` },
      ops: [
        { op: "add_place", place_id: p[0].id, note: "lamb shoulder" }, // already there: note replaced
        { op: "add_place", place_id: p[3].id, position: 0 }, // to the front
        { op: "move_place", place_id: p[2].id, position: 0 },
        { op: "set_note", place_id: p[2].id, note: null },
        { op: "remove_place", place_id: p[4].id }, // not on it
      ],
    });
    console.log(`   changed → ${await order(list.list_id)}`);
    expect(
      "change: already-on note replaced, front insert, move, note cleared, absent reported",
      changed.already_on_list === 1 &&
        changed.added === 1 &&
        changed.not_on_list?.[0] === p[4].id &&
        changed.list.name === `${NAME} — November (2)` &&
        (await order(list.list_id)) === "3,4,1:lamb shoulder,2"
    );
    const before = await order(list.list_id);
    const refused = await failure("save_list", {
      list_id: list.list_id,
      set: { name: "SHOULD NOT LAND" },
      ops: [{ op: "add_place", place_id: foreign!.id }],
    });
    const after = await getList(ctx, list.list_id);
    console.log(`   foreign place → ${refused}`);
    expect("change: another user's place refuses the whole call", !!refused && after?.name === `${NAME} — November (2)` && (await order(list.list_id)) === before);
    expect("change: nothing to change is refused", /Nothing to change/.test((await failure("save_list", { list_id: list.list_id, set: {} })) ?? ""));
    expect(
      "change: a partial reorder is refused",
      !!(await rejects(
        () => tool("save_list", { list_id: list.list_id, ops: [{ op: "reorder", place_ids: [p[0].id] }] }),
        ListInputError
      ))
    );

    // ── get_places shows the place's lists with its note ─────────────
    // A note without words keeps the note there; "\n" through set_note clears.
    await tool("save_list", { list_id: list.list_id, ops: [{ op: "add_place", place_id: p[0].id, note: " \n " }] });
    const kept = (await getList(ctx, list.list_id))?.items.find((i) => i.place_id === p[0].id)?.note;
    await tool("save_list", { list_id: list.list_id, ops: [{ op: "set_note", place_id: p[3].id, note: "x" }, { op: "set_note", place_id: p[3].id, note: "\n" }] });
    const cleared = (await getList(ctx, list.list_id))?.items.find((i) => i.place_id === p[3].id)?.note;
    expect("notes: a blank note on add_place keeps the note, a blank set_note clears it", kept === "lamb shoulder" && cleared === null);

    // What the page shows before the server answers matches what it answers.
    const beforeLocal = (await getList(ctx, list.list_id))!;
    const localChange = {
      ops: [
        { op: "move_place" as const, place_id: p[1].id, position: 0 },
        { op: "set_note" as const, place_id: p[2].id, note: " shown at once " },
        { op: "remove_place" as const, place_id: p[3].id },
      ],
    };
    const predicted = applyListChanges(beforeLocal, localChange);
    await tool("save_list", { list_id: list.list_id, ...localChange });
    const answered = (await getList(ctx, list.list_id))!;
    const shape = (l: typeof answered) => l.items.map((i) => `${i.place_id}:${i.sort_order}:${i.note ?? ""}`).join();
    console.log(`   local ${shape(predicted).length > 0 ? "matches" : "empty"} → ${await order(list.list_id)}`);
    expect("page: the change shown at once is the one the server makes", shape(predicted) === shape(answered));
    // p[3] back, second: the list is now 2, 4, 3 (with its note), 1.
    await tool("save_list", { list_id: list.list_id, ops: [{ op: "add_place", place_id: p[3].id, position: 1 }] });

    const details = await tool("get_places", { place_ids: [p[0].id] });
    const onList = details.places?.[0]?.user?.lists?.find((l: any) => l.list_id === list.list_id);
    expect("get_places: the list with the place's note", onList?.note === "lamb shoulder");

    // ── The place page path: only the list that changes is written ───
    const second = await createList(ctx, { name: `${NAME} — second`, ops: [{ op: "add_place", place_id: p[1].id }] }, { createdVia: "app" });
    made.push(second.list_id);
    await setPlaceLists(ctx, p[0].id, [second.list_id]); // off the first list, onto the second
    const firstNow = await order(list.list_id);
    const secondNow = await order(second.list_id);
    await setPlaceLists(ctx, p[0].id, [second.list_id, list.list_id]); // back on the first, at its end
    const memberships = (await listsOfPlaces(ctx, [p[0].id])).get(p[0].id) ?? [];
    console.log(`   setPlaceLists → first ${firstNow} | second ${secondNow} | back: ${await order(list.list_id)}`);
    expect(
      "place page: only changed lists are written; the others keep order and notes",
      firstNow === "2,4,3:shown at once" && secondNow === "2,1" && (await order(list.list_id)) === "2,4,3:shown at once,1" &&
        memberships.length === 2 && memberships.every((m) => typeof m.sort_order === "number")
    );

    // ── Bulk add and new-place add ───────────────────────────────────
    const bulk = await addPlacesToList(ctx, second.list_id, [p[1].id, p[2].id, p[4].id]);
    expect("bulk: new places added at the end, the one already there kept", bulk.added.length === 2 && bulk.already.length === 1 && (await order(second.list_id)) === "2,1,3,5");
    const gone = crypto.randomUUID();
    const added = await addPlaceToLists(ctx, p[3].id, [second.list_id, gone]);
    expect("new place: onto the lists that exist, a missing one named back", added.missing.join() === gone && (await order(second.list_id)).endsWith(",4"));

    // ── Delete ───────────────────────────────────────────────────────
    await deleteList(ctx, second.list_id);
    made.splice(made.indexOf(second.list_id), 1);
    expect("delete: the list goes, its places stay", (await getList(ctx, second.list_id)) === null && !!(await admin.from("places").select("id").eq("id", p[1].id).single()).data);
    expect("delete: a list that is gone", !!(await rejects(() => deleteList(ctx, second.list_id), ListNotFoundError)));
  } finally {
    for (const id of made) await deleteList(ctx, id).catch(() => {});
    const { data: strays } = await admin.from("lists").select("id").eq("user_id", tester).like("name", `${NAME}%`);
    for (const s of (strays ?? []) as { id: string }[]) await deleteList(ctx, s.id).catch(() => {});
    const { count } = await admin.from("lists").select("id", { count: "exact", head: true }).eq("user_id", tester).like("name", `${NAME}%`);
    expect("cleanup: no test list left", count === 0);
    expect("cleanup: the account's own lists are exactly as before", (await snapshot()) === ownBefore);
  }
}
