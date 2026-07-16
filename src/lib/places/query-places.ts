import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePostgisPoint } from "@/lib/geo";
import { isOpenNow } from "@/lib/places/open-now";

/**
 * v1.21.0 (S3 AI-02): the GET /api/places query engine, extracted
 * verbatim so the route and the assistant's `search_places` tool share
 * ONE implementation. Behaviour is intentionally identical to the
 * pre-extraction route — see that file's history for the rationale of
 * each block.
 *
 * IMPORTANT: google_rating / open_now / tags / list are JS POST-filters
 * (JSONB / time-dependent / junction-table predicates with no sane SQL
 * form). Do not "optimise" them into the SQL query.
 */

export interface PlaceQueryFilters {
  /** Explicit id set (UUID-validated, capped at 10) — compare view. */
  ids?: string[];
  country?: string;
  city?: string;
  categoryIds?: string[];
  subcategoryIds?: string[];
  tagIds?: string[];
  listId?: string;
  visitStatus?: string;
  ratingMin?: number;
  googleRatingMin?: number;
  /** Keyword search across name/address/notes + profile summary fields. */
  search?: string;
  sort?: string;
  openNow?: boolean;
}

export interface PlaceQueryResult {
  /** Post-filtered, sorted, location-parsed rows. */
  places: any[];
  /** Row count BEFORE JS post-filters (diagnostic logging). */
  sqlRows: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST or() values containing commas/parentheses must be
// double-quoted (backslash-escaping the comma is NOT valid PostgREST
// syntax and breaks the filter). Inside the quotes, escape \ and ";
// escape % so user-typed percent signs match literally instead of
// acting as LIKE wildcards.
const orLikePattern = (term: string) =>
  `"%${term
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")}%"`;

export async function queryPlaces(
  supabase: SupabaseClient,
  userId: string,
  filters: PlaceQueryFilters
): Promise<PlaceQueryResult> {
  const sortConfig: Record<string, { column: string; ascending: boolean }> = {
    newest: { column: "created_at", ascending: false },
    oldest: { column: "created_at", ascending: true },
    name_asc: { column: "name", ascending: true },
    name_desc: { column: "name", ascending: false },
    rating_desc: { column: "rating", ascending: false },
  };
  const { column: sortColumn, ascending: sortAscending } =
    sortConfig[filters.sort || ""] ?? sortConfig.newest;

  let query = supabase
    .from("places")
    .select("*, category:categories(*), subcategory:subcategories(*)")
    .eq("user_id", userId)
    .order(sortColumn, { ascending: sortAscending });

  if (filters.ids?.length) {
    // UUID-validate: a malformed id would otherwise reach Postgres and
    // surface as a raw 22P02 500. Non-UUIDs are silently dropped — but
    // an ids-filter where NOTHING survives must mean "no matches", not
    // "no filter": falling through would return the caller's ENTIRE
    // library (the chat compare_places tool hit exactly this).
    const ids = filters.ids.filter((id) => UUID_RE.test(id)).slice(0, 10);
    if (ids.length === 0) return { places: [], sqlRows: 0 };
    query = query.in("id", ids);
  }

  if (filters.country) query = query.eq("country", filters.country);
  if (filters.city) {
    // OR-match against `city` AND `address` ilike. Workaround for the
    // import bug that stores some addresses with city=administrative
    // region ("England") while the actual locality ("London") only
    // appears in the address. See docs/_plans/data-bugs.md.
    const p = orLikePattern(filters.city);
    query = query.or(`city.ilike.${p},address.ilike.${p}`);
  }
  if (filters.categoryIds?.length)
    query = query.in("category_id", filters.categoryIds);
  if (filters.subcategoryIds?.length)
    query = query.in("subcategory_id", filters.subcategoryIds);
  if (filters.visitStatus) query = query.eq("visit_status", filters.visitStatus);
  if (filters.ratingMin !== undefined && !Number.isNaN(filters.ratingMin))
    query = query.gte("rating", filters.ratingMin);
  if (filters.search) {
    // name/address/notes are the classic fields. The two profile fields
    // extend keyword search into review-derived vocabulary ("matcha",
    // "rooftop") that never appears in the place's own columns — keeps
    // plain search consistent with what AI search can find.
    const p = orLikePattern(filters.search);
    query = query.or(
      `name.ilike.${p},address.ilike.${p},notes.ilike.${p},google_data->place_profile->>searchable_summary.ilike.${p},google_data->place_profile->>tldr.ilike.${p}`
    );
  }

  const { data: places, error } = await query;
  if (error) throw new Error(error.message);

  const sqlRows = places?.length ?? 0;
  let filteredPlaces = places || [];

  // Filter by Google rating (stored in JSONB, can't filter at query level)
  if (
    filters.googleRatingMin !== undefined &&
    !Number.isNaN(filters.googleRatingMin)
  ) {
    const min = filters.googleRatingMin;
    filteredPlaces = filteredPlaces.filter((p: any) => {
      const gr = p.google_data?.rating;
      return gr && gr >= min;
    });
  }

  // v1.18.0 dynamic "open now" — evaluated at request time from the
  // stored structured timetable in the PLACE's own timezone (JS
  // post-filter; a time-dependent JSONB predicate has no sane SQL form).
  // Places without timetable/tz are EXCLUDED: unknown ≠ open.
  if (filters.openNow) {
    filteredPlaces = filteredPlaces.filter(
      (p: any) =>
        isOpenNow(p.google_data?.work_timetable, p.google_data?.tz) === true
    );
  }

  // If filtering by tags, do a secondary filter
  if (filters.tagIds && filters.tagIds.length > 0) {
    const { data: taggedPlaceIds } = await supabase
      .from("place_tags")
      .select("place_id")
      .in("tag_id", filters.tagIds);

    if (taggedPlaceIds) {
      const ids = new Set(taggedPlaceIds.map((t) => t.place_id));
      filteredPlaces = filteredPlaces.filter((p) => ids.has(p.id));
    }
  }

  // If filtering by list, do a secondary filter + sort by sort_order
  if (filters.listId) {
    const { data: listPlaceIds } = await supabase
      .from("list_places")
      .select("place_id, sort_order")
      .eq("list_id", filters.listId)
      .order("sort_order", { ascending: true });

    if (listPlaceIds) {
      const orderMap = new Map(
        listPlaceIds.map((lp) => [lp.place_id, lp.sort_order ?? 0])
      );
      filteredPlaces = filteredPlaces
        .filter((p) => orderMap.has(p.id))
        .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }
  }

  // Post-query sort for google_rating (stored in JSONB, can't sort at query level)
  if (filters.sort === "google_rating_desc") {
    filteredPlaces.sort((a: any, b: any) => {
      const ra = a.google_data?.rating ?? 0;
      const rb = b.google_data?.rating ?? 0;
      return rb - ra;
    });
  }

  // Transform PostGIS geography to {lat, lng}
  const transformed = filteredPlaces.map((place) => ({
    ...place,
    location: place.location
      ? parsePostgisPoint(place.location)
      : { lat: 0, lng: 0 },
  }));

  return { places: transformed, sqlRows };
}
