import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlanContext } from "@/lib/plans/read";
import { PlanInputError, PlanNotFoundError } from "@/lib/plans/write";
import { log } from "@/lib/telemetry/logger";

/** The signed-in caller as a plan context, or null when nobody is signed in. */
export async function planRequestContext(): Promise<PlanContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** Turns an error from src/lib/plans into the response a route returns. */
export function planErrorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof PlanNotFoundError) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
  if (e instanceof PlanInputError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  log.error(`${where} failed`, { error: e instanceof Error ? e.message : String(e) });
  return NextResponse.json({ error: "Something went wrong — nothing was changed" }, { status: 500 });
}
