import "server-only";
import { NextResponse } from "next/server";
import { isAssistantOwner } from "@/lib/assistant/owner";
import type { UserContext } from "@/lib/db/context";
import { createClient } from "@/lib/supabase/server";

/**
 * Who the app sends to. In v1 only the owner (Phase 3, decision 7): the
 * accounts in ASSISTANT_OWNER_EMAILS, the same ones the assistant is open
 * to. Every notification route asks here — an account that isn't an owner
 * can't make the app send an e-mail or a Telegram message, not even a
 * confirmation link. The assistant's send_plan is behind the same list
 * already (the in-app door and the MCP token check).
 */
export async function notifyContext(): Promise<(UserContext & { owner: boolean }) | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id, owner: isAssistantOwner(user.email) };
}

export const notOwner = () =>
  NextResponse.json({ error: "Notifications are only open to this app's owner.", code: "not_owner" }, { status: 403 });
