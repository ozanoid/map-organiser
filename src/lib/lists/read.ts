import "server-only";
import type { UserContext } from "@/lib/db/context";
import type { ListDetail, ListItem, ListItemPlace, PlaceList, PlaceListMembership, VisitStatus } from "@/lib/types";

/**
 * Reading lists — shared by the API routes and the assistant tools.
 *
 * Every query is scoped twice: by the caller's Supabase client (a user
 * token, so RLS applies) and by an explicit `user_id` filter, which is what
 * protects callers that use the service role.
 */

const LIST_COLUMNS = "id,user_id,name,description,color,created_via,created_at,updated_at";

const ITEM_PLACE_SELECT = [
  "id,name,city,country,visit_status,rating",
  "category:categories(name,color,icon)",
  "g_url:google_data->>url,g_rating:google_data->rating,g_count:google_data->user_ratings_total",
].join(",");

type ListRow = Omit<PlaceList, "place_count" | "color"> & { color: string | null };

interface ItemPlaceRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  visit_status: VisitStatus | null;
  rating: number | null;
  category: { name: string; color: string; icon: string } | null;
  g_url: string | null;
  g_rating: number | null;
  g_count: number | null;
}

interface ItemRow {
  place_id: string;
  sort_order: number;
  note: string | null;
  added_at: string | null;
  place?: ItemPlaceRow | null;
}

function shapeList(row: ListRow, placeCount?: number): PlaceList {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    color: row.color ?? "#059669",
    created_via: row.created_via ?? "app",
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(placeCount !== undefined ? { place_count: placeCount } : {}),
  };
}

function shapeItemPlace(row: ItemPlaceRow | null | undefined): ListItemPlace | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    visit_status: row.visit_status,
    rating: row.rating,
    category: row.category,
    google_data: { url: row.g_url, rating: row.g_rating, user_ratings_total: row.g_count },
  };
}

/** Every list of the user with its place count, newest first. */
export async function listLists(ctx: UserContext): Promise<PlaceList[]> {
  const { data, error } = await ctx.supabase
    .from("lists")
    .select(`${LIST_COLUMNS},items:list_places(count)`)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = ListRow & { items: { count: number }[] | null };
  return ((data ?? []) as unknown as Row[]).map((row) => shapeList(row, row.items?.[0]?.count ?? 0));
}

/**
 * One list with its places in order, or null when it isn't the user's.
 * `withPlaces` adds a light projection of each place (name, area, category,
 * ratings, Maps link) for readers that don't load places themselves.
 */
export async function getList(
  ctx: UserContext,
  listId: string,
  opts: { withPlaces?: boolean } = {}
): Promise<ListDetail | null> {
  const itemSelect = `place_id,sort_order,note,added_at${opts.withPlaces ? `,place:places(${ITEM_PLACE_SELECT})` : ""}`;
  const { data, error } = await ctx.supabase
    .from("lists")
    .select(`${LIST_COLUMNS},items:list_places(${itemSelect})`)
    .eq("id", listId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as ListRow & { items: ItemRow[] | null };
  const items: ListItem[] = [...(row.items ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      place_id: item.place_id,
      sort_order: item.sort_order,
      note: item.note,
      added_at: item.added_at,
      ...(opts.withPlaces ? { place: shapeItemPlace(item.place) } : {}),
    }));
  return { ...shapeList(row, items.length), items };
}

/** The lists each of these places is on, with the place's note on each. */
export async function listsOfPlaces(
  ctx: UserContext,
  placeIds: string[]
): Promise<Map<string, PlaceListMembership[]>> {
  const out = new Map<string, PlaceListMembership[]>();
  if (placeIds.length === 0) return out;
  const { data, error } = await ctx.supabase
    .from("list_places")
    .select(`place_id,note,sort_order,lists!inner(${LIST_COLUMNS})`)
    .in("place_id", placeIds)
    .eq("lists.user_id", ctx.userId);
  if (error) throw new Error(error.message);
  type Row = { place_id: string; note: string | null; sort_order: number; lists: ListRow };
  for (const row of (data ?? []) as unknown as Row[]) {
    const memberships = out.get(row.place_id) ?? [];
    memberships.push({ ...shapeList(row.lists), note: row.note, sort_order: row.sort_order });
    out.set(row.place_id, memberships);
  }
  for (const memberships of out.values()) memberships.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
