import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTakeoutGeoJson } from "@/lib/google/takeout-parser";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const json = JSON.parse(text);
    const places = parseTakeoutGeoJson(json);

    if (places.length === 0) {
      return NextResponse.json({ error: "No valid places found in file" }, { status: 400 });
    }

    let imported = 0;
    let failed = 0;

    // Import in batches of 50
    const batchSize = 50;
    for (let i = 0; i < places.length; i += batchSize) {
      const batch = places.slice(i, i + batchSize);

      const rows = batch.map((p) => ({
        user_id: user.id,
        name: p.name,
        address: p.address,
        location: `POINT(${p.lng} ${p.lat})`,
        notes: p.note,
        source: "import" as const,
      }));

      const { data, error } = await supabase
        .from("places")
        .insert(rows)
        .select("id");

      if (error) {
        failed += batch.length;
        console.error("Import batch error:", error.message);
      } else {
        imported += data.length;
      }
    }

    return NextResponse.json({
      imported,
      failed,
      total: places.length,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to parse import file. Make sure it's a valid GeoJSON file from Google Takeout." },
      { status: 400 }
    );
  }
}
