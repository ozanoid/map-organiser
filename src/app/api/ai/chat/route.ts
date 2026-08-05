import { NextRequest, NextResponse, after } from "next/server";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { propagateAttributes } from "@langfuse/tracing";
import { createClient } from "@/lib/supabase/server";
import { getAiClient, FLASH_MODEL } from "@/lib/ai/client";
import { buildUserContext } from "@/lib/ai/context-builder";
import { buildChatSystemPrompt } from "@/lib/ai/prompts/chat";
import { buildChatTools } from "@/lib/ai/chat-tools";
import { trackAiUsage, checkAiBudget } from "@/lib/ai/track-usage";
import { log } from "@/lib/telemetry/logger";
import { flushLangfuse } from "@/lib/telemetry/langfuse";

/**
 * POST /api/ai/chat — S3 AI-02 v1 (v1.21.0).
 *
 * Body: { messages: UIMessage[], sessionId?: string }
 *
 * The assistant agent loop: streamText + 7 tools (see chat-tools.ts),
 * stopWhen bounds per-turn fan-out. Follows the standard AI-route gate
 * skeleton (auth → flush hook → ai_features gate → client gate → budget
 * → validate) — all gates run BEFORE the stream starts so HTTP statuses
 * survive; mid-stream LLM failures surface as stream error parts.
 *
 * DELIBERATE deviation from the repo's "never streamText" rule
 * (gemini.md, amended in this release): chat is the one surface where
 * progressive output IS the product. Structured-output calls elsewhere
 * stay on generateText + Output.object.
 *
 * Budget: ONE unit per user TURN, charged in onFinish — an
 * approval-continuation POST (last message is the assistant's, carrying
 * the user's approval response) does NOT burn a second unit. The
 * stopWhen ceiling is the runaway guard within a turn.
 *
 * Session memory is client-side only (full UIMessage history round-trips
 * each POST); the server additionally trims to the last HISTORY_LIMIT
 * messages so long sessions can't blow up input tokens.
 */

// Multi-step turns (search → details → answer) can exceed the platform
// default; also bounds after(flushLangfuse).
export const maxDuration = 120;

const HISTORY_LIMIT = 30;
const STEP_LIMIT = 6;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Serverless: flush Langfuse spans after the response (stream included)
  // finishes.
  after(flushLangfuse);

  const { data: profile } = await supabase
    .from("profiles")
    .select("ai_features_enabled")
    .eq("id", user.id)
    .single();
  if (!profile?.ai_features_enabled) {
    return NextResponse.json(
      { error: "AI features are disabled", code: "ai_disabled" },
      { status: 403 }
    );
  }

  const aiClient = getAiClient();
  if (!aiClient) {
    return NextResponse.json(
      { error: "AI is not configured", code: "ai_unavailable" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
  if (!rawMessages || rawMessages.length === 0) {
    return NextResponse.json(
      { error: "messages array required" },
      { status: 400 }
    );
  }
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "none";

  const messages = (rawMessages as UIMessage[]).slice(-HISTORY_LIMIT);

  // Turn-charging rule: a fresh user message = a new turn = 1 unit. A
  // GENUINE approval continuation (assistant message last, actually
  // carrying an approval response) is free. An assistant-last history
  // WITHOUT approval responses is not a continuation the SDK would ever
  // send — treat it as a chargeable turn so a hand-crafted POST can't
  // ride the free path.
  const last = messages[messages.length - 1];
  const isApprovalContinuation =
    last?.role === "assistant" &&
    (last.parts ?? []).some(
      (p: any) =>
        typeof p?.type === "string" &&
        p.type.startsWith("tool-") &&
        (p.state === "approval-responded" || p.approval?.approved !== undefined)
    );
  const isNewTurn = !isApprovalContinuation;

  // Budget-gate only chargeable turns — blocking the (free) approval
  // continuation at the cap boundary would strand an already-charged
  // turn's confirm card.
  const budget = await checkAiBudget("chat", user.id, supabase);
  if (isNewTurn && budget.exceeded) {
    return NextResponse.json(
      {
        error: "Monthly AI chat limit reached",
        used: budget.used,
        cap: budget.cap,
      },
      { status: 429 }
    );
  }

  const ctx = await buildUserContext(supabase, user.id);
  const tools = buildChatTools(supabase, user.id, ctx);
  // ignoreIncompleteToolCalls: a Stop mid-tool leaves dangling
  // input-streaming/available parts in history — without this flag the
  // prompt conversion throws on every later turn and the session wedges.
  const modelMessages = await convertToModelMessages(messages, {
    tools,
    ignoreIncompleteToolCalls: true,
  });

  const result = propagateAttributes(
    {
      traceName: "ai-chat",
      userId: user.id,
      sessionId,
      tags: ["chat"],
    },
    () =>
      streamText({
        model: aiClient(FLASH_MODEL),
        system: buildChatSystemPrompt(ctx),
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(STEP_LIMIT),
        experimental_telemetry: {
          isEnabled: true,
          functionId: "ai.chat",
          metadata: {
            sessionId,
            messageCount: messages.length,
            newTurn: isNewTurn,
          },
        },
        onError: ({ error }) => {
          log.error("ai.chat stream error", {
            userId: user.id,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        },
        onFinish: ({ totalUsage, steps }) => {
          // Pass the route-scoped client explicitly — the request cookie
          // store is no longer accessible once streaming has started.
          if (isNewTurn) {
            trackAiUsage(user.id, "ai_chat", supabase).catch(() => {});
          }
          // totalUsage aggregates ALL steps of the turn; plain `usage`
          // would report only the final step's tokens.
          log.info("ai.chat", {
            userId: user.id,
            sessionId,
            newTurn: isNewTurn,
            steps: steps.length,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            budgetUsed: budget.used + (isNewTurn ? 1 : 0),
            budgetCap: budget.cap,
          });
        },
      })
  );

  return result.toUIMessageStreamResponse();
}
