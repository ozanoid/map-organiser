/**
 * DataForSEO photo handler.
 *
 * DataForSEO returns main_image as a direct URL (usually Google CDN).
 * We download and upload to Supabase Storage (same pattern as Google Photos).
 */

import { createClient } from "@/lib/supabase/server";

export async function downloadAndStorePhotoFromUrl(
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

    const supabase = await createClient();

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
