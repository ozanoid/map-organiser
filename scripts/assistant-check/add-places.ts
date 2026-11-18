/* eslint-disable @typescript-eslint/no-explicit-any -- reads loosely typed tool output */
/**
 * add_places checks against the live database on the admin test account.
 *
 * Free: the input rules, places already saved (no lookup is paid for), a link
 * that names no place, the list option, the unique index on Google ids.
 * Paid (≈ $0.03): one new place by CID, two concurrent adds of another, a CID
 * Google doesn't know, and one Instagram post read again — its places are
 * saved on the test account already, so it adds none.
 *
 * Everything made here is removed at the end — by id, not by time: the
 * places the tool reported, the places the Instagram job created, the list,
 * the jobs. Each enrichment job is cancelled as soon as it is checked, so the
 * drain doesn't pay for reviews and profiles of test places.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";
import type { AssistantContext } from "@/lib/assistant/library";
import { isUniqueViolation } from "@/lib/db/errors";
import { createList, deleteList } from "@/lib/lists/write";
import { CHECK_APP_URL } from "./context";

type Expect = (label: string, ok: boolean) => void;

const NAME = "check:assistant — add_places";
/** Saved on the owner's account, not on the test account (18.11.2026). */
const NEW_CID = "1457660498308052845"; // Speedboat Bar, London
const RACE_CID = "17958412875758778980"; // Bolland & Crust, London
/** The same place twice in one call, by CID and by a link with its place id. */
const TWIN_CID = "4250582062794412619"; // FORNO, London
const TWIN_PLACE_ID = "ChIJIVtLdb4ddkgRSxKCld0Z_To";
/** DataForSEO answers 40102 "No Search Results" for it (measured 18.11.2026). */
const UNKNOWN_CID = "1234567890123456789";
/** Read on the test account on 16.10.2026; its places are all saved there. */
const INSTAGRAM_POST = "https://www.instagram.com/p/DeScO6LDK97/";

export async function checkAddPlaces(admin: SupabaseClient, expect: Expect, tester: string) {
  const ctx: AssistantContext = { supabase: admin, userId: tester, appUrl: CHECK_APP_URL };
  const find = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)!;
  const addPlaces = find("add_places");
  const tool = async (input: unknown): Promise<any> => addPlaces.run(ctx, addPlaces.inputSchema.parse(input) as never);
  const failure = async (input: unknown): Promise<string> => {
    try {
      await tool(input);
      return "(no error)";
    } catch (e) {
      return (e as Error).message;
    }
  };
  console.log("\n## add_places");

  // ── Input rules (nothing is written) ──────────────────────────────
  const parses = (input: unknown) => addPlaces.inputSchema.safeParse(input).success;
  expect("tool: refuses an unknown key", !parses({ place: [{ google_cid: NEW_CID }] }));
  expect("tool: a place refuses an unknown key", !parses({ places: [{ cid: NEW_CID }] }));
  expect("tool: google_cid is a number", !parses({ places: [{ google_cid: "abc" }] }));
  expect("tool: at most 5 places", !parses({ places: Array.from({ length: 6 }, () => ({ google_cid: NEW_CID })) }));
  const json = (addPlaces.inputSchema as any)["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  expect("tool: its JSON schema is closed", json?.additionalProperties === false);
  expect("search_places: source 'assistant' is a filter", find("search_places").inputSchema.safeParse({ source: "assistant" }).success);

  expect("refuses no source", /exactly one/.test(await failure({})));
  expect(
    "refuses two sources",
    /exactly one/.test(await failure({ places: [{ google_cid: NEW_CID }], instagram_url: INSTAGRAM_POST }))
  );
  expect(
    "refuses a place with both google_cid and maps_url",
    /one of them/.test(await failure({ places: [{ google_cid: NEW_CID, maps_url: "https://maps.google.com/?cid=1" }] }))
  );
  expect(
    "refuses an Instagram link as maps_url",
    /instagram_url/.test(await failure({ places: [{ maps_url: INSTAGRAM_POST }] }))
  );
  expect("refuses list_note without list_id", /list_id/.test(await failure({ places: [{ google_cid: NEW_CID, list_note: "x" }] })));
  expect(
    "refuses a list that isn't the user's",
    /No such list/.test(await failure({ places: [{ google_cid: NEW_CID }], list_id: crypto.randomUUID() }))
  );
  expect(
    "instagram_pick refuses visit_status",
    /doesn't go with instagram_pick/.test(
      await failure({
        instagram_pick: { import_id: crypto.randomUUID(), venue_id: crypto.randomUUID(), option_id: "x" },
        visit_status: "visited",
      })
    )
  );
  expect(
    "instagram_pick: an import that isn't the user's is refused",
    /No such Instagram import/.test(
      await failure({ instagram_pick: { import_id: crypto.randomUUID(), venue_id: crypto.randomUUID(), option_id: "x" } })
    )
  );

  // Paid lookups made today, to show the free paths make none.
  const lookups = async () => {
    const { data } = await admin
      .from("api_usage")
      .select("count")
      .eq("user_id", tester)
      .eq("sku", "dataforseo_business_info_live")
      .eq("created_at", new Date().toISOString().slice(0, 10));
    return ((data ?? []) as { count: number }[]).reduce((n, r) => n + r.count, 0);
  };

  const { data: saved } = await admin
    .from("places")
    .select("id,notes,visit_status,google_place_id,cid:google_data->>cid")
    .eq("user_id", tester)
    .like("google_place_id", "ChIJ%")
    .not("google_data->>cid", "is", null)
    .limit(1)
    .single();
  const savedRow = saved as unknown as { id: string; notes: string | null; visit_status: string | null; google_place_id: string; cid: string };

  const createdPlaces = new Set<string>();
  const runJobs = new Set<string>();
  let listId: string | null = null;
  /** The enrichment jobs queued for these places: noted for clean-up and
   *  cancelled at once, before the drain pays for reviews and a profile. */
  const stopEnrichment = async (placeIds: string[]) => {
    const { data } = await admin.from("import_job_items").select("job_id").in("place_id", placeIds);
    const ids = [...new Set(((data ?? []) as { job_id: string }[]).map((r) => r.job_id))];
    for (const id of ids) runJobs.add(id);
    if (ids.length) await admin.from("import_jobs").update({ status: "cancelled" }).in("id", ids).eq("user_id", tester);
  };
  try {
    // ── Places already saved, and links that name no place (free) ──
    const before = await lookups();
    const again = await tool({
      places: [
        { google_cid: savedRow.cid, note: `${NAME}: must not be written` },
        { maps_url: `https://maps.google.com/?q=place_id:${savedRow.google_place_id}` },
        { google_cid: savedRow.cid },
      ],
    });
    const p = again.places ?? [];
    expect(
      "saved place by cid → already_saved, with its id and link",
      p[0]?.status === "already_saved" && p[0]?.place_id === savedRow.id && p[0]?.url === `${CHECK_APP_URL}/places/${savedRow.id}`
    );
    expect("saved place by Maps link → already_saved", p[1]?.status === "already_saved" && p[1]?.place_id === savedRow.id);
    expect("one place twice in one call → the same answer", p[2]?.place_id === savedRow.id);
    const { data: after } = await admin.from("places").select("notes,visit_status").eq("id", savedRow.id).single();
    expect(
      "a saved place keeps its notes and status, and the answer says so",
      after?.notes === savedRow.notes && after?.visit_status === savedRow.visit_status && Boolean(p[0]?.note_not_saved)
    );
    expect("nothing queued for places already saved", again.enrichment === undefined);

    const noPlace = await tool({
      places: [{ maps_url: "https://www.google.com/maps/search/ramen/@51.5246,-0.0786,15z" }],
    });
    expect("a link that names no place → not_one_place", noPlace.places?.[0]?.status === "not_one_place");
    expect("…and none of it paid for a lookup", (await lookups()) === before);

    // ── The list option on a saved place (free) ─────────────────────
    listId = (await createList(ctx, { name: `${NAME} list`, ops: [] }, { createdVia: "app" })).list_id;
    const withList = await tool({ places: [{ google_cid: savedRow.cid, list_note: "Order the lamb" }], list_id: listId });
    const { data: entry } = await admin
      .from("list_places")
      .select("note")
      .eq("list_id", listId)
      .eq("place_id", savedRow.id)
      .maybeSingle();
    expect(
      "list_id puts a saved place on the list with its list_note",
      withList.list?.added_to_list === 1 && entry?.note === "Order the lamb" && withList.list?.url === `${CHECK_APP_URL}/lists/${listId}`
    );
    const again2 = await tool({ places: [{ google_cid: savedRow.cid, list_note: "Something else" }], list_id: listId });
    const { data: entry2 } = await admin
      .from("list_places")
      .select("note")
      .eq("list_id", listId)
      .eq("place_id", savedRow.id)
      .maybeSingle();
    expect(
      "a place on the list with a note keeps it, and the answer says so",
      entry2?.note === "Order the lamb" && Boolean(again2.places?.[0]?.list_note_kept) && again2.list?.already_on_list === 1
    );

    // ── One place per Google id (free) ──────────────────────────────
    const { data: dupe, error: dupeError } = await admin
      .from("places")
      .insert({
        user_id: tester,
        name: `${NAME} duplicate`,
        location: "POINT(0 0)",
        google_place_id: savedRow.google_place_id,
        source: "manual",
      })
      .select("id")
      .maybeSingle();
    if (dupe?.id) createdPlaces.add(dupe.id as string);
    expect("the database refuses a second place with the same Google id", isUniqueViolation(dupeError));

    // ── A new place (paid: one lookup) ──────────────────────────────
    const added = await tool({ places: [{ google_cid: NEW_CID, note: `${NAME}: a note` }] });
    const a = added.places?.[0];
    if (a?.place_id) createdPlaces.add(a.place_id);
    const { data: row } = await admin
      .from("places")
      .select("name,source,visit_status,notes,google_place_id,category_id,cid:google_data->>cid,main_image:google_data->>main_image")
      .eq("id", a?.place_id ?? crypto.randomUUID())
      .maybeSingle();
    expect(
      "new place by cid → added, with Google's name, its link and category",
      a?.status === "added" && Boolean(row?.name) && a?.name === row?.name && a?.url === `${CHECK_APP_URL}/places/${a?.place_id}`
    );
    expect(
      "…source assistant, want_to_go, the note, both Google ids, the image to fetch",
      row?.source === "assistant" &&
        row?.visit_status === "want_to_go" &&
        row?.notes === `${NAME}: a note` &&
        String(row?.google_place_id).startsWith("ChIJ") &&
        row?.cid === NEW_CID &&
        Boolean(row?.main_image)
    );
    const { data: items } = await admin
      .from("import_job_items")
      .select("job_id,stage,import_jobs!inner(kind,status)")
      .eq("place_id", a?.place_id ?? crypto.randomUUID());
    const item = (items ?? [])[0] as any;
    expect(
      "…photo, reviews and profile queued: an assistant job, its item at the photo stage",
      items?.length === 1 && item?.stage === "photo" && item?.import_jobs?.kind === "assistant" && /background/.test(added.enrichment ?? "")
    );
    if (a?.place_id) await stopEnrichment([a.place_id]);

    // ── Two adds of one place at once (paid: up to two lookups) ─────
    const [r1, r2] = await Promise.all([
      tool({ places: [{ google_cid: RACE_CID }] }),
      tool({ places: [{ google_cid: RACE_CID }] }),
    ]);
    const raced = [r1.places?.[0], r2.places?.[0]];
    for (const r of raced) if (r?.place_id) createdPlaces.add(r.place_id);
    await stopEnrichment(raced.flatMap((r) => (r?.place_id ? [r.place_id] : [])));
    const { count: rows } = await admin
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("user_id", tester)
      .eq("google_data->>cid", RACE_CID);
    expect(
      "two adds of one place at once → one row, one added and one already_saved",
      rows === 1 &&
        raced[0]?.place_id === raced[1]?.place_id &&
        raced.map((r) => r?.status).sort().join(",") === "added,already_saved"
    );

    // ── One place twice in one call, in two forms (paid: two lookups) ──
    const twin = await tool({
      places: [{ google_cid: TWIN_CID }, { maps_url: `https://maps.google.com/?q=place_id:${TWIN_PLACE_ID}` }],
    });
    const twins = [twin.places?.[0], twin.places?.[1]];
    for (const r of twins) if (r?.place_id) createdPlaces.add(r.place_id);
    await stopEnrichment(twins.flatMap((r) => (r?.place_id ? [r.place_id] : [])));
    const { count: twinRows } = await admin
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("user_id", tester)
      .eq("google_place_id", TWIN_PLACE_ID);
    expect(
      "one place by CID and by link in one call → one row, both added",
      twinRows === 1 && twins[0]?.place_id === twins[1]?.place_id && twins.every((r) => r?.status === "added")
    );

    // ── A CID Google doesn't know (paid: one lookup) ────────────────
    const unknown = await tool({ places: [{ google_cid: UNKNOWN_CID }] });
    const { count: ghost } = await admin
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("user_id", tester)
      .eq("google_data->>cid", UNKNOWN_CID);
    expect("a cid Google doesn't know → not_found, nothing saved", unknown.places?.[0]?.status === "not_found" && ghost === 0);

    // ── An Instagram post (paid: one read; its places are saved) ────
    const ig = await tool({ instagram_url: INSTAGRAM_POST });
    if (ig.import_id) {
      runJobs.add(ig.import_id);
      // Nothing more from this post: venues still pending aren't imported.
      await admin.from("import_jobs").update({ status: "cancelled" }).eq("id", ig.import_id).eq("user_id", tester);
    }
    for (const x of [...(ig.added ?? [])]) if (x.place_id) createdPlaces.add(x.place_id);
    console.log(
      `   instagram: ${ig.status}; added ${ig.added?.length ?? 0}, adding ${ig.adding?.length ?? 0}, already saved ${ig.already_saved?.length ?? 0}, not added ${ig.not_added?.length ?? 0}`
    );
    expect(
      "instagram: the post is read — import id, review link, its places already saved",
      Boolean(ig.import_id) && ig.review_url === `${CHECK_APP_URL}/map?ig=${ig.import_id}` && ig.already_saved?.length > 0
    );
    const { data: igJob } = await admin.from("import_jobs").select("meta").eq("id", ig.import_id).maybeSingle();
    expect("instagram: the job records that Claude started it", (igJob?.meta as any)?.via === "assistant");
    expect(
      "instagram_pick: a venue that isn't in the import is refused",
      /No such venue/.test(
        await failure({ instagram_pick: { import_id: ig.import_id, venue_id: crypto.randomUUID(), option_id: "x" } })
      )
    );
    const venue = (ig.not_added ?? []).find((v: any) => v.options?.length);
    if (venue) {
      expect(
        "instagram_pick: an option the import didn't offer is refused",
        /can't be picked/.test(
          await failure({ instagram_pick: { import_id: ig.import_id, venue_id: venue.venue_id, option_id: "not-an-option" } })
        )
      );
    }
  } finally {
    // ── Clean up, by id ──────────────────────────────────────────────
    const jobIds = [...runJobs];
    if (jobIds.length) {
      await admin.from("import_jobs").update({ status: "cancelled" }).in("id", jobIds).eq("user_id", tester);
      // Places these jobs created (items past `import`); "Already exists"
      // items point at places that were there before and are left alone.
      const { data: made } = await admin
        .from("import_job_items")
        .select("place_id")
        .in("job_id", jobIds)
        .in("stage", ["photo", "reviews", "profile", "done"]);
      for (const m of (made ?? []) as { place_id: string | null }[]) if (m.place_id) createdPlaces.add(m.place_id);
      await admin.from("import_jobs").delete().in("id", jobIds).eq("user_id", tester);
    }
    const ids = [...createdPlaces].filter((id) => id !== savedRow.id);
    if (ids.length) await admin.from("places").delete().in("id", ids).eq("user_id", tester);
    if (listId) await deleteList(ctx, listId);
    const { count: left } = ids.length
      ? await admin.from("places").select("id", { count: "exact", head: true }).in("id", ids)
      : { count: 0 };
    const { count: jobsLeft } = jobIds.length
      ? await admin.from("import_jobs").select("id", { count: "exact", head: true }).in("id", jobIds)
      : { count: 0 };
    expect(`clean-up: the ${ids.length} places and ${jobIds.length} jobs this run made are gone`, left === 0 && jobsLeft === 0);
  }
}
