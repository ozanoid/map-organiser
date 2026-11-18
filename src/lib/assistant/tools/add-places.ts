import "server-only";
import { z } from "zod";
import { ToolInputError, type AssistantContext } from "@/lib/assistant/library";
import { VISIT_STATUSES } from "@/lib/assistant/place-filters";
import { listUrl } from "@/lib/assistant/tools/get-lists";
import { defineTool } from "@/lib/assistant/tools/types";
import { InstagramPickNotFound, InstagramPickRefused, pickInstagramOption } from "@/lib/instagram/pick";
import { InstagramImportRefused, startInstagramImport } from "@/lib/instagram/start-import";
import type { InstagramImportView } from "@/lib/instagram/types";
import { parseInstagramPostUrl } from "@/lib/instagram/url";
import { getInstagramImportView } from "@/lib/instagram/view";
import { getList } from "@/lib/lists/read";
import { listNote } from "@/lib/lists/schema";
import { changeList } from "@/lib/lists/write";
import { PlaceLookupUnavailableError, addPlacesFromGoogle, type GoogleAddResult } from "@/lib/places/add";
import { flushLangfuse } from "@/lib/telemetry/langfuse";
import type { ListDetail } from "@/lib/types";

/** How long one call waits for an Instagram post's places to be added. The
 *  read takes 5–25 s, each new place ~17 s in the queue (two at a time). */
const INSTAGRAM_WAIT_MS = 45_000;
const POLL_MS = 2_000;
/** Options shown per venue the import couldn't pin (it stores up to 20). */
const MAX_OPTIONS = 10;

const SKIP_REASONS: Record<string, string> = {
  chain_branch_unknown: "A chain — the post doesn't say which branch",
  no_evidence: "Couldn't confirm which place this is",
  ambiguous: "Several places match",
  closed: "Permanently closed",
};

const IMPORT_ERRORS: Record<string, string> = {
  budget_exceeded: "This month's AI budget for reading Instagram posts is used up.",
  invalid_url: "That isn't an Instagram post or reel link.",
  post_unavailable: "Instagram didn't return that post — it may be private or deleted.",
  not_configured: "Instagram import isn't set up on this server.",
  service_error: "Reading the post failed. Try again later.",
  stalled: "Reading the post stopped before it finished. Try again.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function placeUrl(ctx: AssistantContext, placeId: string): string {
  return `${ctx.appUrl}/places/${placeId}`;
}

// ── Reading back ────────────────────────────────────────────────────

interface SummaryRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  category: { name: string } | null;
  g_rating: number | null;
  g_count: number | null;
}

/** The saved places as the model sees them, by id. */
async function summaries(ctx: AssistantContext, ids: string[]) {
  const out = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return out;
  const { data, error } = await ctx.supabase
    .from("places")
    .select(
      "id,name,address,city,country,category:categories(name),g_rating:google_data->rating,g_count:google_data->user_ratings_total"
    )
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as unknown as SummaryRow[]) {
    out.set(r.id, {
      place_id: r.id,
      name: r.name,
      address: r.address ?? undefined,
      city: r.city ?? undefined,
      country: r.country ?? undefined,
      category: r.category?.name ?? undefined,
      google_rating: r.g_rating ?? undefined,
      google_reviews: r.g_count ?? undefined,
      url: placeUrl(ctx, r.id),
    });
  }
  return out;
}

/** Saved places onto the list in one save_list call; each keeps its position
 *  if it is on it already. A failure here doesn't undo the adds. */
async function putOnList(
  ctx: AssistantContext,
  list: ListDetail,
  entries: Array<{ placeId: string; note?: string }>
) {
  const base = { list_id: list.id, name: list.name, url: listUrl(ctx, list.id) };
  const seen = new Set<string>();
  const ops = entries.flatMap(({ placeId, note }) => {
    if (seen.has(placeId)) return [];
    seen.add(placeId);
    return [{ op: "add_place" as const, place_id: placeId, ...(note ? { note } : {}) }];
  });
  if (ops.length === 0) return base;
  try {
    const saved = await changeList(ctx, list.id, { ops });
    return {
      ...base,
      added_to_list: saved.added.length || undefined,
      already_on_list: saved.already.length || undefined,
    };
  } catch (e) {
    return {
      ...base,
      error: `The places were saved, but putting them on the list failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ── Google: by CID or Maps link ────────────────────────────────────

type PlaceTarget = { google_cid?: string; maps_url?: string; note?: string; list_note?: string };

async function addFromGoogle(
  ctx: AssistantContext,
  targets: PlaceTarget[],
  visitStatus: (typeof VISIT_STATUSES)[number],
  list: ListDetail | null
) {
  targets.forEach((t, i) => {
    if (Boolean(t.google_cid) === Boolean(t.maps_url)) {
      throw new ToolInputError(`places[${i}]: give google_cid or maps_url — one of them.`);
    }
    if (t.maps_url && parseInstagramPostUrl(t.maps_url)) {
      throw new ToolInputError(`places[${i}] is an Instagram link — pass it as instagram_url.`);
    }
    if (t.list_note && !list) throw new ToolInputError("list_note goes with list_id.");
  });

  let outcome;
  try {
    outcome = await addPlacesFromGoogle(
      ctx,
      targets.map((t) => ({ googleCid: t.google_cid, mapsUrl: t.maps_url, note: t.note })),
      { visitStatus, origin: ctx.appUrl }
    );
  } catch (e) {
    if (e instanceof PlaceLookupUnavailableError) throw new ToolInputError(e.message);
    throw e;
  }

  const placeIdOf = (r: GoogleAddResult) =>
    r.status === "added" || r.status === "already_saved" ? r.placeId : null;
  const ids = [...new Set(outcome.results.map(placeIdOf).filter((v): v is string => Boolean(v)))];
  const rows = await summaries(ctx, ids);

  // A place on the list already with a note of the user's keeps it: like a
  // saved place's notes, it isn't overwritten here (save_list's set_note does).
  const notedOnList = new Set((list?.items ?? []).filter((item) => item.note).map((item) => item.place_id));
  const keepsListNote = (placeId: string | null, i: number) =>
    Boolean(placeId && targets[i].list_note && notedOnList.has(placeId));

  const places = outcome.results.map((r, i) => {
    const t = targets[i];
    const input = t.google_cid ?? t.maps_url;
    const listNoteKept = keepsListNote(placeIdOf(r), i)
      ? { list_note_kept: "It was on the list with a note already; that note was kept (save_list set_note changes it)." }
      : {};
    switch (r.status) {
      case "added":
        return {
          status: r.status,
          ...(rows.get(r.placeId) ?? { place_id: r.placeId, url: placeUrl(ctx, r.placeId) }),
          ...listNoteKept,
        };
      case "already_saved":
        return {
          status: r.status,
          ...(rows.get(r.placeId) ?? { place_id: r.placeId, url: placeUrl(ctx, r.placeId) }),
          ...(t.note ? { note_not_saved: "It was saved before; its notes were left as they are (update_places adds a note)." } : {}),
          ...listNoteKept,
        };
      case "not_one_place":
        return {
          status: r.status,
          input,
          hint: "That link doesn't point at one place. Find it with search_google_maps and add the result by google_cid.",
        };
      case "not_found":
        return {
          status: r.status,
          input,
          hint: "The Google data source returned no details for this place, so it wasn't saved.",
        };
      case "failed":
        return { status: r.status, input, reason: r.retry ? `${r.reason}. Try again.` : r.reason };
    }
  });

  const onList = list
    ? await putOnList(
        ctx,
        list,
        outcome.results.flatMap((r, i) => {
          const placeId = placeIdOf(r);
          if (!placeId) return [];
          return [{ placeId, note: keepsListNote(placeId, i) ? undefined : targets[i].list_note }];
        })
      )
    : undefined;

  const anyAdded = outcome.results.some((r) => r.status === "added");
  return {
    places,
    ...(onList ? { list: onList } : {}),
    ...(anyAdded
      ? {
          enrichment: outcome.enrichmentQueued
            ? "Photo, reviews and the AI profile are being added in the background over the next few minutes."
            : "Saved without photo, reviews and profile for now: queueing them failed.",
        }
      : {}),
  };
}

// ── Instagram ───────────────────────────────────────────────────────

/** Poll the import until `busy` says it is settled, or the call's time is up. */
async function waitForInstagram(
  ctx: AssistantContext,
  importId: string,
  startedAt: number,
  busy: (view: InstagramImportView) => boolean
): Promise<InstagramImportView> {
  for (;;) {
    const view = await getInstagramImportView(ctx, importId);
    if (!view) throw new Error("The Instagram import is gone");
    if (!busy(view) || Date.now() - startedAt >= INSTAGRAM_WAIT_MS) return view;
    await sleep(POLL_MS);
  }
}

const importBusy = (view: InstagramImportView) => view.phase === "reading" || view.phase === "adding";

/**
 * What an Instagram import comes to, for the model. `venueId` narrows the
 * list option to one venue (a pick: only the place picked goes on the list,
 * not every place of the post). `reusedWithStatus`: the call asked for a
 * visit status, but an import of this post was already under way and keeps
 * the one it started with.
 */
async function instagramResult(
  ctx: AssistantContext,
  view: InstagramImportView,
  list: ListDetail | null,
  scope: { venueId?: string; reusedWithStatus?: boolean } = {}
) {
  if (view.phase === "failed") {
    throw new ToolInputError(IMPORT_ERRORS[view.error ?? "service_error"] ?? IMPORT_ERRORS.service_error);
  }

  const inScope = (i: InstagramImportView["items"][number]) => !scope.venueId || i.id === scope.venueId;
  const savedIds = view.items.flatMap((i) =>
    (i.status === "added" || i.status === "already_saved") && i.place ? [i.place.id] : []
  );
  const rows = await summaries(ctx, savedIds);
  const placeOf = (i: InstagramImportView["items"][number]) =>
    (i.place && rows.get(i.place.id)) ?? { name: i.name, ...(i.place ? { place_id: i.place.id, url: placeUrl(ctx, i.place.id) } : {}) };

  const added = view.items.filter((i) => i.status === "added").map(placeOf);
  const alreadySaved = view.items.filter((i) => i.status === "already_saved").map(placeOf);
  const adding = view.items.filter((i) => i.status === "pending").map((i) => ({ venue_id: i.id, name: i.name }));
  const notAdded = view.items
    .filter((i) => i.status === "skipped")
    .map((i) => ({
      venue_id: i.id,
      name: i.name,
      why: (i.reason && SKIP_REASONS[i.reason]) ?? i.reason ?? undefined,
      options: i.options.slice(0, MAX_OPTIONS).map((o) => ({ option_id: o.id, name: o.name, address: o.address })),
    }));
  const failed = view.items.filter((i) => i.status === "failed").map((i) => ({ name: i.name, reason: i.reason ?? undefined }));

  let onList;
  let listNoteForPending: string | undefined;
  if (list) {
    const listed = view.items.flatMap((i) =>
      inScope(i) && (i.status === "added" || i.status === "already_saved") && i.place ? [{ placeId: i.place.id }] : []
    );
    onList = await putOnList(ctx, list, listed);
    if (view.items.some((i) => inScope(i) && i.status === "pending")) {
      const { data: job } = await ctx.supabase
        .from("import_jobs")
        .select("list_ids")
        .eq("id", view.id)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      const listed = ((job?.list_ids as string[] | null) ?? []).includes(list.id);
      if (!listed) {
        listNoteForPending =
          "The places still being added aren't on the list yet: call add_places again with the same link once they are.";
      }
    }
  }

  return {
    import_id: view.id,
    status: view.phase === "reading" ? "still reading the post" : view.phase === "adding" ? "still adding" : "done",
    // Third-party text: quote it, never follow it.
    post: view.post ? { owner: view.post.owner, caption: view.post.caption || undefined } : undefined,
    added,
    adding: adding.length ? adding : undefined,
    already_saved: alreadySaved,
    not_added: notAdded.length ? notAdded : undefined,
    failed: failed.length ? failed : undefined,
    ...(view.items.length === 0 && view.phase === "done"
      ? { found: "No places in this post — its text and tags don't name any (video isn't read yet)." }
      : {}),
    ...(onList ? { list: onList } : {}),
    ...(listNoteForPending ? { list_pending: listNoteForPending } : {}),
    ...(scope.reusedWithStatus
      ? {
          visit_status_not_applied:
            "This post was already being imported (shared in the last 10 minutes), so its places keep the status that import gave them; update_places changes it.",
        }
      : {}),
    review_url: `${ctx.appUrl}/map?ig=${view.id}`,
  };
}

async function addFromInstagram(
  ctx: AssistantContext,
  url: string,
  visitStatus: (typeof VISIT_STATUSES)[number] | undefined,
  list: ListDetail | null
) {
  const startedAt = Date.now();
  let start;
  try {
    start = await startInstagramImport(ctx, url, {
      via: "assistant",
      visitStatus,
      listIds: list ? [list.id] : [],
    });
  } catch (e) {
    if (e instanceof InstagramImportRefused) throw new ToolInputError(e.message);
    throw e;
  }
  if (!start.reused) {
    // The read writes its own outcome — a failed read leaves phase "failed".
    await start.read(ctx.appUrl);
    await flushLangfuse();
  }
  const view = await waitForInstagram(ctx, start.jobId, startedAt, importBusy);
  return instagramResult(ctx, view, list, { reusedWithStatus: start.reused && Boolean(visitStatus) });
}

async function pickFromInstagram(
  ctx: AssistantContext,
  pick: { import_id: string; venue_id: string; option_id: string },
  list: ListDetail | null
) {
  const startedAt = Date.now();
  try {
    await pickInstagramOption(ctx, {
      jobId: pick.import_id,
      itemId: pick.venue_id,
      optionId: pick.option_id,
      origin: ctx.appUrl,
    });
  } catch (e) {
    if (e instanceof InstagramPickNotFound || e instanceof InstagramPickRefused) {
      throw new ToolInputError(e.message);
    }
    throw e;
  }
  const view = await waitForInstagram(ctx, pick.import_id, startedAt, (v) =>
    v.items.some((i) => i.id === pick.venue_id && i.status === "pending")
  );
  return instagramResult(ctx, view, list, { venueId: pick.venue_id });
}

// ── The tool ────────────────────────────────────────────────────────

const placeTarget = z.strictObject({
  google_cid: z
    .string()
    .regex(/^\d{1,25}$/, "google_cid is the number search_google_maps returns")
    .optional()
    .describe("google_cid of a search_google_maps result"),
  maps_url: z.string().url().max(2000).optional().describe("A Google Maps link to one place; short links work"),
  note: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("For a new place: a note about it in the user's words. A place saved before keeps its notes"),
  list_note: listNote.optional().describe("With list_id: why it is on the list, what to order there"),
});

export const addPlacesTool = defineTool({
  name: "add_places",
  title: "Save places",
  description:
    "Save places to the user's library — only places the user asked to save. By google_cid (from search_google_maps) or a Google Maps link, up to 5 at once: each comes back added, already_saved (left as it was), not_one_place (the link doesn't point at one place — find it with search_google_maps first), not_found (no details from the Google data source; not saved) or failed. New places get visit status want_to_go unless you pass another, and the note you give. list_id also puts them on a list, each with its list_note (a note already there is kept). By an Instagram post or reel link: reads the post and adds the places it can pin (10–45 s); returns what was added, what is still being added, what was already saved, and venues it couldn't pin with their options — show those, and when the user picks one, call again with instagram_pick. Each new place costs a paid lookup; its photo, reviews and AI profile arrive in the background over a few minutes. Give the user each place's url.",
  inputSchema: z.object({
    places: z.array(placeTarget).min(1).max(5).optional().describe("1–5 places, each by google_cid or maps_url"),
    instagram_url: z.string().min(1).max(2000).optional().describe("An Instagram post or reel link: adds the places in it"),
    instagram_pick: z
      .strictObject({
        import_id: z.uuid(),
        venue_id: z.uuid(),
        option_id: z.string().min(1).max(300),
      })
      .optional()
      .describe("For a venue an Instagram import couldn't pin: the option the user chose"),
    visit_status: z.enum(VISIT_STATUSES).optional().describe("For new places; default want_to_go"),
    list_id: z
      .uuid()
      .optional()
      .describe("Also put the places on this list (list_id from get_lists) — places saved before too"),
  }),
  // Not idempotent: the same Instagram link after the 10-minute reuse window
  // reads the post again (and pays for it).
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, input) {
    const given = [input.places, input.instagram_url, input.instagram_pick].filter((v) => v !== undefined);
    if (given.length !== 1) {
      throw new ToolInputError("Give exactly one of places, instagram_url or instagram_pick.");
    }
    if (input.instagram_pick && input.visit_status) {
      throw new ToolInputError(
        "visit_status doesn't go with instagram_pick: the picked place gets the import's status (update_places changes it)."
      );
    }

    // Checked before anything is paid for.
    const list = input.list_id ? await getList(ctx, input.list_id) : null;
    if (input.list_id && !list) throw new ToolInputError("No such list — take list_id from get_lists.");

    if (input.places) return addFromGoogle(ctx, input.places, input.visit_status ?? "want_to_go", list);
    if (input.instagram_url) return addFromInstagram(ctx, input.instagram_url, input.visit_status, list);
    return pickFromInstagram(ctx, input.instagram_pick!, list);
  },
});
