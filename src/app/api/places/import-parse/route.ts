import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTakeoutGeoJson, parseTakeoutCsv } from "@/lib/google/takeout-parser";

// POST /api/places/import-parse — parse file, return place list (no enrichment)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const text = await file.text();
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    const places = isCsv ? parseTakeoutCsv(text) : parseTakeoutGeoJson(JSON.parse(text));

    if (places.length === 0) {
      return NextResponse.json({ error: "No valid places found in file" }, { status: 400 });
    }

    return NextResponse.json({ places, total: places.length });
  } catch {
    return NextResponse.json(
      { error: "Failed to parse file. Upload a GeoJSON or CSV from Google Takeout." },
      { status: 400 }
    );
  }
}
