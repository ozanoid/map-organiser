import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  encryptApiKey,
  maskApiKey,
  decryptApiKey,
} from "@/lib/google/get-user-api-keys";

// GET - return masked keys
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, google_api_key_enc, mapbox_token_enc")
    .eq("id", user.id)
    .single();

  const googleKey = profile?.google_api_key_enc
    ? decryptApiKey(profile.google_api_key_enc)
    : "";
  const mapboxToken = profile?.mapbox_token_enc
    ? decryptApiKey(profile.mapbox_token_enc)
    : "";

  return NextResponse.json({
    isAdmin: profile?.is_admin || false,
    googleApiKey: maskApiKey(googleKey),
    mapboxToken: maskApiKey(mapboxToken),
    hasGoogleKey: !!googleKey,
    hasMapboxToken: !!mapboxToken,
  });
}

// PUT - save encrypted keys
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, string | null> = {};

  if (body.googleApiKey !== undefined) {
    updates.google_api_key_enc = body.googleApiKey
      ? encryptApiKey(body.googleApiKey)
      : null;
  }
  if (body.mapboxToken !== undefined) {
    updates.mapbox_token_enc = body.mapboxToken
      ? encryptApiKey(body.mapboxToken)
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No keys to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
