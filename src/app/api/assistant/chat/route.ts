import { after, NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { anthropicClient } from "@/lib/agent/client";
import { doorRequest } from "@/lib/agent/door";
import { AgentError, type AgentErrorCode } from "@/lib/agent/errors";
import { pendingToolCalls } from "@/lib/agent/history";
import { openTurn, type OpenTurn, type TurnInput } from "@/lib/agent/run-turn";
import { replyMessageId } from "@/lib/agent/ui";
import { turnStream } from "@/lib/agent/ui-stream";
import type { AssistantUIMessage, DoorErrorBody } from "@/lib/agent/ui-types";
import { flushLangfuse } from "@/lib/telemetry/langfuse";
import { log } from "@/lib/telemetry/logger";

/**
 * POST /api/assistant/chat — one turn of the app's assistant
 * (docs/04-integrations/claude-agent.md). The panel sends only what is new —
 * the user's message, their answers to the approval cards, or Try again —
 * and the conversation id; the history lives on the server.
 *
 * Two phases. The turn's checks (one turn at a time, the answers fit the
 * cards waiting, the month's budget) run first and refuse with a plain HTTP
 * error: nothing has been written, so the panel gives the user their text
 * back. Then the turn streams in the AI SDK's UI message format. It doesn't
 * depend on the browser: if the panel closes or the page reloads mid-turn,
 * it runs to the end on the server (after()), and the panel shows the
 * stored result when it loads the conversation again.
 */

// A turn: up to 10 model calls plus the tools — ranking ~15–40 s, a web
// search ~30 s. The turn lease (15 min) outlasts this.
export const maxDuration = 800;

const Body = z.object({
  conversationId: z.string().uuid(),
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("message"), text: z.string().trim().min(1).max(8000), timeZone: z.string().max(64) }),
    z.object({ kind: z.literal("approval"), decisions: z.record(z.string(), z.boolean()) }),
    z.object({ kind: z.literal("retry") }),
  ]),
});

/** A refused turn's HTTP status; anything else is ours to fix (500). */
const STATUS: Partial<Record<AgentErrorCode, number>> = {
  not_found: 404,
  turn_in_progress: 409,
  conflict: 409,
  nothing_pending: 409,
  budget_exhausted: 429,
};

const refuse = (body: DoorErrorBody, status: number) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  const door = await doorRequest(req);
  if (door instanceof NextResponse) return door;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse({ error: "Invalid request." }, 400);
  const { conversationId } = parsed.data;
  const input: TurnInput = parsed.data.input;

  let turn: OpenTurn;
  try {
    turn = await openTurn(
      { client: anthropicClient(), store: door.store, ledger: door.ledger, toolCtx: door.toolCtx, purpose: "chat" },
      conversationId,
      input
    );
  } catch (e) {
    if (e instanceof AgentError) {
      log.warn("assistant.turn_refused", { userId: door.userId, conversationId, code: e.code, detail: e.message });
      return refuse({ error: e.userMessage, code: e.code }, STATUS[e.code] ?? 500);
    }
    log.error("assistant.turn_open_failed", e, { userId: door.userId, conversationId });
    return refuse({ error: "Couldn't start the reply. Try again." }, 500);
  }

  // The reply goes into the message the panel already shows when the turn
  // carries one on (an answer to its cards, Try again); the results of the
  // calls that message made update its parts in place.
  const messageId = replyMessageId(turn.history, input.kind);
  const continuing = input.kind === "message" ? [] : pendingToolCalls(turn.history).map((c) => c.id);

  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  // The turn runs to the end even if the browser has gone; its trace is
  // sent after it, not alongside.
  after(async () => {
    await done;
    await flushLangfuse();
  });

  const stream = createUIMessageStream<AssistantUIMessage>({
    execute: async ({ writer }) => {
      const ui = turnStream(writer, { continuing, toolCtx: door.toolCtx, history: turn.history });
      writer.write({ type: "start", messageId });
      try {
        const result = await turn.run(ui.events);
        await ui.finish(result);
        log.info("assistant.turn", {
          userId: door.userId,
          conversationId,
          input: input.kind,
          status: result.status,
          steps: result.steps,
          costUsd: Number(result.costUsd.toFixed(4)),
        });
      } catch (e) {
        ui.fail(e, turn.history.length);
        if (e instanceof AgentError) {
          log.warn("assistant.turn_failed", { userId: door.userId, conversationId, code: e.code, detail: e.message });
        }
      } finally {
        writer.write({ type: "finish" });
        finished();
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
