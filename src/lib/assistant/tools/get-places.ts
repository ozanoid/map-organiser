import "server-only";
import { z } from "zod";
import {
  ToolInputError,
  busyness,
  clip,
  closedState,
  openAt,
  priceLevel,
} from "@/lib/assistant/library";
import { localDateTime, placeId } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";
import type { UserContext } from "@/lib/db/context";
import type { Timetable } from "@/lib/places/open-now";
import { dayDate, todayAt } from "@/lib/plans/dates";
import { listVisits } from "@/lib/visits/read";

const DETAIL_SELECT = [
  "id,name,city,country,address,visit_status,rating,notes,source,created_at",
  "category:categories(name),subcategory:subcategories(name)",
  "g_rating:google_data->rating,g_count:google_data->user_ratings_total,g_price:google_data->price_level",
  "g_status:google_data->>current_status,g_url:google_data->>url,g_website:google_data->>website",
  "g_phone:google_data->>phone,g_booking:google_data->>book_online_url,g_tz:google_data->>tz",
  "g_timetable:google_data->work_timetable,g_hours:google_data->opening_hours",
  "g_popular:google_data->popular_times,g_profile:google_data->place_profile",
  "g_description:google_data->>business_description,g_similar:google_data->people_also_search",
].join(",");

interface DetailRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  address: string | null;
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
  g_website: string | null;
  g_phone: string | null;
  g_booking: string | null;
  g_tz: string | null;
  g_timetable: Timetable | null;
  g_hours: { weekday_text?: string[] } | null;
  g_popular: Parameters<typeof busyness>[0];
  g_profile: {
    tldr?: string;
    pros?: string[];
    cons?: string[];
    features?: Record<string, unknown>;
    theme_insights?: Array<{
      theme?: string;
      sentiment?: string;
      salience?: number;
      mention_count?: number;
      evidence_quotes?: string[];
    }>;
  } | null;
  g_description: string | null;
  g_similar: Array<{ cid?: string; title?: string; rating?: number; votes_count?: number }> | null;
}

/** Long Google links (reserve, maps) carry kilobytes of tracking query;
 *  the path alone still opens the same page. */
function shortLink(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.length <= 200) return url;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/** Google's "people also search" includes near-empty listings (1 review,
 *  1★ — seen 17.11.2026); only places with a real rating are suggested. */
const SIMILAR_MIN_RATING = 4.0;
const SIMILAR_MIN_REVIEWS = 20;

type Similar = NonNullable<DetailRow["g_similar"]>[number];

function worthSuggesting(s: Similar): s is Similar & { cid: string } {
  return (
    Boolean(s.cid) &&
    (s.rating ?? 0) >= SIMILAR_MIN_RATING &&
    (s.votes_count ?? 0) >= SIMILAR_MIN_REVIEWS
  );
}

const INSTAGRAM_POST = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/;

/** Plans still ahead (or not scheduled yet) that have a planned stop at
 *  these places. "Ahead" is judged by today's date at the place (its time
 *  zone), so tonight's dinner in New York isn't dropped because it is
 *  already tomorrow in UTC. */
async function upcomingPlansOf(
  ctx: UserContext,
  placeIds: string[],
  timeZoneOf: Map<string, string | null>
): Promise<Map<string, Array<{ plan: string; plan_id: string; date?: string }>>> {
  const { data, error } = await ctx.supabase
    .from("plan_stops")
    .select("place_id,status,plan_days!inner(day_number,plans!inner(id,name,start_date,status,user_id))")
    .in("place_id", placeIds)
    .eq("status", "planned")
    .eq("plan_days.plans.user_id", ctx.userId)
    .eq("plan_days.plans.status", "planned");
  if (error) throw new Error(error.message);
  type Row = {
    place_id: string;
    plan_days: { day_number: number; plans: { id: string; name: string; start_date: string | null } };
  };
  const out = new Map<string, Array<{ plan: string; plan_id: string; date?: string }>>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const date = dayDate(r.plan_days.plans.start_date, r.plan_days.day_number);
    if (date && date < todayAt(timeZoneOf.get(r.place_id))) continue; // that day has passed
    const list = out.get(r.place_id) ?? [];
    list.push({ plan: r.plan_days.plans.name, plan_id: r.plan_days.plans.id, date: date ?? undefined });
    out.set(r.place_id, list);
  }
  return out;
}

export const getPlaces = defineTool({
  name: "get_places",
  title: "Get place details",
  description:
    "Full details for 1–5 of the user's saved places by id: the review-derived profile (summary, pros, cons, themes with quotes, what it's good for), weekly opening hours, price, links (Google Maps, website, booking), phone, the user's own status, rating and notes, their last visits (date, rating, what they had), upcoming plans that include the place, tags, lists, the Instagram post it came from, and similar places the user has not saved. Pass `at` (local time at the place) to learn whether it is open then and how busy it usually is. Use it to compare places too.",
  inputSchema: z.object({
    place_ids: z.array(placeId).min(1).max(5),
    at: localDateTime
      .optional()
      .describe("Planned visit, LOCAL time at the place, e.g. '2026-11-19T20:00'"),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, { place_ids, at }) {
    const ids = [...new Set(place_ids)];
    const { data, error } = await ctx.supabase
      .from("places")
      .select(DETAIL_SELECT)
      .eq("user_id", ctx.userId)
      .in("id", ids);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as DetailRow[];
    if (rows.length === 0) throw new ToolInputError("None of those ids is a saved place. Use ids from search_places.");

    const [{ data: tagRows }, { data: listRows }, visits, upcoming] = await Promise.all([
      ctx.supabase.from("place_tags").select("place_id, tags(name)").in("place_id", ids),
      ctx.supabase.from("list_places").select("place_id, lists(name)").in("place_id", ids),
      listVisits(ctx, { placeIds: ids, limit: 200 }),
      upcomingPlansOf(ctx, ids, new Map(rows.map((r) => [r.id, r.g_tz]))),
    ]);
    const visitsOf = new Map<string, typeof visits>();
    for (const v of visits) visitsOf.set(v.place_id, [...(visitsOf.get(v.place_id) ?? []), v]);
    const tagsOf = new Map<string, string[]>();
    for (const r of (tagRows ?? []) as unknown as Array<{ place_id: string; tags: { name: string } | null }>) {
      if (r.tags?.name) tagsOf.set(r.place_id, [...(tagsOf.get(r.place_id) ?? []), r.tags.name]);
    }
    const listsOf = new Map<string, string[]>();
    for (const r of (listRows ?? []) as unknown as Array<{ place_id: string; lists: { name: string } | null }>) {
      if (r.lists?.name) listsOf.set(r.place_id, [...(listsOf.get(r.place_id) ?? []), r.lists.name]);
    }

    // Which "people also search" places are already in the library.
    const similarCids = rows.flatMap((r) => (r.g_similar ?? []).filter(worthSuggesting).slice(0, 8).map((s) => s.cid));
    const savedCids = new Set<string>();
    if (similarCids.length) {
      const { data: saved } = await ctx.supabase
        .from("places")
        .select("cid:google_data->>cid")
        .eq("user_id", ctx.userId)
        .in("google_data->>cid", similarCids);
      for (const s of (saved ?? []) as unknown as Array<{ cid: string | null }>) if (s.cid) savedCids.add(s.cid);
    }

    const places = rows.map((r) => {
      const profile = r.g_profile ?? {};
      const features = profile.features ?? {};
      const themes = [...(profile.theme_insights ?? [])]
        .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
        .slice(0, 6)
        .map((t) => ({
          theme: t.theme,
          sentiment: t.sentiment,
          mentions: t.mention_count,
          quote: clip(t.evidence_quotes?.[0], 220),
        }));
      const instagram = r.notes?.match(INSTAGRAM_POST)?.[0];
      const open = at ? openAt(r, at) : null;
      return {
        id: r.id,
        name: r.name,
        address: r.address ?? undefined,
        area: r.city ?? undefined,
        country: r.country ?? undefined,
        category: r.category?.name ?? undefined,
        subcategory: r.subcategory?.name ?? undefined,
        closed: closedState(r.g_status) ?? undefined,
        google: {
          rating: r.g_rating ?? undefined,
          reviews: r.g_count ?? undefined,
          price_level: priceLevel(r.g_price) ?? undefined,
        },
        links: {
          maps: shortLink(r.g_url),
          website: shortLink(r.g_website),
          booking: shortLink(r.g_booking),
          phone: r.g_phone ?? undefined,
        },
        user: {
          status: r.visit_status ?? "unknown",
          rating: r.rating ?? undefined,
          notes: clip(r.notes, 600),
          saved: r.created_at.slice(0, 10),
          visits: visitsOf.has(r.id)
            ? {
                count: visitsOf.get(r.id)!.length,
                last: visitsOf
                  .get(r.id)!
                  .slice(0, 3)
                  .map((v) => ({
                    visit_id: v.id,
                    date: v.visited_on,
                    rating: v.rating ?? undefined,
                    notes: clip(v.notes, 300),
                  })),
              }
            : undefined,
          upcoming_plans: upcoming.get(r.id),
          source: r.source ?? undefined,
          instagram_post: instagram,
          tags: tagsOf.get(r.id) ?? [],
          lists: listsOf.get(r.id) ?? [],
        },
        hours: r.g_hours?.weekday_text ?? undefined,
        at: at
          ? {
              local_time: at,
              open: open?.open ?? null,
              closes_at: open?.closesAt,
              ...(busyness(r.g_popular, at) ?? {}),
            }
          : undefined,
        profile: {
          summary: profile.tldr,
          pros: profile.pros?.slice(0, 5),
          cons: profile.cons?.slice(0, 5),
          themes,
          good_for: features,
        },
        description: clip(r.g_description, 300),
        similar_not_saved: (r.g_similar ?? [])
          .filter(worthSuggesting)
          .filter((s) => !savedCids.has(s.cid))
          .slice(0, 3)
          .map((s) => ({
            name: s.title,
            google_rating: s.rating,
            google_reviews: s.votes_count,
            maps_url: `https://maps.google.com/?cid=${s.cid}`,
          })),
      };
    });

    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    return { places, unknown_ids: missing.length ? missing : undefined };
  },
});
