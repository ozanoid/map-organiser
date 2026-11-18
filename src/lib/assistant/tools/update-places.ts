import "server-only";
import { z } from "zod";
import { ToolInputError, loadNames, resolveNames, type NamedRow } from "@/lib/assistant/library";
import { VISIT_STATUSES, placeId } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";
import { fold } from "@/lib/text/fold";

interface CurrentRow {
  id: string;
  name: string;
  notes: string | null;
  visited_at: string | null;
  booked_at: string | null;
}

/** Existing tags by folded name, creating the missing ones. */
async function ensureTags(
  ctx: Parameters<typeof loadNames>[0],
  names: string[]
): Promise<{ tags: NamedRow[]; created: string[] }> {
  const existing = await loadNames(ctx, "tag");
  const tags: NamedRow[] = [];
  const created: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const hit = existing.find((t) => fold(t.name) === fold(name));
    if (hit) {
      tags.push(hit);
      continue;
    }
    const { data, error } = await ctx.supabase
      .from("tags")
      .insert({ user_id: ctx.userId, name })
      .select("id,name")
      .single();
    if (error?.code === "23505") {
      // Created in the meantime — read it back.
      const again = (await loadNames(ctx, "tag")).find((t) => fold(t.name) === fold(name));
      if (again) tags.push(again);
      continue;
    }
    if (error || !data) throw new Error(error?.message ?? "Tag insert failed");
    existing.push(data as NamedRow);
    tags.push(data as NamedRow);
    created.push(name);
  }
  return { tags, created };
}

export const updatePlaces = defineTool({
  name: "update_places",
  title: "Update saved places",
  description:
    "Write to the user's own records for 1–25 saved places: visit status (want_to_go, booked, visited, favorite; null clears it), the user's overall rating 1–5 (null clears it), a note about the place appended to its notes (existing notes are kept), and tags to add or remove. When the user tells you they went somewhere — a date, how it was, what they had — use log_visit instead: it records the visit and updates status and rating itself. Use update_places only when the user asks for it or confirms.",
  inputSchema: z.object({
    place_ids: z.array(placeId).min(1).max(25),
    visit_status: z.enum(VISIT_STATUSES).nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional().describe("The user's own rating; null clears it"),
    note: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("A note about the place in the user's own words, appended to its notes; not for one visit — that is log_visit"),
    add_tags: z.array(z.string().min(1).max(40)).max(10).optional().describe("Tag names; missing tags are created"),
    remove_tags: z.array(z.string().min(1).max(60)).max(10).optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, input) {
    const { place_ids, visit_status, rating, note, add_tags, remove_tags } = input;
    if (
      visit_status === undefined &&
      rating === undefined &&
      !note &&
      !add_tags?.length &&
      !remove_tags?.length
    ) {
      throw new ToolInputError("Nothing to change: give visit_status, rating, note, add_tags or remove_tags.");
    }

    const ids = [...new Set(place_ids)];
    const { data, error } = await ctx.supabase
      .from("places")
      .select("id,name,notes,visited_at,booked_at")
      .eq("user_id", ctx.userId)
      .in("id", ids);
    if (error) throw new Error(error.message);
    const current = (data ?? []) as CurrentRow[];
    if (current.length === 0) throw new ToolInputError("None of those ids is a saved place. Use ids from search_places.");

    // Resolve tags before writing anything, so a bad tag name changes nothing.
    const removeTags = remove_tags?.length ? resolveNames("tag", remove_tags, await loadNames(ctx, "tag")) : [];
    const now = new Date().toISOString();

    const updated: Array<Record<string, unknown>> = [];
    for (const row of current) {
      const updates: Record<string, unknown> = {};
      // Same stamping rules as PATCH /api/places/[id].
      if (visit_status !== undefined) {
        updates.visit_status = visit_status;
        if (visit_status === "visited" && !row.visited_at) updates.visited_at = now;
        else if (visit_status === "booked" && !row.booked_at) updates.booked_at = now;
        else if (visit_status === null || visit_status === "want_to_go") {
          updates.visited_at = null;
          updates.booked_at = null;
        }
      }
      if (rating !== undefined) updates.rating = rating;
      if (note) updates.notes = row.notes?.trim() ? `${row.notes.trim()}\n${note.trim()}` : note.trim();

      if (Object.keys(updates).length) {
        updates.updated_at = now;
        const { error: upErr } = await ctx.supabase
          .from("places")
          .update(updates)
          .eq("id", row.id)
          .eq("user_id", ctx.userId);
        if (upErr) throw new Error(upErr.message);
      }
      updated.push({
        id: row.id,
        name: row.name,
        visit_status: visit_status === undefined ? undefined : visit_status ?? "cleared",
        rating: rating === undefined ? undefined : rating ?? "cleared",
        note_added: note ? true : undefined,
      });
    }

    const placeIds = current.map((r) => r.id);
    let created: string[] = [];
    if (add_tags?.length) {
      const ensured = await ensureTags(ctx, add_tags);
      created = ensured.created;
      const links = placeIds.flatMap((place_id) => ensured.tags.map((t) => ({ place_id, tag_id: t.id })));
      const { error: linkErr } = await ctx.supabase
        .from("place_tags")
        .upsert(links, { onConflict: "place_id,tag_id", ignoreDuplicates: true });
      if (linkErr) throw new Error(linkErr.message);
    }
    if (removeTags.length) {
      const { error: delErr } = await ctx.supabase
        .from("place_tags")
        .delete()
        .in("place_id", placeIds)
        .in("tag_id", removeTags.map((t) => t.id));
      if (delErr) throw new Error(delErr.message);
    }

    const unknown = ids.filter((id) => !placeIds.includes(id));
    return {
      updated,
      tags_added: add_tags?.length ? add_tags : undefined,
      tags_created: created.length ? created : undefined,
      tags_removed: removeTags.length ? removeTags.map((t) => t.name) : undefined,
      unknown_ids: unknown.length ? unknown : undefined,
    };
  },
});
