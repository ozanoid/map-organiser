import "server-only";
import { z } from "zod";
import { trackUsage } from "@/lib/google/track-usage";
import { geocodeArea } from "@/lib/mapbox/geocode";
import { fold } from "@/lib/text/fold";
import {
  type AssistantContext,
  type LibraryRow,
  ToolInputError,
  closedState,
  coords,
  countryKey,
  distanceMeters,
  isLocalDateTime,
  loadLibrary,
  loadNames,
  openAt,
  openNow,
  placesByTag,
  placesInList,
  priceLevel,
  resolveNames,
} from "@/lib/assistant/library";

/**
 * The filter vocabulary search_places and rank_places share, and the code
 * that applies it to the user's library. Matching is done on folded text
 * (Turkish-aware, no diacritics) — see src/lib/text/fold.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const placeId = z.string().regex(UUID, "Expected a place id from a previous result");

export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm, the local time at the place");

export const VISIT_STATUSES = ["want_to_go", "booked", "visited", "favorite"] as const;

export const nearSchema = z
  .object({
    place_id: placeId.optional().describe("Centre on one of the user's saved places"),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    area: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe("A neighbourhood or address to centre on, e.g. 'Shoreditch, London'"),
    radius_m: z.number().int().min(100).max(30000).optional().describe("Default 1500"),
  })
  .describe("Search around a point: give place_id, or lat and lng, or area");

export const placeFilterShape = {
  query: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Keywords matched against the name, address, the user's notes and the review-derived summary, e.g. 'matcha', 'sunday roast'. Accent- and Turkish-insensitive. Reviews are mostly English, so English words match best."
    ),
  city: z
    .string()
    .max(80)
    .optional()
    .describe("City or district. Also matches the address, so 'Istanbul' finds places stored under Kadıköy."),
  country: z.string().max(60).optional(),
  near: nearSchema.optional(),
  category: z.string().max(60).optional().describe("Category name from get_library_overview, e.g. 'Restaurant'"),
  subcategory: z.string().max(60).optional().describe("Sub-category name, e.g. 'Cocktail Bar'"),
  tags: z
    .array(z.string().max(60))
    .max(5)
    .optional()
    .describe("Tag names from get_library_overview; a place must carry all of them"),
  list: z.string().max(80).optional().describe("List name"),
  visit_status: z
    .enum([...VISIT_STATUSES, "unknown"])
    .optional()
    .describe("'unknown' = never marked by the user (most places)"),
  min_google_rating: z.number().min(0).max(5).optional(),
  min_reviews: z.number().int().min(0).optional().describe("Minimum Google review count — a popularity floor"),
  max_price: z.number().int().min(1).max(4).optional().describe("Google price level, 1 (cheap) to 4 (very expensive)"),
  open_at: localDateTime
    .optional()
    .describe("Only places open at this LOCAL time of each place, e.g. '2026-11-19T20:00' for Thursday 8 pm. Places without opening hours are left out."),
  open_now: z.boolean().optional(),
  include_closed: z
    .boolean()
    .optional()
    .describe("Include permanently or temporarily closed places (default false)"),
  source: z
    .enum(["instagram", "import", "link", "manual", "mapbox_search", "similar", "shared"])
    .optional()
    .describe("How the place was saved, e.g. 'instagram'"),
  saved_since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Only places saved on or after this date (YYYY-MM-DD)"),
};

export const placeFilters = z.object(placeFilterShape);
export type PlaceFilters = z.infer<typeof placeFilters>;

export interface Anchor {
  label: string;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface FilteredLibrary {
  rows: LibraryRow[];
  /** Distance from the anchor, when `near` was given. */
  distance: Map<string, number>;
  anchor: Anchor | null;
  /** Open status at `open_at`, when given. */
  openAtResult: Map<string, { open: boolean; closesAt?: string } | null>;
}

/** A `near` input → a point. Pass the loaded library when there is one;
 *  without it a place_id anchor is read on its own. */
export async function resolveAnchor(
  ctx: AssistantContext,
  n: z.infer<typeof nearSchema>,
  library?: LibraryRow[]
): Promise<Anchor> {
  const radius = n.radius_m ?? 1500;
  if (n.place_id) {
    let row: { name: string; location: unknown } | undefined = library?.find((r) => r.id === n.place_id);
    if (!library) {
      const { data, error } = await ctx.supabase
        .from("places")
        .select("name,location")
        .eq("user_id", ctx.userId)
        .eq("id", n.place_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = data ?? undefined;
    }
    const c = row ? coords(row) : null;
    if (!row || !c) throw new ToolInputError(`No saved place with id ${n.place_id} (or it has no location).`);
    return { label: row.name, ...c, radius_m: radius };
  }
  if (typeof n.lat === "number" && typeof n.lng === "number") {
    return { label: `${n.lat.toFixed(4)}, ${n.lng.toFixed(4)}`, lat: n.lat, lng: n.lng, radius_m: radius };
  }
  if (n.area) {
    const hit = await geocodeArea(n.area);
    // Billed whether or not it found something.
    await trackUsage(ctx.userId, "mapbox_geocoding", ctx.supabase);
    if (!hit) throw new ToolInputError(`Couldn't locate "${n.area}". Pass lat and lng, or near.place_id.`);
    return { label: hit.label, lat: hit.lat, lng: hit.lng, radius_m: radius };
  }
  throw new ToolInputError("near needs place_id, or lat and lng, or area.");
}

/** The user's library narrowed by every filter given. Order is unspecified. */
export async function filterLibrary(ctx: AssistantContext, f: PlaceFilters): Promise<FilteredLibrary> {
  if (f.open_at && !isLocalDateTime(f.open_at)) throw new ToolInputError("open_at must look like 2026-11-19T20:00.");

  const library = await loadLibrary(ctx, { withSummary: Boolean(f.query) });
  let rows = library;

  if (!f.include_closed) rows = rows.filter((r) => closedState(r.g_status) === null);

  if (f.city) {
    const term = fold(f.city);
    rows = rows.filter((r) => fold(r.city).includes(term) || fold(r.address).includes(term));
  }
  if (f.country) {
    const key = countryKey(f.country);
    rows = rows.filter((r) => countryKey(r.country) === key);
  }
  if (f.category) {
    const [cat] = resolveNames("category", [f.category], await loadNames(ctx, "category"));
    rows = rows.filter((r) => fold(r.category?.name) === fold(cat.name));
  }
  if (f.subcategory) {
    const [sub] = resolveNames("subcategory", [f.subcategory], await loadNames(ctx, "subcategory"));
    rows = rows.filter((r) => fold(r.subcategory?.name) === fold(sub.name));
  }
  if (f.tags?.length) {
    const tags = resolveNames("tag", f.tags, await loadNames(ctx, "tag"));
    const byTag = await placesByTag(ctx, tags.map((t) => t.id));
    rows = rows.filter((r) => tags.every((t) => byTag.get(t.id)?.has(r.id)));
  }
  if (f.list) {
    const [list] = resolveNames("list", [f.list], await loadNames(ctx, "list"));
    const inList = await placesInList(ctx, list.id);
    rows = rows.filter((r) => inList.has(r.id));
  }
  if (f.visit_status) {
    rows =
      f.visit_status === "unknown"
        ? rows.filter((r) => !r.visit_status)
        : rows.filter((r) => r.visit_status === f.visit_status);
  }
  if (f.min_google_rating !== undefined) {
    const min = f.min_google_rating;
    rows = rows.filter((r) => typeof r.g_rating === "number" && r.g_rating >= min);
  }
  if (f.min_reviews !== undefined) {
    const min = f.min_reviews;
    rows = rows.filter((r) => typeof r.g_count === "number" && r.g_count >= min);
  }
  if (f.max_price !== undefined) {
    const max = f.max_price;
    rows = rows.filter((r) => {
      const p = priceLevel(r.g_price);
      return p !== null && p <= max;
    });
  }
  if (f.source) rows = rows.filter((r) => r.source === f.source);
  if (f.saved_since) {
    const since = f.saved_since;
    rows = rows.filter((r) => r.created_at.slice(0, 10) >= since);
  }
  if (f.query) {
    const term = fold(f.query);
    rows = rows.filter((r) =>
      [r.name, r.address, r.notes, r.g_tldr, r.g_summary].some((v) => fold(v).includes(term))
    );
  }
  if (f.open_now) rows = rows.filter((r) => openNow(r) === true);

  const openAtResult = new Map<string, { open: boolean; closesAt?: string } | null>();
  if (f.open_at) {
    const at = f.open_at;
    rows = rows.filter((r) => {
      const s = openAt(r, at);
      openAtResult.set(r.id, s);
      return s?.open === true;
    });
  }

  const distance = new Map<string, number>();
  let anchor: Anchor | null = null;
  if (f.near) {
    anchor = await resolveAnchor(ctx, f.near, library);
    const a = anchor;
    rows = rows.filter((r) => {
      const c = coords(r);
      if (!c) return false;
      const d = distanceMeters(a, c);
      distance.set(r.id, d);
      return d <= a.radius_m;
    });
  }

  return { rows, distance, anchor, openAtResult };
}

/** Google rating first, review count as the tie-break. */
export function byRating(a: LibraryRow, b: LibraryRow): number {
  return (b.g_rating ?? 0) - (a.g_rating ?? 0) || (b.g_count ?? 0) - (a.g_count ?? 0);
}
