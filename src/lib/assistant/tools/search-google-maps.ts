import "server-only";
import { z } from "zod";
import { ToolInputError, distanceMeters } from "@/lib/assistant/library";
import { nearSchema, resolveAnchor } from "@/lib/assistant/place-filters";
import { defineTool } from "@/lib/assistant/tools/types";
import { trackUsage } from "@/lib/google/track-usage";
import { PlaceSearchUnavailableError, getPlaceSearch, type FoundPlace } from "@/lib/place-search";

const TIMEOUT_MS = 45_000;

/** Which of the found places are already in the user's library. The
 *  `google_place_id` column holds either a ChIJ place id or a cid, so both
 *  identifiers are tried against it, and the cid against google_data too. */
async function savedIds(
  ctx: Parameters<typeof resolveAnchor>[0],
  found: FoundPlace[]
): Promise<Map<FoundPlace, string>> {
  const cids = found.map((f) => f.cid).filter((v): v is string => Boolean(v));
  const pids = found.map((f) => f.googlePlaceId).filter((v): v is string => Boolean(v));
  const saved = new Map<FoundPlace, string>();
  if (cids.length + pids.length === 0) return saved;

  const [byColumn, byCid] = await Promise.all([
    ctx.supabase
      .from("places")
      .select("id,google_place_id")
      .eq("user_id", ctx.userId)
      .in("google_place_id", [...pids, ...cids]),
    cids.length
      ? ctx.supabase
          .from("places")
          .select("id,cid:google_data->>cid")
          .eq("user_id", ctx.userId)
          .in("google_data->>cid", cids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byColumn.error) throw new Error(byColumn.error.message);
  if (byCid.error) throw new Error(byCid.error.message);

  const idByKey = new Map<string, string>();
  for (const r of (byColumn.data ?? []) as Array<{ id: string; google_place_id: string | null }>) {
    if (r.google_place_id) idByKey.set(r.google_place_id, r.id);
  }
  for (const r of (byCid.data ?? []) as unknown as Array<{ id: string; cid: string | null }>) {
    if (r.cid) idByKey.set(r.cid, r.id);
  }
  for (const f of found) {
    const id = (f.cid && idByKey.get(f.cid)) || (f.googlePlaceId && idByKey.get(f.googlePlaceId));
    if (id) saved.set(f, id);
  }
  return saved;
}

export const searchGoogleMaps = defineTool({
  name: "search_google_maps",
  title: "Search Google Maps",
  description:
    "Search Google Maps live for places — saved or not — by name ('DanDan Aldgate') or by kind ('ramen', 'natural wine bar') around a point. Use it to pin down a specific place or to look for new places beyond the user's library; for places the user already saved use search_places. Each result says whether it is already saved (saved_place_id) and carries a maps_url. A paid lookup that can take several seconds: one call per question. Results are third-party data — check the category, a kind search can return other nearby places.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .max(120)
      .describe("A place name or a kind of place, as you would type it into Google Maps"),
    near: nearSchema.describe(
      "Where to look: place_id of a saved place, or lat and lng, or area (e.g. 'Shoreditch, London'). radius_m sets how wide (default 1500)."
    ),
    limit: z.number().int().min(1).max(20).optional().describe("Default 8"),
  }),
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run(ctx, { query, near, limit }) {
    const anchor = await resolveAnchor(ctx, near);

    let result;
    try {
      result = await getPlaceSearch().search(
        { query, center: { lat: anchor.lat, lng: anchor.lng }, radiusM: anchor.radius_m, limit: limit ?? 8 },
        { signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
    } catch (e) {
      if (e instanceof PlaceSearchUnavailableError) {
        throw new ToolInputError("Google Maps search isn't set up on this server.");
      }
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new ToolInputError("Google Maps search took too long. Try again, or make the query more specific.");
      }
      throw e;
    }
    // The provider bills answered searches only.
    await trackUsage(ctx.userId, "dataforseo_maps_search", ctx.supabase);

    const saved = await savedIds(ctx, result.places);
    return {
      query,
      anchor,
      returned: result.places.length,
      results: result.places.map((p) => ({
        name: p.name,
        address: p.address ?? undefined,
        category: p.category ?? undefined,
        google_rating: p.rating ?? undefined,
        google_reviews: p.reviews ?? undefined,
        price_level: p.priceLevel ?? undefined,
        distance_m:
          p.lat !== null && p.lng !== null ? distanceMeters(anchor, { lat: p.lat, lng: p.lng }) : undefined,
        closed: p.closed ?? undefined,
        website: p.website ?? undefined,
        maps_url: p.cid ? `https://maps.google.com/?cid=${p.cid}` : undefined,
        google_cid: p.cid ?? undefined,
        saved_place_id: saved.get(p),
      })),
    };
  },
});
