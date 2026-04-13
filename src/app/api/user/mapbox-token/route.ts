import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserApiKeys } from "@/lib/google/get-user-api-keys";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mapboxToken } = await getUserApiKeys(user.id);
  return NextResponse.json({ token: mapboxToken });
}
