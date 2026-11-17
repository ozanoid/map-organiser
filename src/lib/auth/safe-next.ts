/**
 * A `next` return path is followed only when it stays on this site: a
 * single leading slash, no backslashes or control characters, and still
 * same-origin after URL parsing. Anything else ("//evil.com", "@evil.com",
 * "https://…") is dropped, so login and the OAuth callback can't be used as
 * open redirects.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return null;
  try {
    const base = "http://next.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Cookie that carries `next` across the Google sign-in round trip. */
export const AUTH_NEXT_COOKIE = "auth_next";
