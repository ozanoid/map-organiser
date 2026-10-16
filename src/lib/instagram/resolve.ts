import type { CandidateQuery, PlaceCandidate } from "@/lib/google/place-candidates";
import type { MapsLink } from "@/lib/instagram/maps-link";
import type { AccountRole } from "@/lib/instagram/read-post";
import {
  addressMatch,
  distanceM,
  fold,
  igHandleFromUrl,
  isCoord,
  nameScore,
  phoneKey,
  siteMatch,
} from "@/lib/instagram/normalize";

/**
 * Pick the Google place for one venue candidate — deterministically.
 *
 * A place is added only on evidence that ties it to the venue the post
 * points at: the same phone or website, the venue's own Maps link, its
 * street address, or a location within metres. A brand with several
 * branches needs evidence for the exact branch. When nothing clears the bar
 * the venue is skipped with a reason rather than guessed: a wrong place on
 * the map costs more than a missing one.
 *
 * Measured on 35 labelled posts (2026-10-16): 0 wrong places across three
 * independent LLM samples; see scripts/instagram-eval.
 */

export interface Area {
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Written in the caption, the location tag or a username — not only a bio.
   *  Bios name a brand's home branch, so only these may vouch for a venue. */
  fromPost: boolean;
}

export interface VenueCandidate {
  kind: "account" | "location" | "text";
  key: string;
  label: string;
  sources: string[];
  role: AccountRole | null;
  branchHint: string | null;
  /** Reference names, most specific display name first. */
  names: string[];
  lat: number | null;
  lng: number | null;
  city: string | null;
  phone: string | null;
  site: string | null;
  handle: string | null;
  /** Address from the venue's own profile or the location tag. */
  addr: string | null;
  /** Address quoted from the post itself (verified against the text). */
  postAddr: string | null;
  tag: { lat: number | null; lng: number | null } | null;
  maps: MapsLink | null;
  area: Area | null;
}

export interface Evidence {
  phone: boolean;
  web: boolean;
  handle: boolean;
  maps: boolean;
  addr: boolean;
  postAddr: boolean;
  hint: boolean;
  distM: number | null;
  distTagM: number | null;
  inArea: boolean;
  name: number;
  closed: boolean;
}

export type Rule = "evidence" | "near" | "unique_in_area" | "location_tag" | "post_address";
export type SkipReason = "no_evidence" | "ambiguous" | "chain_branch_unknown" | "closed";

export interface Resolution {
  place: PlaceCandidate | null;
  rule: Rule | null;
  evidence: Evidence | null;
  reason: SkipReason | null;
  /** Same-name places seen — shown as "N branches" when the branch is unknown. */
  sameNameCount: number;
  /** No place picked: the places it could be, for the user to choose from. */
  options: PlaceCandidate[];
  queries: string[];
}

const MAX_OPTIONS = 20;

const HINT_STOP = new Set([
  "the", "and", "ve", "of", "de", "la", "le", "da", "di", "via", "rue", "street", "st", "cad", "caddesi", "cd",
  "sk", "sok", "sokak", "no", "istanbul", "london", "paris", "roma", "rome", "ankara", "izmir", "subesi",
  "sube", "branch",
]);

function hintMatch(hint: string | null, address: string): boolean {
  if (!hint) return false;
  const tokens = fold(hint)
    .split(" ")
    .filter((t) => t.length >= 4 && !HINT_STOP.has(t));
  if (!tokens.length) return false;
  const a = ` ${fold(address)} `;
  return tokens.every((t) => a.includes(` ${t} `) || a.includes(t));
}

function evidenceFor(c: VenueCandidate, g: PlaceCandidate): Evidence {
  const pk = phoneKey(c.phone);
  const areaM = c.area ? distanceM(c.area.lat, c.area.lng, g.lat, g.lng) : null;
  return {
    phone: !!pk && pk === phoneKey(g.phone),
    web: siteMatch(c.site, g.website),
    handle: !!c.handle && igHandleFromUrl(g.website) === c.handle,
    maps: !!c.maps && ((!!c.maps.cid && c.maps.cid === g.cid) || (!!c.maps.placeId && c.maps.placeId === g.id)),
    addr: addressMatch(c.addr, g.address),
    postAddr: addressMatch(c.postAddr, g.address),
    hint: hintMatch(c.branchHint, g.address),
    distM: c.lat != null && c.lng != null ? distanceM(c.lat, c.lng, g.lat, g.lng) : null,
    distTagM: c.tag && isCoord(c.tag.lat, c.tag.lng) ? distanceM(c.tag.lat!, c.tag.lng!, g.lat, g.lng) : null,
    inArea: areaM !== null && c.area !== null && areaM <= c.area.radiusM,
    name: Math.max(0, ...c.names.map((n) => nameScore(n, g.name))),
    closed: g.status === "CLOSED_PERMANENTLY",
  };
}

/** Names the exact spot. */
const pinEv = (e: Evidence) => e.maps || e.addr || e.postAddr || e.hint;
const locEv = (e: Evidence) =>
  pinEv(e) || (e.distM !== null && e.distM <= 100) || (e.distTagM !== null && e.distTagM <= 120);
/** Identifies the business — but every branch of a chain shares it. */
const idEv = (e: Evidence) => e.phone || e.web || e.handle || e.maps;

type Scored = { g: PlaceCandidate; ev: Evidence };

function distinctive(c: VenueCandidate): boolean {
  return c.names.some((n) => fold(n).replace(/ /g, "").length >= 5);
}

/** Same-name places elsewhere — other branches, not duplicate listings or sub-venues of one building. */
function twinsOf(pick: Scored, scored: Scored[]): Scored[] {
  return scored.filter(
    (s) =>
      s.g.id !== pick.g.id &&
      s.ev.name >= 0.85 &&
      distanceM(s.g.lat, s.g.lng, pick.g.lat, pick.g.lng) > 150 &&
      !addressMatch(s.g.address, pick.g.address)
  );
}

function accepts(c: VenueCandidate, s: Scored, scored: Scored[]): Rule | null {
  const e = s.ev;
  const uniqueInArea =
    !!c.area?.fromPost && e.name >= 0.9 && e.inArea && distinctive(c) && twinsOf(s, scored).length === 0;
  if (c.kind === "account") {
    const multi = c.role === "venue_brand_multi";
    if (e.name >= 0.5 && (multi ? locEv(e) : idEv(e) || locEv(e))) return "evidence";
    if (e.name >= 0.85 && ((e.distM ?? Infinity) <= 300 || (e.distTagM ?? Infinity) <= 300)) return "near";
    // A brand known to run several locations never gets the "only one in town" shortcut.
    if (!multi && uniqueInArea) return "unique_in_area";
    return null;
  }
  if (c.kind === "location") {
    return e.name >= 0.6 && ((e.distTagM ?? Infinity) <= 150 || e.addr || e.postAddr) ? "location_tag" : null;
  }
  if (e.name >= 0.6 && e.postAddr) return "post_address";
  return uniqueInArea ? "unique_in_area" : null;
}

function decide(c: VenueCandidate, scored: Scored[]): Pick<Resolution, "place" | "rule" | "evidence" | "reason"> {
  const accepted = scored
    .map((s) => ({ s, rule: accepts(c, s, scored) }))
    .filter((x): x is { s: Scored; rule: Rule } => x.rule !== null);
  if (!accepted.length) {
    return {
      place: null,
      rule: null,
      evidence: null,
      reason: c.role === "venue_brand_multi" ? "chain_branch_unknown" : "no_evidence",
    };
  }
  let chosen = accepted;
  if (chosen.length > 1) {
    const pins = chosen.filter((x) => pinEv(x.s.ev));
    if (pins.length) chosen = pins;
  }
  if (chosen.length > 1) {
    const located = chosen.filter((x) => locEv(x.s.ev));
    if (located.length) chosen = located;
  }
  if (chosen.length > 1) {
    // Duplicate Google listings of one place: same name within 60 m → the canonical one.
    const top = [...chosen].sort((a, b) => b.s.g.ratingCount - a.s.g.ratingCount);
    const duplicates = top.every(
      (x) => x.s.ev.name >= 0.95 && distanceM(x.s.g.lat, x.s.g.lng, top[0].s.g.lat, top[0].s.g.lng) <= 60
    );
    if (duplicates && top[0].s.g.ratingCount >= 3 * Math.max(1, top[1].s.g.ratingCount)) chosen = [top[0]];
  }
  if (chosen.length > 1) {
    // Sub-venues of one building (a hotel and its spa): the best-named one is the venue.
    const byName = [...chosen].sort((a, b) => b.s.ev.name - a.s.ev.name);
    const sameSpot = byName.every(
      (x) =>
        distanceM(x.s.g.lat, x.s.g.lng, byName[0].s.g.lat, byName[0].s.g.lng) <= 150 ||
        addressMatch(x.s.g.address, byName[0].s.g.address)
    );
    if (sameSpot && byName[0].s.ev.name - byName[1].s.ev.name >= 0.095) chosen = [byName[0]];
  }
  if (chosen.length > 1) {
    return {
      place: null,
      rule: null,
      evidence: null,
      reason: c.role === "venue_brand_multi" ? "chain_branch_unknown" : "ambiguous",
    };
  }
  const { s: pick, rule } = chosen[0];
  if (c.kind === "account" && !locEv(pick.ev) && twinsOf(pick, scored).length) {
    return { place: null, rule: null, evidence: null, reason: "chain_branch_unknown" };
  }
  if (pick.ev.closed) return { place: null, rule: null, evidence: pick.ev, reason: "closed" };
  return { place: pick.g, rule, evidence: pick.ev, reason: null };
}

/**
 * What a skipped venue could be: places named like it, or sharing its phone,
 * website or Instagram handle. When nothing does — a library service whose
 * branches each have their own name — what Google returned for the venue's
 * name itself; never what an address search returned (a brand's profile
 * address is usually its head office). Nearest to where the post puts the
 * venue first; Google's order otherwise.
 */
function optionsFor(c: VenueCandidate, pool: PlaceCandidate[], foundByName: Set<string>): PlaceCandidate[] {
  const center = c.area ?? (c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null);
  const places = pool
    .filter(
      (g) =>
        !!g.cid &&
        g.status !== "CLOSED_PERMANENTLY" &&
        (g.types.includes("establishment") || g.types.includes("point_of_interest"))
    )
    .map((g) => ({ g, ev: evidenceFor(c, g) }));
  const named = places.filter(({ ev }) => ev.name >= 0.6 || idEv(ev));
  const options = named.length ? named : places.filter(({ g }) => foundByName.has(g.id));
  if (center) {
    const d = (g: PlaceCandidate) => distanceM(center.lat, center.lng, g.lat, g.lng);
    options.sort((a, b) => d(a.g) - d(b.g));
  }
  return options.slice(0, MAX_OPTIONS).map((o) => o.g);
}

function queriesFor(c: VenueCandidate, city: string | null): CandidateQuery[] {
  const q: CandidateQuery[] = [];
  const name = c.names[0];
  const where = c.city ?? city;
  if (c.maps?.name && c.maps.lat != null && c.maps.lng != null)
    q.push({ textQuery: c.maps.name, biasLat: c.maps.lat, biasLng: c.maps.lng, radiusM: 200 });
  if (c.kind === "location") {
    if (c.tag && isCoord(c.tag.lat, c.tag.lng))
      q.push({ textQuery: name, biasLat: c.tag.lat!, biasLng: c.tag.lng!, radiusM: 300 });
    else q.push({ textQuery: [name, c.addr].filter(Boolean).join(" ") });
    return q;
  }
  if (c.postAddr) q.push({ textQuery: `${name} ${c.postAddr} ${city ?? ""}`.trim() });
  if (c.lat != null && c.lng != null) q.push({ textQuery: name, biasLat: c.lat, biasLng: c.lng, radiusM: 1000 });
  else if (c.tag && isCoord(c.tag.lat, c.tag.lng))
    q.push({ textQuery: name, biasLat: c.tag.lat!, biasLng: c.tag.lng!, radiusM: 500 });
  else if (c.area) q.push({ textQuery: name, biasLat: c.area.lat, biasLng: c.area.lng, radiusM: c.area.radiusM });
  else q.push({ textQuery: [name, c.branchHint, where].filter(Boolean).join(" ") });
  if (c.addr) q.push({ textQuery: `${name} ${c.addr}` });
  if (c.branchHint && !c.postAddr) q.push({ textQuery: `${name} ${c.branchHint}` });
  // City-wide: surfaces other branches and same-name places for the uniqueness checks.
  if (where) q.push({ textQuery: `${name} ${where}`, pageSize: 20 });
  for (const alt of c.names.slice(1)) {
    if (fold(alt) !== fold(name)) q.push({ textQuery: [alt, c.branchHint ?? where].filter(Boolean).join(" ") });
  }
  return q;
}

export async function resolveCandidate(
  c: VenueCandidate,
  city: string | null,
  search: (q: CandidateQuery) => Promise<PlaceCandidate[]>
): Promise<Resolution> {
  const pool = new Map<string, PlaceCandidate>();
  const foundByName = new Set<string>();
  const byAddress = (q: CandidateQuery) =>
    (!!c.addr && q.textQuery.includes(c.addr)) || (!!c.postAddr && q.textQuery.includes(c.postAddr));
  const tried: string[] = [];
  let last: Pick<Resolution, "place" | "rule" | "evidence" | "reason"> = {
    place: null,
    rule: null,
    evidence: null,
    reason: "no_evidence",
  };
  const qs = queriesFor(c, city);
  for (let i = 0; i < qs.length; i++) {
    tried.push(qs[i].textQuery);
    for (const g of await search(qs[i])) {
      pool.set(g.id, g);
      if (!byAddress(qs[i])) foundByName.add(g.id);
    }
    const scored = [...pool.values()].map((g) => ({ g, ev: evidenceFor(c, g) }));
    last = decide(c, scored);
    // The uniqueness rule must see the city-wide query before it may decide.
    const needsMore = last.rule === "unique_in_area" && i < qs.length - 1;
    if (last.place && !needsMore) break;
  }
  const sameNameCount = [...pool.values()].filter(
    (g) => Math.max(0, ...c.names.map((n) => nameScore(n, g.name))) >= 0.85
  ).length;
  const options = last.place ? [] : optionsFor(c, [...pool.values()], foundByName);
  return { ...last, sameNameCount, options, queries: tried };
}
