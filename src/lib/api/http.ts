import "server-only";
import { NextResponse } from "next/server";
import type { UserContext } from "@/lib/db/context";
import { InputError, NotFoundError } from "@/lib/db/errors";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/telemetry/logger";

/**
 * The common parts of a route that calls a shared data module
 * (src/lib/plans, src/lib/visits): who is calling, and how the module's
 * errors become a response.
 */

/** The signed-in caller, or null when nobody is signed in. */
export async function requestContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** An error from a data module as the response a route returns. */
export function errorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
  if (e instanceof InputError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  log.error(`${where} failed`, { error: e instanceof Error ? e.message : String(e) });
  return NextResponse.json({ error: "Something went wrong — nothing was changed" }, { status: 500 });
}
