"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyListChanges } from "@/lib/lists/local";
import type { ListChanges } from "@/lib/lists/schema";
import type { ListDetail, PlaceList } from "@/lib/types";

/**
 * Lists — server state.
 *
 *   ["lists"]              every list with its place count
 *   ["lists", id]          one list: its items in order (place id, position, note)
 *   ["places", {list_id}]  the list's places themselves (usePlaces)
 *
 * One list sits under the overview's key, so invalidating ["lists"] — what
 * a write elsewhere does (a new place, a bulk add, the in-app assistant, a
 * deleted place) — refreshes an open list page too.
 *
 * Every write goes through /api/lists — one call to save_list, one
 * transaction. useChangeList's answer is the list as it is afterwards and
 * replaces the cached one. Writes to one list share a scope: they run one
 * after another, so answers can't arrive out of order. The places are read
 * again only when a write changes which places are on the list.
 */

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error || fallback);
}

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: async (): Promise<PlaceList[]> => {
      const res = await fetch("/api/lists");
      if (!res.ok) throw await readError(res, "Failed to load lists");
      return res.json();
    },
  });
}

export function useList(id: string | undefined) {
  return useQuery({
    queryKey: ["lists", id],
    queryFn: async (): Promise<ListDetail | null> => {
      const res = await fetch(`/api/lists/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await readError(res, "Failed to load the list");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; color?: string }): Promise<{ id: string }> => {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res, "Failed to create the list");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
      if (!res.ok) throw await readError(res, "Failed to delete the list");
    },
    onSuccess: (_data, listId) => {
      // "Not found" from now on: a page still showing it, or a Back to its
      // URL, must not bring the deleted list up from the cache.
      queryClient.setQueryData(["lists", listId], null);
      queryClient.invalidateQueries({ queryKey: ["places"] });
      return queryClient.invalidateQueries({ queryKey: ["lists"], exact: true });
    },
  });
}

/** Whether a change puts places on the list or takes them off — only then
 *  do the list's places (and list filters elsewhere) need reading again. */
const changesMembership = (changes: ListChanges) =>
  (changes.ops ?? []).some((op) => op.op === "add_place" || op.op === "remove_place");

const changeKey = (listId: string) => ["list-change", listId];

/**
 * Applies `{ set, ops }` to a list. The change shows at once: the cached list
 * takes it before the request goes out (applyListChanges — order, notes,
 * removals). The server's answer then replaces the cached list, but only the
 * answer to the last write still queued: an earlier one would undo the
 * writes behind it on screen. `list` is null when the server committed the
 * change but couldn't read the list back — then it is refetched, as after an
 * error.
 */
export function useChangeList(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: changeKey(listId),
    scope: { id: `list-${listId}` },
    mutationFn: async (changes: ListChanges): Promise<{ list: ListDetail | null }> => {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw await readError(res, "Failed to change the list");
      return res.json();
    },
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: ["lists", listId] });
      const shown = queryClient.getQueryData<ListDetail | null>(["lists", listId]);
      if (shown) queryClient.setQueryData(["lists", listId], applyListChanges(shown, changes));
    },
    onSuccess: async ({ list }, changes) => {
      // This write is still counted while its callbacks run: 1 means none behind it.
      const last = queryClient.isMutating({ mutationKey: changeKey(listId) }) <= 1;
      if (last) {
        // A read started by an earlier write's error must not land on top.
        await queryClient.cancelQueries({ queryKey: ["lists", listId] });
        if (list) queryClient.setQueryData(["lists", listId], list);
        else queryClient.invalidateQueries({ queryKey: ["lists", listId] });
      }
      queryClient.invalidateQueries({ queryKey: ["lists"], exact: true });
      if (changesMembership(changes)) queryClient.invalidateQueries({ queryKey: ["places"] });
    },
    // The change shown didn't happen (or not all of it): read the list again.
    onError: () => queryClient.invalidateQueries({ queryKey: ["lists", listId] }),
  });
}

/** Puts a place on a list or takes it off — the place page's list picker.
 *  Only that list changes; on the others the place keeps its position and
 *  its note. `note` and `position` put it back as it was (Undo). Toggles
 *  queue behind each other. */
export function useTogglePlaceOnList() {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: "list-membership" },
    mutationFn: async ({
      listId,
      placeId,
      on,
      note,
      position,
    }: {
      listId: string;
      placeId: string;
      on: boolean;
      note?: string | null;
      position?: number;
    }) => {
      const op = on
        ? { op: "add_place", place_id: placeId, ...(note ? { note } : {}), ...(position != null ? { position } : {}) }
        : { op: "remove_place", place_id: placeId };
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: [op] }),
      });
      if (!res.ok) throw await readError(res, on ? "Failed to add to the list" : "Failed to remove from the list");
    },
    onSuccess: () => {
      // The overview and that list (a cached page of it), and list filters.
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    },
  });
}
