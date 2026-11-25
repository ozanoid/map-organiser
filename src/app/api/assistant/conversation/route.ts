import { NextResponse } from "next/server";
import { describeWrites } from "@/lib/agent/describe-writes";
import { doorRequest } from "@/lib/agent/door";
import { pendingToolCalls, toolCallsIn } from "@/lib/agent/history";
import { DEFAULT_AGENT_MODEL } from "@/lib/agent/models";
import { startConversation } from "@/lib/agent/run-turn";
import { checkToolCall, needsApproval } from "@/lib/agent/tools";
import { toUIMessages } from "@/lib/agent/ui";
import type { ConversationResponse } from "@/lib/agent/ui-types";
import { log } from "@/lib/telemetry/logger";

/**
 * The app's assistant conversation (docs/04-integrations/claude-agent.md).
 *
 * GET  — the user's latest conversation as the panel shows it, and whether
 *        a turn of it is running now (the panel then waits for it).
 * POST — "New chat": a new, empty conversation becomes the latest. The old
 *        one stays.
 */

export async function GET(req: Request) {
  const door = await doorRequest(req);
  if (door instanceof NextResponse) return door;
  try {
    const latest = await door.store.latest("app");
    if (!latest) return NextResponse.json({ conversation: null, messages: [], version: 0 } satisfies ConversationResponse);

    const { messages: history, lastTurn } = await door.store.load(latest.id);
    const calls = history.flatMap((m) => (m.role === "assistant" ? toolCallsIn(m.content) : []));
    const runs = new Map((await door.store.toolRuns(latest.id, calls.map((c) => c.id))).map((r) => [r.toolUseId, r]));
    // Every proposal keeps its description — the waiting card, and what was
    // saved or not ("Not saved · Create list: …"), as the live reply showed
    // it. One batch of name lookups for the whole conversation.
    const writes = calls.filter((c) => needsApproval(c.name) && checkToolCall(c.name, c.input).ok);
    // The cards still waiting for an answer: no result, no run yet.
    const waiting = new Set(pendingToolCalls(history).flatMap((c) => (runs.has(c.id) ? [] : [c.id])));
    const previews = await describeWrites(door.toolCtx, writes, history, { waiting }).catch((e: unknown) => {
      log.warn("agent.preview_failed", { error: e instanceof Error ? e.message : String(e) });
      return {};
    });

    return NextResponse.json({
      conversation: { id: latest.id, turnInProgress: latest.turnInProgress },
      messages: toUIMessages(history, runs, previews, { turnInProgress: latest.turnInProgress, lastTurn }),
      version: history.length,
    } satisfies ConversationResponse);
  } catch (e) {
    log.error("assistant.conversation_load_failed", e, { userId: door.userId });
    return NextResponse.json({ error: "Couldn't load the conversation." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const door = await doorRequest(req);
  if (door instanceof NextResponse) return door;
  try {
    const conversation = await startConversation(door.store, { userId: door.userId, door: "app", model: DEFAULT_AGENT_MODEL });
    return NextResponse.json({
      conversation: { id: conversation.id, turnInProgress: false },
      messages: [],
      version: 0,
    } satisfies ConversationResponse);
  } catch (e) {
    log.error("assistant.conversation_create_failed", e, { userId: door.userId });
    return NextResponse.json({ error: "Couldn't start a new chat." }, { status: 500 });
  }
}
