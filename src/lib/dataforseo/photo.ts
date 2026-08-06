/**
 * DataForSEO photo handler.
 *
 * DataForSEO returns main_image as a direct URL (usually Google CDN).
 * We download and upload to Supabase Storage (same pattern as Google Photos).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Download a photo and put it in Storage under `<userId>/<placeId>.<ext>`.
 *
 * The caller passes its own client, and that is load-bearing rather than
 * stylistic. This used to build a cookie-scoped client internally, which is
 * correct in a request handler and silently wrong everywhere else: the
 * `place-photos` policy is
 * `(storage.foldername(name))[1] = auth.uid()::text`, so with no session
 * `auth.uid()` is NULL, the upload is denied, and the function returns null
 * exactly as it would for a dead image URL. Every Belgian place in the first
 * queue-driven import landed without a photo that way, and the daily refresh
 * cron had been quietly failing the same check for as long as it has existed.
 *
 * Background callers (the import drain, the refresh cron) must pass a
 * service-role client; request handlers pass their own.
 */
export async function downloadAndStorePhotoFromUrl(
  supabase: SupabaseClient,
  imageUrl: string,
  placeId: string,
  userId: string
): Promise<string | null> {
  try {
    if (!imageUrl || !imageUrl.startsWith("http")) return null;

    console.log(
      `[DataForSEO Photo] Downloading: ${imageUrl.substring(0, 80)}...`
    );
    const res = await fetch(imageUrl);

    if (!res.ok) {
      console.error(
        `[DataForSEO Photo] Download failed: ${res.status} ${res.statusText}`
      );
      return null;
    }

    const blob = await res.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const ext =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : "jpg";
    const fileName = `${userId}/${placeId}.${ext}`;

    const { error } = await supabase.storage
      .from("place-photos")
      .upload(fileName, buffer, {
        contentType: blob.type || "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("[DataForSEO Photo] Storage upload error:", error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("place-photos")
      .getPublicUrl(fileName);

    console.log(`[DataForSEO Photo] Stored: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (e) {
    console.error("[DataForSEO Photo] Error:", e);
    return null;
  }
}
