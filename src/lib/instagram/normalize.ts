/**
 * Turkish-aware comparison helpers for matching an Instagram venue to a Google
 * place: names, phone numbers, websites, street addresses and distances.
 */

const TR_MAP: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** Lower-case (Turkish rules), strip diacritics and punctuation → "a b c". */
export function fold(s: string | null | undefined): string {
  let t = (s ?? "").toLocaleLowerCase("tr");
  t = t.replace(/[ışğüöçâîû]/g, (c) => TR_MAP[c] ?? c);
  t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/&/g, " and ").replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return t;
}

/** Words that say what kind of place it is, not which one. */
const GENERIC = new Set([
  "the", "and", "ve", "by", "de", "da", "la", "le", "les", "el", "il", "di", "of", "at", "in",
  "cafe", "caffe", "kafe", "coffee", "kahve", "kahvesi", "kahveci", "roastery", "roasters", "roaster", "co",
  "company", "coffeeshop", "espresso", "restaurant", "restaurants", "restoran", "restorant", "resto",
  "lokanta", "lokantasi", "bistro", "brasserie", "trattoria", "osteria", "pizzeria", "bar", "pub",
  "meyhane", "meyhanesi", "kitchen", "mutfak", "mutfagi", "eatery", "grill", "house", "evi",
  "bakery", "firin", "firini", "patisserie", "pastane", "pastanesi", "tatlici", "hotel", "otel",
  "hostel", "suites", "residence", "istanbul", "ist", "turkiye", "turkey", "tr", "official", "resmi",
  "shop", "store", "magaza", "concept", "space", "studio", "club", "lounge", "garden", "bahce",
  "london", "paris", "roma", "rome", "nyc", "izmir", "ankara", "bodrum",
]);

function coreTokens(folded: string): string[] {
  const all = folded.split(" ").filter(Boolean);
  const core = all.filter((x) => !GENERIC.has(x));
  return core.length ? core : all;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function tokensEqual(x: string, y: string): boolean {
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  if (Math.min(x.length, y.length) >= 5) return 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.84;
  return false;
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let m = 0;
  for (const x of a) {
    const j = b.findIndex((y, i) => !used.has(i) && tokensEqual(x, y));
    if (j >= 0) {
      used.add(j);
      m++;
    }
  }
  return (m / Math.min(a.length, b.length)) * Math.pow(m / Math.max(a.length, b.length), 0.25);
}

/** 0..1 similarity of two venue names ("Walter's Coffee" ≈ "walterscoffee"). */
export function nameScore(a: string | null | undefined, b: string | null | undefined): number {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  const ca = fa.replace(/ /g, "");
  const cb = fb.replace(/ /g, "");
  let concat = 0;
  if (ca === cb) concat = 1;
  else if (Math.min(ca.length, cb.length) >= 5 && (ca.includes(cb) || cb.includes(ca))) concat = 0.9;
  const ta = coreTokens(fa);
  const tb = coreTokens(fb);
  const tok = overlap(ta, tb);
  const cca = ta.join("");
  const ccb = tb.join("");
  let coreConcat = 0;
  if (cca && cca === ccb) coreConcat = 1;
  else if (Math.min(cca.length, ccb.length) >= 4 && (cca.includes(ccb) || ccb.includes(cca))) coreConcat = 0.85;
  return Math.max(concat, tok, coreConcat);
}

/** "Fuga Coffee | Artisan Coffee 🌿" → "Fuga Coffee". */
export function cleanName(n: string | null | undefined): string {
  let s = (n ?? "").replace(/[\uD800-\uDFFF☀-➿️‍]/g, " ");
  const parts = s.split(/\s+[|•·–—-]\s+|\s*\|\s*/);
  if (parts[0] && parts[0].trim().length >= 3) s = parts[0];
  return s.replace(/\s+/g, " ").trim();
}

/** "walters.coffee_" → "walters coffee". */
export function deslug(username: string): string {
  return username.replace(/[._]+/g, " ").trim();
}

/** Last 9 digits — enough to compare "+90 544 948 80 88" with "05449488088". */
export function phoneKey(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-9) : null;
}

/** Link-in-bio hubs and social sites say nothing about which venue a site belongs to. */
const LINK_HUBS = [
  "instagram.com", "linktr.ee", "linkin.bio", "beacons.ai", "bio.link", "facebook.com", "fb.com", "wa.me",
  "whatsapp.com", "taplink.cc", "lnk.bio", "msha.ke", "bit.ly", "goo.gl", "google.com", "g.page",
  "linkr.bio", "tr.ee", "solo.to", "carrd.co", "direct.me", "flow.page", "hoo.be", "snipfeed.co",
  "allmylinks.com", "about.me", "youtube.com", "tiktok.com", "x.com", "twitter.com", "t.me",
  "threads.net", "threads.com", "yemeksepeti.com", "getir.com", "trendyol.com", "linkfly.to", "linkpop.com",
];

export function domainOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.startsWith("http") ? u : `http://${u}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isHub(d: string): boolean {
  return LINK_HUBS.some((h) => d === h || d.endsWith(`.${h}`));
}

function registrableDomain(d: string): string {
  const labels = d.split(".");
  const secondLevel = ["com", "co", "org", "net", "gov", "edu", "gen", "web", "biz", "info", "av", "bel"];
  if (labels.length >= 3 && secondLevel.includes(labels[labels.length - 2]) && labels[labels.length - 1].length === 2)
    return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Same website (registrable domain), ignoring link hubs. */
export function siteMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = domainOf(a);
  const db = domainOf(b);
  if (!da || !db || isHub(da) || isHub(db)) return false;
  return registrableDomain(da) === registrableDomain(db);
}

/** "https://instagram.com/naga_putrika/" → "naga_putrika". */
export function igHandleFromUrl(u: string | null | undefined): string | null {
  const d = domainOf(u);
  if (!d || !(d === "instagram.com" || d.endsWith(".instagram.com"))) return null;
  try {
    const seg = new URL(u!.startsWith("http") ? u! : `http://${u}`).pathname.split("/").filter(Boolean)[0];
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

const ADDRESS_GENERIC = new Set([
  "mah", "mahallesi", "mh", "cad", "caddesi", "cd", "cadde", "sk", "sok", "sokak", "sokagi", "no", "kat", "daire",
  "blok", "apt", "apartmani", "merkezi", "street", "road", "avenue", "lane", "square", "place", "turkiye",
  "turkey", "istanbul", "bulvari", "bulvar", "yolu", "meydani", "pasaji", "hani", "kadikoy", "beyoglu",
  "besiktas", "sisli", "uskudar", "fatih", "sariyer", "united", "kingdom", "france", "italy", "spain",
]);

/** Same house number AND a shared street word — "Moda Cad. No:161/A" vs "Moda Cd. 161/A". */
export function addressMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const tokens = fold(a).split(" ").filter(Boolean);
  const hay = ` ${fold(b)} `;
  const numbers = tokens.filter((t) => /^\d{1,4}$/.test(t));
  const words = tokens.filter((t) => !/^\d+$/.test(t) && t.length >= 4 && !ADDRESS_GENERIC.has(t));
  return numbers.some((n) => hay.includes(` ${n} `)) && words.some((w) => hay.includes(` ${w} `));
}

/** Metres between two coordinates. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function isCoord(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return typeof lat === "number" && typeof lng === "number" && !(lat === 0 && lng === 0);
}
