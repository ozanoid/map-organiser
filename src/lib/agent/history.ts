import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

/**
 * A conversation's history: the exact messages sent to and received from the
 * API, appended and never changed. Claude's 5.5 models bind each thinking
 * block to everything before it, so a turn that is trimmed, rewritten or
 * re-serialised differently loses the reasoning after it.
 */

export interface StoredMessage {
  seq: number;
  role: "user" | "assistant";
  content: BetaContentBlockParam[];
}

/** A tool call waiting for its result — the model's `tool_use` block. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * The assistant content as it goes into the history.
 *
 * After a refusal fallback mid-answer, the API's rule for sending the turn
 * back: before the last `fallback` block, keep only text, the fallback
 * blocks themselves and server-tool calls that have their results; drop
 * thinking, `tool_use` and anything else the declined model produced
 * internally. The fallback block stays where it is — the API checks the
 * thinking around it by its position. Without a fallback, everything as is.
 *
 * The `tool_use` blocks the loop runs are read from this, so a call the
 * declined model started is never run.
 */
export function echoable(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.findLastIndex((block) => block.type === "fallback");
  if (boundary < 0) return content as BetaContentBlockParam[];

  const calls = new Set<string>();
  const results = new Set<string>();
  for (const block of content) {
    if (block.type === "server_tool_use") calls.add(block.id);
    else if ("tool_use_id" in block && typeof block.tool_use_id === "string") results.add(block.tool_use_id);
  }
  return content.filter((block, i) => {
    if (i >= boundary) return true;
    if (block.type === "text" || block.type === "fallback") return true;
    if (block.type === "server_tool_use") return results.has(block.id);
    if ("tool_use_id" in block && typeof block.tool_use_id === "string") return calls.has(block.tool_use_id);
    return false;
  }) as BetaContentBlockParam[];
}

/** The client tool calls in an assistant message. */
export function toolCallsIn(content: BetaContentBlockParam[]): ToolCall[] {
  return content.flatMap((block) =>
    block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : []
  );
}

/**
 * The calls still waiting for their results: the last message is the
 * assistant's and it called tools. Results always go in the next user
 * message, so anything else means nothing is pending.
 */
export function pendingToolCalls(history: readonly StoredMessage[]): ToolCall[] {
  const last = history.at(-1);
  return last?.role === "assistant" ? toolCallsIn(last.content) : [];
}

export function toolResult(id: string, text: string, isError: boolean): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) };
}

/** Marks the context block the server adds to each user message, so a door
 *  can leave it out when it shows the conversation. */
export const CONTEXT_TAG = "context";

/**
 * The user's date and time, added to every new user message — the system
 * prompt stays the same for the whole conversation, so what changes goes
 * into the turn. Yesterday and the next six days come with their dates:
 * worked out by the model, that arithmetic ended up written into its
 * replies ("Saturday is 2026-11-28."). A time zone that isn't a valid IANA
 * name falls back to UTC.
 */
export function contextBlock(now: Date, timeZone: string): BetaTextBlockParam {
  const zone = validTimeZone(timeZone) ? timeZone : "UTC";
  const local = (instant: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value])
    );
  const today = local(now);
  // Calendar days around the local date, by date arithmetic at noon UTC —
  // independent of DST changes in the user's zone.
  const noon = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day), 12);
  const day = (offset: number) => {
    const d = new Date(noon + offset * 86_400_000);
    const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    return `${weekday} ${d.toISOString().slice(0, 10)}`;
  };
  const text =
    `Now for the user: ${today.weekday} ${today.year}-${today.month}-${today.day}, ${today.hour}:${today.minute} (${zone}). ` +
    `Yesterday: ${day(-1)}. Coming days: ${[1, 2, 3, 4, 5, 6].map(day).join(", ")}.`;
  return { type: "text", text: `<${CONTEXT_TAG}>${text}</${CONTEXT_TAG}>` };
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The text of an assistant message, for logs and the eval. */
export function textOf(content: BetaContentBlockParam[]): string {
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}
