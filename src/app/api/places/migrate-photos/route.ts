import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/places/migrate-photos
 *
 * One-time migration: downloads 1 photo per place from Google to Supabase Storage.
 * Only processes places that have google_data.photos but no photo_storage_url.
 * Auth required.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all places with Google photo URLs but no storage URL
  const { data: places, error } = await supabase
    .from("places")
    .select("id, name, google_data")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const toMigrate = (places || []).filter((p: any) => {
    const gd = p.google_data;
    return gd?.photos?.length > 0 && !gd?.photo_storage_url;
  });

  let migrated = 0;
  let failed = 0;

  for (const place of toMigrate) {
    try {
      const googlePhotoUrl = place.google_data.photos[0];

      // Download from Google
      const res = await fetch(googlePhotoUrl);
      if (!res.ok) {
        failed++;
        continue;
      }

      const blob = await res.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      const fileName = `${user.id}/${place.id}.${ext}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("place-photos")
        .upload(fileName, buffer, {
          contentType: blob.type || "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Upload error for ${place.name}:`, uploadError.message);
        failed++;
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("place-photos")
        .getPublicUrl(fileName);

      // Update google_data with storage URL and remove old photo URLs
      const updatedGoogleData = {
        ...place.google_data,
        photo_storage_url: urlData.publicUrl,
      };
      delete updatedGoogleData.photos; // Remove Google photo URLs

      await supabase
        .from("places")
        .update({ google_data: updatedGoogleData })
        .eq("id", place.id);

      migrated++;

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      failed++;
    }
  }

  return NextResponse.json({
    total: toMigrate.length,
    migrated,
    failed,
    skipped: (places?.length || 0) - toMigrate.length,
  });
}
