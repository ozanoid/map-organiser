import "server-only";

/**
 * HikerAPI — hosted Instagram data API (https://hikerapi.com).
 *
 * The Instagram import reads a post (location tag, tagged accounts, caption)
 * and the profiles of the accounts it points at through these calls. Every
 * call is one billed request — HikerAPI charges any 2xx/4xx answer, 5xx is
 * free — so callers count them for usage tracking. Responses are parsed from
 * `unknown` into the small shapes below; nothing else of the payload is kept.
 *
 * See docs/04-integrations/hikerapi.md.
 */

const BASE_URL = "https://api.hikerapi.com";
const TIMEOUT_MS = 20_000;
const RETRIES = 2;

export class HikerApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HikerApiError";
    this.status = status;
  }
}

export interface IgAccountRef {
  pk: string | null;
  username: string;
  fullName: string | null;
}

export interface IgLocation {
  pk: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
}

export interface IgMedia {
  pk: string;
  code: string;
  /** 1 photo, 2 video/reel, 8 carousel. */
  mediaType: number;
  caption: string;
  owner: IgAccountRef;
  location: IgLocation | null;
  /** Union of the post's and its carousel slides' usertags. Empty on videos —
   *  see {@link getMediaUsertags}. */
  usertags: IgAccountRef[];
  coauthors: IgAccountRef[];
  takenAt: string | null;
}

export interface IgProfile {
  pk: string;
  username: string;
  fullName: string | null;
  isBusiness: boolean | null;
  category: string | null;
  biography: string;
  externalUrl: string | null;
  phone: string | null;
  addressStreet: string | null;
  cityName: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ---------- parsing helpers ----------

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toAccount(v: unknown): IgAccountRef | null {
  const o = obj(v);
  const username = str(o?.username)?.toLowerCase();
  if (!o || !username) return null;
  return { pk: str(o.pk) ?? str(o.id), username, fullName: str(o.full_name) };
}

function toLocation(v: unknown): IgLocation | null {
  const o = obj(v);
  const pk = str(o?.pk);
  const name = str(o?.name);
  if (!o || !pk || !name) return null;
  return {
    pk,
    name,
    address: str(o.address),
    city: str(o.city),
    lat: num(o.lat),
    lng: num(o.lng),
    phone: str(o.phone),
    website: str(o.website),
  };
}

function toMedia(v: unknown): IgMedia | null {
  const o = obj(v);
  // `id` is "<media pk>_<owner pk>" and always a string; a numeric `pk` above
  // 2^53 would lose digits in JSON.parse.
  const pk = str(o?.id)?.split("_")[0] ?? str(o?.pk);
  const owner = toAccount(o?.user);
  if (!o || !pk || !owner) return null;
  const tags = new Map<string, IgAccountRef>();
  const addTags = (list: unknown) => {
    for (const t of arr(list)) {
      const a = toAccount(obj(t)?.user);
      if (a && !tags.has(a.username)) tags.set(a.username, a);
    }
  };
  addTags(o.usertags);
  for (const r of arr(o.resources)) addTags(obj(r)?.usertags);
  return {
    pk,
    code: str(o.code) ?? "",
    mediaType: num(o.media_type) ?? 0,
    caption: str(o.caption_text) ?? "",
    owner,
    location: toLocation(o.location),
    usertags: [...tags.values()],
    coauthors: arr(o.coauthor_producers)
      .map(toAccount)
      .filter((a): a is IgAccountRef => a !== null),
    takenAt: str(o.taken_at),
  };
}

function toProfile(v: unknown): IgProfile | null {
  const o = obj(v);
  const pk = str(o?.pk);
  const username = str(o?.username)?.toLowerCase();
  if (!o || !pk || !username) return null;
  const lat = num(o.latitude);
  const lng = num(o.longitude);
  const hasCoords = lat !== null && lng !== null && !(lat === 0 && lng === 0);
  const countryCode = str(o.public_phone_country_code);
  const publicPhone = str(o.public_phone_number);
  return {
    pk,
    username,
    fullName: str(o.full_name),
    isBusiness: typeof o.is_business === "boolean" ? o.is_business : null,
    category: str(o.category) ?? str(o.category_name) ?? str(o.business_category_name),
    biography: str(o.biography) ?? "",
    externalUrl: str(o.external_url),
    phone:
      str(o.contact_phone_number) ??
      (publicPhone ? `${countryCode ?? ""}${publicPhone}` : null),
    addressStreet: str(o.address_street),
    cityName: str(o.city_name),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lng : null,
  };
}

// ---------- transport ----------

/** GET with retry on 429/5xx/timeouts. Returns null for 404 (missing post or account). */
async function get(path: string, params: [string, string][]): Promise<unknown | null> {
  const key = process.env.HIKERAPI_KEY;
  if (!key) throw new HikerApiError("HIKERAPI_KEY is not set", 0);
  const url = new URL(BASE_URL + path);
  for (const [k, v] of params) url.searchParams.append(k, v);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      const res = await fetch(url, {
        headers: { "x-access-key": key, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        lastError = new HikerApiError(`HikerAPI ${path} ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new HikerApiError(`HikerAPI ${path} ${res.status}: ${body.slice(0, 160)}`, res.status);
      }
      return (await res.json()) as unknown;
    } catch (e) {
      if (e instanceof HikerApiError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new HikerApiError(`HikerAPI ${path} failed`, 0);
}

// ---------- calls (1 billed request each) ----------

/** Post or reel by its canonical `https://www.instagram.com/p/<code>/` URL. */
export async function getMediaByUrl(canonicalUrl: string): Promise<IgMedia | null> {
  return toMedia(await get("/v1/media/by/url", [["url", canonicalUrl]]));
}

/** Usertags of a video/reel — the v1 media call leaves them out for videos. */
export async function getMediaUsertags(mediaPk: string): Promise<IgAccountRef[]> {
  const body = obj(await get("/gql/media/usertags", [["media_ids", mediaPk]]));
  const list = arr(obj(body?.data)?.["1$multifetch__XDTMediaDict(ids:$media_ids)"]);
  const node = obj(obj(list[0])?.node);
  return arr(obj(node?.usertags)?.in)
    .map((t) => toAccount(obj(t)?.user))
    .filter((a): a is IgAccountRef => a !== null);
}

export async function getProfileById(pk: string): Promise<IgProfile | null> {
  return toProfile(await get("/v1/user/by/id", [["id", pk]]));
}

export async function getProfileByUsername(username: string): Promise<IgProfile | null> {
  return toProfile(await get("/v1/user/by/username", [["username", username]]));
}
