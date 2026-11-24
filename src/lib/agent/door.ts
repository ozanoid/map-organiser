import "server-only";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/api/origin";
import { requestContext, unauthorized } from "@/lib/api/http";
import type { AssistantContext } from "@/lib/assistant/library";
import { supabaseSpendLedger, type SpendLedger } from "@/lib/agent/spend";
import { supabaseConversationStore, type ConversationStore } from "@/lib/agent/store";
import { createServiceClient } from "@/lib/supabase/server";

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

export interface DoorRequest {
  userId: string;
  toolCtx: AssistantContext;
  store: ConversationStore;
  ledger: SpendLedger;
}

/** The request's door context, or the response to return instead. */
export async function doorRequest(req: Request): Promise<DoorRequest | NextResponse> {
  const ctx = await requestContext();
  if (!ctx) return unauthorized();
  if (!isAssistantConfigured()) {
    return NextResponse.json({ error: "The assistant isn't set up on this server." }, { status: 503 });
  }
  const { data: profile, error } = await ctx.supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (profile?.ai_features_enabled === false) {
    return NextResponse.json({ error: "AI features are turned off in Settings." }, { status: 403 });
  }
  const admin = createServiceClient();
  return {
    userId: ctx.userId,
    toolCtx: { supabase: ctx.supabase, userId: ctx.userId, appUrl: appOrigin(req) },
    store: supabaseConversationStore(admin, ctx.userId),
    ledger: supabaseSpendLedger(admin),
  };
}
