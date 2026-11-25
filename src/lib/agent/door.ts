import "server-only";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/api/origin";
import { unauthorized } from "@/lib/api/http";
import type { AssistantContext } from "@/lib/assistant/library";
import { isAssistantOwner } from "@/lib/assistant/owner";
import { supabaseSpendLedger, type SpendLedger } from "@/lib/agent/spend";
import { supabaseConversationStore, type ConversationStore } from "@/lib/agent/store";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * The app door's shared request setup: who is calling, whether the
 * assistant is on for them, and the pieces a turn needs.
 *
 *   - tools run with the user's own session (RLS), like every app route;
 *   - the agent's tables and the spend ledger are written with the service
 *     role, scoped to the user in code (supabaseConversationStore).
 */

/** The server can run the assistant (the Claude API key is set). */
export function isAssistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Whether this account may use the in-app assistant: the server has its
 * Claude key and the account is one of the owners (ASSISTANT_OWNER_EMAILS —
 * the list the claude.ai connector checks; Ozan, 25.11.2026). The assistant
 * spends the platform's one budget, so it is the owners' alone. One answer
 * for the door and for the entries that open it (`/api/user/ai-settings`).
 */
export function assistantOpenTo(email: string | null | undefined): boolean {
  return isAssistantConfigured() && isAssistantOwner(email);
}

export interface DoorRequest {
  userId: string;
  toolCtx: AssistantContext;
  store: ConversationStore;
  ledger: SpendLedger;
}

/** The request's door context, or the response to return instead. */
export async function doorRequest(req: Request): Promise<DoorRequest | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  if (!isAssistantConfigured()) {
    return NextResponse.json({ error: "The assistant isn't set up on this server." }, { status: 503 });
  }
  if (!assistantOpenTo(user.email)) {
    return NextResponse.json(
      { error: "The assistant is only open to this app's owner.", code: "not_owner" },
      { status: 403 }
    );
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (profile?.ai_features_enabled === false) {
    return NextResponse.json({ error: "AI features are turned off in Settings." }, { status: 403 });
  }
  const admin = createServiceClient();
  return {
    userId: user.id,
    toolCtx: { supabase, userId: user.id, appUrl: appOrigin(req) },
    store: supabaseConversationStore(admin, user.id),
    ledger: supabaseSpendLedger(admin),
  };
}
