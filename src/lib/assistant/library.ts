import "server-only";
import type { UserContext } from "@/lib/db/context";
import { haversineDistance, parsePostgisPoint } from "@/lib/geo";
import { openStatus, type Timetable } from "@/lib/places/open-now";
import { fold } from "@/lib/text/fold";

/**
 * Data access shared by the assistant tools (src/lib/assistant/tools).
 *
 * Every query here is scoped twice: by the caller's Supabase client (a
 * user token, so RLS applies) and by an explicit `user_id` filter.
 *
 * Rows are a LIGHT projection: `google_data` averages ~69 KB per place
 * (55 KB of it stored reviews), so `select("*")` over a library of ~300
 * places moves ~20 MB. Only the JSON paths a tool needs are selected.
 */

/** Who the tool runs for — see src/lib/db/context.ts. The MCP server passes
 *  a client carrying the user's access token, so RLS applies. */
export type AssistantContext = UserContext;

/** A problem with the caller's input; its message goes back to the model. */
export class ToolInputError extends Error {}

// ── Library rows ────────────────────────────────────────────────────

export interface LibraryRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  address: string | null;
  location: unknown;
  visit_status: string | null;
  rating: number | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  category: { name: string } | null;
  subcategory: { name: string } | null;
  g_rating: number | null;
  g_count: number | null;
  g_price: string | number | null;
  g_status: string | null;
  g_url: string | null;
  g_tz: string | null;
  g_timetable: Timetable | null;
  g_tldr: string | null;
  g_summary?: string | null;
}

const ROW_SELECT = [
  "id,name,city,country,address,location,visit_status,rating,notes,source,created_at",
  "category:categories(name),subcategory:subcategories(name)",
  "g_rating:google_data->rating,g_count:google_data->user_ratings_total",
  "g_price:google_data->price_level,g_status:google_data->>current_status",
  "g_url:google_data->>url,g_tz:google_data->>tz,g_timetable:google_data->work_timetable",
  "g_tldr:google_data->place_profile->>tldr",
].join(",");

/** All of the user's places, light projection. `withSummary` adds the
 *  ~1.5 KB review-derived summary keyword search needs. */
export async function loadLibrary(
  ctx: AssistantContext,
  opts: { withSummary?: boolean } = {}
): Promise<LibraryRow[]> {
  const select = opts.withSummary
    ? `${ROW_SELECT},g_summary:google_data->place_profile->>searchable_summary`
    : ROW_SELECT;
  const { data, error } = await ctx.supabase
    .from("places")
    .select(select)
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LibraryRow[];
}

export function coords(row: { location: unknown }): { lat: number; lng: number } | null {
  if (!row.location) return null;
  const p = parsePostgisPoint(row.location);
  return p.lat === 0 && p.lng === 0 ? null : p;
}

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return Math.round(haversineDistance(a.lat, a.lng, b.lat, b.lng) * 1000);
}

export function priceLevel(v: string | number | null | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

export function closedState(status: string | null | undefined): "permanently" | "temporarily" | null {
  if (status === "closed_forever") return "permanently";
  if (status === "temporarily_closed") return "temporarily";
  return null;
}

// ── Countries ───────────────────────────────────────────────────────

/** Google returned some countries in two languages over time ("Türkiye" and
 *  "Turkey" both appear) — these keys put the spellings back together. */
const COUNTRY_ALIASES: Record<string, string> = {
  turkey: "turkiye",
  uk: "united kingdom",
  "great britain": "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  holland: "netherlands",
  "the netherlands": "netherlands",
  usa: "united states",
  us: "united states",
  "united states of america": "united states",
};

export function countryKey(name: string | null | undefined): string {
  const f = fold(name);
  return COUNTRY_ALIASES[f] ?? f;
}

// ── Taxonomy (categories, sub-categories, tags, lists) ──────────────

export type TaxonomyKind = "category" | "subcategory" | "tag" | "list";

const TAXONOMY_TABLE: Record<TaxonomyKind, string> = {
  category: "categories",
  subcategory: "subcategories",
  tag: "tags",
  list: "lists",
};

export interface NamedRow {
  id: string;
  name: string;
}

export async function loadNames(ctx: AssistantContext, kind: TaxonomyKind): Promise<NamedRow[]> {
  const { data, error } = await ctx.supabase
    .from(TAXONOMY_TABLE[kind])
    .select("id,name")
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as NamedRow[];
}

/** Closest names for an unknown one — shared words first. */
function suggestions(input: string, rows: NamedRow[]): string[] {
  const words = fold(input).split(" ").filter((w) => w.length > 2);
  const scored = rows
    .map((r) => {
      const f = fold(r.name);
      const hits = words.filter((w) => f.includes(w)).length;
      return { name: r.name, hits };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 6).map((r) => r.name);
}

/**
 * Names the model typed → the user's rows. Exact folded match first, then a
 * unique "contains" match. Anything else is a ToolInputError that lists the
 * closest real names, so the model can retry instead of guessing ids.
 */
export function resolveNames(
  kind: TaxonomyKind,
  wanted: string[],
  rows: NamedRow[]
): NamedRow[] {
  const out: NamedRow[] = [];
  for (const name of wanted) {
    const f = fold(name);
    let match = rows.find((r) => fold(r.name) === f);
    if (!match) {
      const partial = rows.filter((r) => fold(r.name).includes(f) || f.includes(fold(r.name)));
      if (partial.length === 1) match = partial[0];
    }
    if (!match) {
      const near = suggestions(name, rows);
      throw new ToolInputError(
        `No ${kind} named "${name}" in the library.` +
          (near.length ? ` Closest: ${near.join(", ")}.` : ` Call get_library_overview for the ${kind} names.`)
      );
    }
    out.push(match);
  }
  return out;
}

/** Place ids carrying a tag, per tag id. */
export async function placesByTag(
  ctx: AssistantContext,
  tagIds: string[]
): Promise<Map<string, Set<string>>> {
  const byTag = new Map<string, Set<string>>(tagIds.map((id) => [id, new Set<string>()]));
  if (tagIds.length === 0) return byTag;
  const { data, error } = await ctx.supabase
    .from("place_tags")
    .select("place_id,tag_id")
    .in("tag_id", tagIds);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) byTag.get(r.tag_id)?.add(r.place_id);
  return byTag;
}

export async function placesInList(ctx: AssistantContext, listId: string): Promise<Set<string>> {
  const { data, error } = await ctx.supabase
    .from("list_places")
    .select("place_id")
    .eq("list_id", listId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.place_id));
}

// ── Time ────────────────────────────────────────────────────────────

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** UTC offset of `tz` at `at`, in minutes — null for an unknown zone. */
function tzOffsetMinutes(tz: string, at: Date): number | null {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name === "GMT") return 0;
    const m = name.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === "-" ? -minutes : minutes;
  } catch {
    return null;
  }
}

/** "2026-11-19T20:00" read as wall-clock time in `tz` → the real instant. */
export function localTimeToInstant(local: string, tz: string): Date | null {
  const m = local.match(LOCAL_DT);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = tzOffsetMinutes(tz, new Date(asUtc));
  if (first === null) return null;
  let ts = asUtc - first * 60_000;
  // Second pass settles the offset when the time is near a DST switch.
  const second = tzOffsetMinutes(tz, new Date(ts));
  if (second !== null && second !== first) ts = asUtc - second * 60_000;
  return new Date(ts);
}

export function isLocalDateTime(s: string): boolean {
  return LOCAL_DT.test(s);
}

/** Open at a place-local wall-clock time; null = unknown (no hours). */
export function openAt(
  row: { g_timetable: Timetable | null; g_tz: string | null },
  local: string
): { open: boolean; closesAt?: string } | null {
  if (!row.g_tz) return null;
  const instant = localTimeToInstant(local, row.g_tz);
  if (!instant) return null;
  const s = openStatus(row.g_timetable ?? undefined, row.g_tz, instant);
  if (!s) return null;
  return {
    open: s.open,
    closesAt: s.closesAt
      ? `${String(s.closesAt.hour).padStart(2, "0")}:${String(s.closesAt.minute).padStart(2, "0")}`
      : undefined,
  };
}

/** Open right now in the place's own time zone; null = unknown. */
export function openNow(row: { g_timetable: Timetable | null; g_tz: string | null }): boolean | null {
  if (!row.g_tz) return null;
  return openStatus(row.g_timetable ?? undefined, row.g_tz)?.open ?? null;
}

type PopularTimes = {
  popular_times_by_days?: Record<string, Array<{ time?: { hour?: number }; popular_index?: number }> | null>;
} | null;

/** Google's "popular times" for the weekday and hour of a local time:
 *  the index (0–100) at that hour and the day's busiest hours. */
export function busyness(
  popular: PopularTimes,
  local: string
): { at_hour: number | null; busiest_hours: string | null } | null {
  const m = local.match(LOCAL_DT);
  const days = popular?.popular_times_by_days;
  if (!m || !days) return null;
  const day = DAY_KEYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  const hours = (days[day] ?? []).filter(
    (h): h is { time: { hour: number }; popular_index: number } =>
      typeof h?.time?.hour === "number" && typeof h.popular_index === "number"
  );
  if (hours.length === 0) return null;
  const hour = Number(m[4]);
  const atHour = hours.find((h) => h.time.hour === hour)?.popular_index ?? null;
  const peak = Math.max(...hours.map((h) => h.popular_index));
  if (peak <= 0) return { at_hour: atHour, busiest_hours: null };
  const busy = hours.filter((h) => h.popular_index >= peak * 0.8).map((h) => h.time.hour);
  const ranges: string[] = [];
  for (const h of busy) {
    const last = ranges[ranges.length - 1];
    const prevEnd = last ? Number(last.split("–")[1].slice(0, 2)) : -1;
    const fmt = (x: number) => `${String(x % 24).padStart(2, "0")}:00`;
    if (last && prevEnd === h) ranges[ranges.length - 1] = `${last.split("–")[0]}–${fmt(h + 1)}`;
    else ranges.push(`${fmt(h)}–${fmt(h + 1)}`);
  }
  return { at_hour: atHour, busiest_hours: ranges.join(", ") };
}

// ── Compact place the model sees ────────────────────────────────────

export interface CompactPlace {
  id: string;
  name: string;
  area?: string;
  country?: string;
  category?: string;
  subcategory?: string;
  google_rating?: number;
  google_reviews?: number;
  price_level?: number;
  status: string;
  my_rating?: number;
  closed?: "permanently" | "temporarily";
  summary?: string;
  maps_url?: string;
}

export function compactPlace(row: LibraryRow): CompactPlace {
  const tldr = row.g_tldr ?? undefined;
  return {
    id: row.id,
    name: row.name,
    area: row.city ?? undefined,
    country: row.country ?? undefined,
    category: row.category?.name ?? undefined,
    subcategory: row.subcategory?.name ?? undefined,
    google_rating: typeof row.g_rating === "number" ? row.g_rating : undefined,
    google_reviews: typeof row.g_count === "number" ? row.g_count : undefined,
    price_level: priceLevel(row.g_price) ?? undefined,
    status: row.visit_status ?? "unknown",
    my_rating: row.rating ?? undefined,
    closed: closedState(row.g_status) ?? undefined,
    summary: tldr && tldr.length > 220 ? `${tldr.slice(0, 217)}…` : tldr,
    maps_url: row.g_url ?? undefined,
  };
}
