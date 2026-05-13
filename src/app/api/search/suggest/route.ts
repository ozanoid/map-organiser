import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggest } from "@/lib/mapbox/search-box";

/**
 * GET /api/search/suggest?q=...&session_token=<uuidv4>&proximity=<lng,lat>
 *
 * Mapbox Search Box `/suggest` proxy. Returns autocomplete suggestions.
 * The session_token groups suggest+retrieve into a single billable session;
 * cost is tracked on retrieve, not here.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const sessionToken = sp.get("session_token");
  const proximityRaw = sp.get("proximity");

  if (!q) return NextResponse.json({ suggestions: [] });
  if (!sessionToken) {
    return NextResponse.json({ error: "session_token is required" }, { status: 400 });
  }

  let proximity: { lng: number; lat: number } | undefined;
  if (proximityRaw) {
    const [lngStr, latStr] = proximityRaw.split(",");
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      proximity = { lng, lat };
    }
  }

  const suggestions = await suggest({ q, sessionToken, proximity, limit: 8 });
  return NextResponse.json({ suggestions });
}
