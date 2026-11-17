import "server-only";
import { z } from "zod";
import { closedState, countryKey, loadLibrary } from "@/lib/assistant/library";
import { defineTool } from "@/lib/assistant/tools/types";

/** The map of the library: what exists, under which names, how many. */
export const getLibraryOverview = defineTool({
  name: "get_library_overview",
  title: "Library overview",
  description:
    "Overview of the user's saved places: countries and cities, categories with sub-categories, tags and lists — each with a count — plus visit-status counts and recently saved places. Call it first when you need the exact names other tools take as filters, or to see what the library holds.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx) {
    const rows = await loadLibrary(ctx);
    const total = rows.length;

    const visit = { want_to_go: 0, booked: 0, visited: 0, favorite: 0, unknown: 0 };
    let rated = 0;
    const closed = { permanently: 0, temporarily: 0 };
    const sources: Record<string, number> = {};
    for (const r of rows) {
      const k = (r.visit_status ?? "unknown") as keyof typeof visit;
      if (k in visit) visit[k]++;
      if (r.rating) rated++;
      const c = closedState(r.g_status);
      if (c) closed[c]++;
      const s = r.source ?? "unknown";
      sources[s] = (sources[s] ?? 0) + 1;
    }

    // Countries, merging spellings Google returned in two languages; the
    // most common spelling is shown. Cities as stored (some are districts).
    const countries = new Map<string, { names: Map<string, number>; places: number; cities: Map<string, number> }>();
    for (const r of rows) {
      const key = countryKey(r.country) || "(unknown)";
      const entry = countries.get(key) ?? { names: new Map(), places: 0, cities: new Map() };
      const name = r.country ?? "(unknown)";
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
      entry.places++;
      const city = r.city ?? "(unknown)";
      entry.cities.set(city, (entry.cities.get(city) ?? 0) + 1);
      countries.set(key, entry);
    }
    const merged: string[] = [];
    const countryList = [...countries.values()]
      .sort((a, b) => b.places - a.places)
      .map((e) => {
        const names = [...e.names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
        if (names.length > 1) merged.push(names.join(" + "));
        return {
          country: names[0],
          places: e.places,
          cities: [...e.cities.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([city, places]) => ({ city, places })),
        };
      });

    // Categories with their sub-categories.
    const cats = new Map<string, { places: number; subs: Map<string, number> }>();
    for (const r of rows) {
      const cat = r.category?.name ?? "(uncategorised)";
      const entry = cats.get(cat) ?? { places: 0, subs: new Map() };
      entry.places++;
      if (r.subcategory?.name) entry.subs.set(r.subcategory.name, (entry.subs.get(r.subcategory.name) ?? 0) + 1);
      cats.set(cat, entry);
    }
    const categories = [...cats.entries()]
      .sort((a, b) => b[1].places - a[1].places)
      .map(([name, e]) => ({
        name,
        places: e.places,
        subcategories: [...e.subs.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([sub, places]) => ({ name: sub, places })),
      }));

    const [{ data: tagRows, error: tagErr }, { data: listRows, error: listErr }] = await Promise.all([
      ctx.supabase.from("tags").select("name, place_tags(count)").eq("user_id", ctx.userId),
      ctx.supabase.from("lists").select("name, list_places(count)").eq("user_id", ctx.userId),
    ]);
    if (tagErr) throw new Error(tagErr.message);
    if (listErr) throw new Error(listErr.message);
    const countOf = (v: unknown) => (Array.isArray(v) && typeof v[0]?.count === "number" ? v[0].count : 0);
    const tags = (tagRows ?? [])
      .map((t) => ({ name: t.name as string, places: countOf(t.place_tags) }))
      .filter((t) => t.places > 0)
      .sort((a, b) => b.places - a.places);
    const lists = (listRows ?? []).map((l) => ({ name: l.name as string, places: countOf(l.list_places) }));

    const recently_saved = [...rows]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)
      .map((r) => ({ id: r.id, name: r.name, area: r.city ?? undefined, saved: r.created_at.slice(0, 10) }));

    const notes: string[] = [];
    if (visit.unknown > total / 2) {
      notes.push(
        `Visit status is unknown for ${visit.unknown} of ${total} places: "unknown" means never marked, not "not visited". Ask the user when it matters.`
      );
    }
    if (rated === 0) notes.push("The user hasn't rated any place yet; Google ratings are the only rating signal.");
    if (merged.length) notes.push(`Country names stored two ways were merged: ${merged.join("; ")}.`);
    if (closed.permanently + closed.temporarily > 0) {
      notes.push("Closed places are left out of searches unless include_closed is set.");
    }

    return {
      total_places: total,
      visit_status: visit,
      rated_by_user: rated,
      closed,
      countries: countryList,
      categories,
      tags,
      lists,
      sources,
      recently_saved,
      notes,
    };
  },
});
