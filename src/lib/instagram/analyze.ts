import "server-only";
import {
  getMediaByUrl,
  getMediaUsertags,
  getProfileById,
  getProfileByUsername,
  type IgAccountRef,
  type IgProfile,
} from "@/lib/hikerapi/client";
import { searchPlaceCandidates, type CandidateQuery, type PlaceCandidate } from "@/lib/google/place-candidates";
import { findMapsLink, resolveMapsLink, type MapsLink } from "@/lib/instagram/maps-link";
import { cleanName, deslug, distanceM, fold, isCoord, nameScore } from "@/lib/instagram/normalize";
import { readPost, type AccountRole, type PostReading } from "@/lib/instagram/read-post";
import {
  resolveCandidate,
  type Area,
  type Evidence,
  type Rule,
  type SkipReason,
  type VenueCandidate,
} from "@/lib/instagram/resolve";
import { parseInstagramPostUrl } from "@/lib/instagram/url";

/**
 * Instagram post → the venues it features → their Google places.
 *
 * 1. HikerAPI: the post, the usertags of a reel, and the profile of every
 *    account the post points at — tagged, coauthor, @mentioned, and the owner.
 * 2. Gemini (one call, read-post.ts): which accounts are venues, whether the
 *    post features them, branch/address quotes, plain-text venue names, area.
 *    Every quote is checked against the post text before it is used.
 * 3. Google Text Search + resolve.ts: pick each venue's place on evidence.
 *
 * Writes nothing; the import job (import-job.ts) turns the result into rows.
 */

export type DecisionReason = SkipReason | "not_a_venue" | "not_featured" | "area_tag" | "unverified_name";

export interface VenueDecision {
  kind: VenueCandidate["kind"];
  key: string;
  label: string;
  sources: string[];
  role: AccountRole | null;
  outcome: "add" | "skip";
  reason: DecisionReason | null;
  rule: Rule | null;
  place: PlaceCandidate | null;
  evidence: Evidence | null;
  sameNameCount: number;
  /** Venue name for display and for the manual map search. */
  displayName: string;
  /** Skipped by the resolver: the places it could be, for the user to pick. */
  options: PlaceCandidate[];
  /** Where the post puts the venue (area, profile or location tag), if anywhere. */
  near: { lat: number; lng: number } | null;
}

export interface PostAnalysis {
  post: {
    shortcode: string;
    url: string;
    ownerUsername: string;
    ownerFullName: string | null;
    caption: string;
    locationName: string | null;
  };
  reading: PostReading;
  decisions: VenueDecision[];
}

export class InstagramImportError extends Error {
  code: "invalid_url" | "post_unavailable";
  constructor(code: InstagramImportError["code"]) {
    super(code);
    this.name = "InstagramImportError";
    this.code = code;
  }
}

export interface AnalyzeDeps {
  googleApiKey: string;
  userId: string;
  /** One call per billed request, for usage tracking. */
  onBilled?: (sku: "hikerapi_request" | "text_search_enterprise") => void;
}

type Source = "tagged" | "coauthor" | "mention" | "owner";

interface Account {
  ref: IgAccountRef;
  sources: Source[];
  profile: IgProfile | null;
}

const PROFILE_CONCURRENCY = 5;

function mentionsIn(caption: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[^\w.@])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g;
  for (const m of caption.matchAll(re)) out.add(m[1].toLowerCase());
  return [...out];
}

const QUOTE_STOP = new Set(["the", "and", "ve", "of", "de", "la", "le", "da", "di"]);

/** All meaningful words of `s` occur in the folded text `hay`. */
function quoted(s: string | null | undefined, hay: string, minShare = 1): boolean {
  const tokens = fold(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !QUOTE_STOP.has(t));
  if (!tokens.length) return false;
  const padded = ` ${hay} `;
  const hits = tokens.filter((t) => padded.includes(` ${t} `) || (t.length >= 4 && hay.includes(t))).length;
  return hits / tokens.length >= minShare;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const AREA_RADIUS: [string, number][] = [
  ["neighborhood", 2000],
  ["sublocality_level_2", 2000],
  ["sublocality_level_1", 2500],
  ["sublocality", 2500],
  ["colloquial_area", 2500],
  ["route", 1500],
  ["administrative_area_level_4", 2500],
  ["administrative_area_level_3", 4000],
  ["administrative_area_level_2", 7000],
];

export async function analyzeInstagramPost(url: string, deps: AnalyzeDeps): Promise<PostAnalysis> {
  const ref = parseInstagramPostUrl(url);
  if (!ref) throw new InstagramImportError("invalid_url");

  const billed = (sku: "hikerapi_request" | "text_search_enterprise") => deps.onBilled?.(sku);
  const search = async (q: CandidateQuery): Promise<PlaceCandidate[]> => {
    billed("text_search_enterprise");
    try {
      return await searchPlaceCandidates(q, deps.googleApiKey);
    } catch (e) {
      console.warn(`[instagram] text search "${q.textQuery}" failed, retrying:`, e);
      billed("text_search_enterprise");
      return searchPlaceCandidates(q, deps.googleApiKey);
    }
  };

  // 1. The post and the accounts it points at.
  billed("hikerapi_request");
  const media = await getMediaByUrl(ref.canonicalUrl);
  if (!media) throw new InstagramImportError("post_unavailable");

  const accounts = new Map<string, Account>();
  const add = (a: IgAccountRef, source: Source) => {
    const cur = accounts.get(a.username) ?? { ref: a, sources: [], profile: null };
    if (!cur.sources.includes(source)) cur.sources.push(source);
    if (!cur.ref.pk && a.pk) cur.ref = { ...cur.ref, pk: a.pk };
    if (!cur.ref.fullName && a.fullName) cur.ref = { ...cur.ref, fullName: a.fullName };
    accounts.set(a.username, cur);
  };
  let usertags = media.usertags;
  if (media.mediaType === 2 && usertags.length === 0) {
    billed("hikerapi_request");
    usertags = await getMediaUsertags(media.pk);
  }
  for (const a of usertags) add(a, "tagged");
  for (const a of media.coauthors) add(a, "coauthor");
  for (const username of mentionsIn(media.caption)) add({ pk: null, username, fullName: null }, "mention");
  add(media.owner, "owner");

  await mapLimit([...accounts.values()], PROFILE_CONCURRENCY, async (acct) => {
    // A profile is the venue's phone, address and coordinates — losing one to a
    // transient error silently drops a place, so give each a second chance.
    for (let attempt = 0; attempt < 2 && !acct.profile; attempt++) {
      billed("hikerapi_request");
      try {
        acct.profile = acct.ref.pk
          ? await getProfileById(acct.ref.pk)
          : await getProfileByUsername(acct.ref.username);
        break; // null = no such account (404); retrying won't change that
      } catch (e) {
        console.warn(`[instagram] profile @${acct.ref.username} failed (attempt ${attempt + 1}):`, e);
      }
    }
  });

  // 2. Read the post.
  const loc = media.location;
  const reading = await readPost(
    {
      caption: media.caption,
      locationTag: loc ? { name: loc.name, address: loc.address, city: loc.city } : null,
      owner: { username: media.owner.username, fullName: media.owner.fullName },
      accounts: [...accounts.values()].map((a) => ({
        username: a.ref.username,
        fullName: a.profile?.fullName ?? a.ref.fullName,
        sources: a.sources,
        isBusiness: a.profile?.isBusiness ?? null,
        category: a.profile?.category ?? null,
        city: a.profile?.cityName ?? null,
        address: a.profile?.addressStreet ?? null,
        bio: a.profile?.biography ?? "",
      })),
    },
    { userId: deps.userId, shortcode: ref.shortcode }
  );

  // Text the model may quote from. Bios vouch for names; only the post itself
  // (caption, location tag, usernames) vouches for an area.
  const bios = [...accounts.values()].map(
    (a) => `${a.profile?.biography ?? ""} ${a.profile?.addressStreet ?? ""} ${a.profile?.cityName ?? ""}`
  );
  const postText = fold([media.caption, loc?.name ?? "", loc?.address ?? "", ...bios].join(" \n "));
  const ownText = fold([media.caption, loc?.name ?? "", loc?.address ?? ""].join(" \n "));
  const handles = [...accounts.keys()].map((h) => fold(h).replace(/ /g, ""));
  const inHandles = (s: string) => {
    const compact = fold(s).replace(/ /g, "");
    return compact.length >= 3 && handles.some((h) => h.includes(compact));
  };
  const verified = (s: string | null | undefined): string | null =>
    s && (quoted(s, postText) || inHandles(s)) ? s : null;
  const fromPost = (s: string) => quoted(s, ownText) || inHandles(s);

  const city = verified(reading.area.city);
  const areaCache = new Map<string, Area | null>();
  const areaFor = async (hints: (string | null | undefined)[]): Promise<Area | null> => {
    for (const h of hints) {
      const v = verified(h);
      if (!v) continue;
      if (!areaCache.has(v)) {
        const q = city && fold(city) !== fold(v) ? `${v}, ${city}` : v;
        const top = (await search({ textQuery: q }))[0];
        let area: Area | null = null;
        if (top && !top.types.includes("establishment") && !top.types.includes("point_of_interest")) {
          const radius = AREA_RADIUS.find(([t]) => top.types.includes(t))?.[1];
          if (radius) area = { label: q, lat: top.lat, lng: top.lng, radiusM: radius, fromPost: fromPost(v) };
        }
        areaCache.set(v, area);
      }
      const a = areaCache.get(v);
      if (a) return a;
    }
    return null;
  };

  // 3. Candidates.
  const decisions: VenueDecision[] = [];
  const skip = (
    c: Pick<VenueDecision, "kind" | "key" | "label" | "sources" | "role" | "displayName">,
    reason: DecisionReason
  ) =>
    decisions.push({
      ...c,
      outcome: "skip",
      reason,
      rule: null,
      place: null,
      evidence: null,
      sameNameCount: 0,
      options: [],
      near: null,
    });

  const cands: VenueCandidate[] = [];
  for (const a of accounts.values()) {
    const read = reading.accounts.find((x) => x.username.toLowerCase().replace(/^@/, "") === a.ref.username);
    const role = read?.role ?? null;
    const p = a.profile;
    const display = cleanName(p?.fullName ?? a.ref.fullName) || cleanName(read?.venue_name) || deslug(a.ref.username);
    const base = { kind: "account" as const, key: a.ref.username, label: `@${a.ref.username}`, sources: [...a.sources], role };
    if (role !== "venue" && role !== "venue_brand_multi") {
      // The owner is mostly the blogger who wrote the post; not worth a row.
      if (!(a.sources.length === 1 && a.sources[0] === "owner")) skip({ ...base, displayName: display }, "not_a_venue");
      continue;
    }
    if (read && !read.featured) {
      if (!a.sources.includes("owner")) skip({ ...base, displayName: display }, "not_featured");
      continue;
    }
    let maps: MapsLink | null = null;
    const link = findMapsLink(p?.externalUrl, p?.biography);
    if (link) maps = await resolveMapsLink(link);
    const branchHint = verified(read?.branch_hint);
    cands.push({
      ...base,
      branchHint,
      names: [display, deslug(a.ref.username), ...(read?.venue_name ? [cleanName(read.venue_name)] : [])],
      lat: p?.latitude ?? null,
      lng: p?.longitude ?? null,
      city: p?.cityName ?? null,
      phone: p?.phone ?? null,
      site: p?.externalUrl ?? null,
      handle: a.ref.username,
      addr: p?.addressStreet ?? null,
      postAddr: read?.address_in_post && quoted(read.address_in_post, postText, 0.8) ? read.address_in_post : null,
      tag: null,
      maps,
      area: await areaFor([branchHint, reading.area.neighbourhood, reading.area.district]),
    });
  }

  if (loc && reading.location_tag_is_specific_venue) {
    const twin = cands.find(
      (c) =>
        c.names.some((n) => nameScore(loc.name, n) >= 0.6) ||
        (c.lat != null && c.lng != null && isCoord(loc.lat, loc.lng) && distanceM(c.lat, c.lng, loc.lat!, loc.lng!) <= 150)
    );
    if (twin) {
      twin.tag = { lat: loc.lat, lng: loc.lng };
      twin.sources.push("location_tag");
      twin.names.push(loc.name);
      if (!twin.addr && loc.address) twin.addr = loc.address;
    } else {
      cands.push({
        kind: "location",
        key: loc.pk,
        label: loc.name,
        sources: ["location_tag"],
        role: null,
        branchHint: null,
        names: [loc.name],
        lat: null,
        lng: null,
        city: loc.city,
        phone: loc.phone,
        site: loc.website,
        handle: null,
        addr: loc.address,
        postAddr: null,
        tag: { lat: loc.lat, lng: loc.lng },
        maps: null,
        area: null,
      });
    }
  }

  const caption = fold(media.caption);
  for (const tv of reading.text_venues) {
    const base = { kind: "text" as const, key: tv.name, label: tv.name, sources: ["caption_text"], role: null };
    if (!quoted(tv.name, caption)) {
      skip({ ...base, displayName: tv.name }, "unverified_name");
      continue;
    }
    const postAddr = tv.address && quoted(tv.address, caption, 0.8) ? tv.address : null;
    // The same venue as an account / location candidate: lend it the name and address.
    const host = cands.find((c) => c.names.some((n) => nameScore(n, tv.name) >= 0.7));
    if (host) {
      host.names.push(tv.name);
      if (!host.postAddr && postAddr) host.postAddr = postAddr;
      if (!host.branchHint) host.branchHint = verified(tv.area);
      host.sources.push("caption_text");
      continue;
    }
    if (!tv.featured) {
      skip({ ...base, displayName: tv.name }, "not_featured");
      continue;
    }
    cands.push({
      ...base,
      branchHint: verified(tv.area),
      names: [tv.name],
      lat: null,
      lng: null,
      city: null,
      phone: null,
      site: null,
      handle: null,
      addr: null,
      postAddr,
      tag: null,
      maps: null,
      area: await areaFor([tv.area, reading.area.neighbourhood, reading.area.district]),
    });
  }

  // 4. Resolve; one decision per Google place.
  const seen = new Map<string, VenueDecision>();
  for (const c of cands) {
    const r = await resolveCandidate(c, city, search);
    if (r.place && seen.has(r.place.id)) {
      const first = seen.get(r.place.id)!;
      first.sources = [...new Set([...first.sources, ...c.sources])];
      continue;
    }
    const d: VenueDecision = {
      kind: c.kind,
      key: c.key,
      label: c.label,
      sources: c.sources,
      role: c.role,
      outcome: r.place ? "add" : "skip",
      reason: r.reason,
      rule: r.rule,
      place: r.place,
      evidence: r.evidence,
      sameNameCount: r.sameNameCount,
      displayName: r.place?.name ?? c.names[0],
      options: r.options,
      near: c.area
        ? { lat: c.area.lat, lng: c.area.lng }
        : c.lat != null && c.lng != null
          ? { lat: c.lat, lng: c.lng }
          : c.tag && isCoord(c.tag.lat, c.tag.lng)
            ? { lat: c.tag.lat!, lng: c.tag.lng! }
            : null,
    };
    if (r.place) seen.set(r.place.id, d);
    decisions.push(d);
  }

  return {
    post: {
      shortcode: ref.shortcode,
      url: ref.canonicalUrl,
      ownerUsername: media.owner.username,
      ownerFullName: media.owner.fullName,
      caption: media.caption,
      locationName: loc?.name ?? null,
    },
    reading,
    decisions,
  };
}
