import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { UserContext } from "@/lib/db/context";
import { classifyPostgrestError, InputError, NotFoundError } from "@/lib/db/errors";
import { listsOfPlaces } from "@/lib/lists/read";
import type { ListChanges, ListCreateInput, ListOp, ListSet } from "@/lib/lists/schema";

/**
 * Writing lists — the one write path for every caller: the list pages, the
 * place page, new places, bulk actions, imports, saving a shared list, the
 * in-app assistant and Claude's save_list. Each write is one call to the
 * Postgres function save_list, so it is one transaction: a batch lands
 * completely or not at all, the order stays dense, and every place is
 * checked to be the user's.
 */

/** The caller's input can't be applied; the message says why. */
export class ListInputError extends InputError {}
/** The list doesn't exist or isn't the caller's. */
export class ListNotFoundError extends NotFoundError {
  constructor() {
    super("List not found");
  }
}

function fail(error: PostgrestError): never {
  const kind = classifyPostgrestError(error);
  if (kind.kind === "not_found") throw new ListNotFoundError();
  if (kind.kind === "input") throw new ListInputError(kind.message);
  throw new Error(error.message);
}

/** What save_list did; the last four are place ids. */
export interface ListSaveResult {
  list_id: string;
  created: boolean;
  added: string[];
  already: string[];
  removed: string[];
  absent: string[];
}

async function saveList(
  ctx: UserContext,
  payload: { list_id?: string; set?: ListSet; ops?: ListOp[]; created_via?: "app" | "assistant" }
): Promise<ListSaveResult> {
  const { data, error } = await ctx.supabase.rpc("save_list", { p_user_id: ctx.userId, p_list: payload });
  if (error) fail(error);
  return data as ListSaveResult;
}

/** A new list, optionally with places on it already — one transaction. */
export async function createList(
  ctx: UserContext,
  input: ListCreateInput & { ops?: ListOp[] },
  opts: { createdVia: "app" | "assistant" }
): Promise<ListSaveResult> {
  const { ops, ...set } = input;
  return saveList(ctx, { set, ops, created_via: opts.createdVia });
}

/** Applies `set` and `ops` to a list in one transaction. */
export async function changeList(ctx: UserContext, listId: string, changes: ListChanges): Promise<ListSaveResult> {
  return saveList(ctx, { list_id: listId, set: changes.set, ops: changes.ops });
}

/** Deletes a list. Its places stay saved. */
export async function deleteList(ctx: UserContext, listId: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("lists")
    .delete()
    .eq("id", listId)
    .eq("user_id", ctx.userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new ListNotFoundError();
}

/** Many places onto one list at its end, in one transaction (bulk action,
 *  the in-app assistant). Places already on it keep their position. */
export async function addPlacesToList(
  ctx: UserContext,
  listId: string,
  placeIds: string[]
): Promise<ListSaveResult> {
  const ops = [...new Set(placeIds)].map((place_id): ListOp => ({ op: "add_place", place_id }));
  return changeList(ctx, listId, { ops });
}

/** One place onto several lists (a new place, an import). Each list is its
 *  own save; lists that are already gone are skipped and named back. */
export async function addPlaceToLists(
  ctx: UserContext,
  placeId: string,
  listIds: string[]
): Promise<{ missing: string[] }> {
  const missing: string[] = [];
  for (const listId of new Set(listIds)) {
    try {
      await changeList(ctx, listId, { ops: [{ op: "add_place", place_id: placeId }] });
    } catch (e) {
      if (!(e instanceof ListNotFoundError)) throw e;
      missing.push(listId);
    }
  }
  return { missing };
}

/**
 * Makes a place's lists exactly `listIds` — the place page's "lists" field.
 * Only the lists that change are written, so on every other list the place
 * keeps its position and its note. (The old route deleted all of a place's
 * list rows and inserted them again, which put it first on every list.)
 */
export async function setPlaceLists(ctx: UserContext, placeId: string, listIds: string[]): Promise<void> {
  const current = (await listsOfPlaces(ctx, [placeId])).get(placeId) ?? [];
  const have = new Set(current.map((l) => l.id));
  const want = new Set(listIds);
  for (const listId of want) {
    if (!have.has(listId)) await changeList(ctx, listId, { ops: [{ op: "add_place", place_id: placeId }] });
  }
  for (const listId of have) {
    if (!want.has(listId)) await changeList(ctx, listId, { ops: [{ op: "remove_place", place_id: placeId }] });
  }
}
