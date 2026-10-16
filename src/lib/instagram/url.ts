/**
 * Instagram post URLs — recognised on the client (Add Place dialog) and the
 * server (import route), so this module stays free of server-only imports.
 */

export interface InstagramPostRef {
  shortcode: string;
  /** Canonical form HikerAPI expects and the note stores — no tracking params. */
  canonicalUrl: string;
}

const POST_RE =
  /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;

/** First Instagram post/reel URL in `input` (the share sheet sometimes adds text around it). */
export function parseInstagramPostUrl(input: string | null | undefined): InstagramPostRef | null {
  if (!input) return null;
  for (const token of input.trim().split(/\s+/)) {
    const m = token.match(POST_RE);
    if (m) return { shortcode: m[1], canonicalUrl: `https://www.instagram.com/p/${m[1]}/` };
  }
  return null;
}

export function isInstagramPostUrl(input: string | null | undefined): boolean {
  return parseInstagramPostUrl(input) !== null;
}
