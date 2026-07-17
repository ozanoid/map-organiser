/**
 * Build a Google Maps link that opens the exact place on BOTH desktop
 * web AND the mobile Google Maps app.
 *
 * Why not use the stored `google_data.url`? Two fragile formats live in
 * our data:
 *   - Places API:  https://www.google.com/maps/place/?q=place_id:ChIJ…
 *   - DataForSEO:  https://maps.google.com/?cid=…&g_mp=…
 * Both resolve fine in a desktop browser, but on mobile the Maps app's
 * universal-link handler opens the app and then FAILS to resolve
 * `q=place_id:` / a raw `cid` with Google's internal `g_mp` blob — the
 * user lands on a blank app (the reported bug).
 *
 * The fix is Google's official, documented Maps URLs API (`api=1`),
 * which is the cross-platform intent format the Maps app understands:
 *   https://www.google.com/maps/search/?api=1&query=<text>&query_place_id=<place_id>
 * `query` is required (human-readable fallback); `query_place_id` pins
 * the exact place. All our rows carry a real `ChIJ…` place_id, so the
 * pin is reliable; when it's missing we degrade to the stored url, then
 * to a name search.
 */
export function googleMapsPlaceUrl(
  name: string | null | undefined,
  placeId: string | null | undefined,
  fallbackUrl?: string | null
): string | null {
  const query = (name ?? "").trim() || (placeId ?? "").trim();
  if (query && placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query
    )}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query
    )}`;
  }
  return fallbackUrl ?? null;
}
