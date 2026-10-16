import "server-only";
import { extractCidFromUrl } from "@/lib/import/process-place";

/**
 * A Google Maps link a venue put in its own Instagram profile (website field
 * or bio) names its exact listing — the strongest evidence there is.
 */

export interface MapsLink {
  cid: string | null;
  placeId: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

const LINK_RE =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)[^\s"'<>)]*/gi;

export function findMapsLink(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = (t ?? "").match(LINK_RE);
    if (m) return m[0];
  }
  return null;
}

/**
 * Follow a (short) Maps link to the place URL and read its CID, place id,
 * name and coordinates. A browser User-Agent gets an HTML/JS interstitial
 * from maps.app.goo.gl; the default fetch UA gets the real redirect chain.
 */
export async function resolveMapsLink(link: string): Promise<MapsLink | null> {
  let finalUrl = link;
  try {
    const res = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    finalUrl = res.url || link;
    if (finalUrl.includes("consent.google.")) {
      finalUrl = new URL(finalUrl).searchParams.get("continue") ?? finalUrl;
    }
  } catch {
    return null;
  }
  const coords =
    finalUrl.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/) ?? finalUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  const nameMatch = finalUrl.match(/\/maps\/place\/([^/@?]+)/);
  let name: string | null = null;
  if (nameMatch) {
    try {
      name = decodeURIComponent(nameMatch[1].replace(/\+/g, " "));
    } catch {
      name = nameMatch[1];
    }
  }
  return {
    cid: extractCidFromUrl(finalUrl),
    placeId: finalUrl.match(/!1s(ChIJ[\w-]+)/)?.[1] ?? null,
    name,
    lat: coords ? Number(coords[1]) : null,
    lng: coords ? Number(coords[2]) : null,
  };
}
