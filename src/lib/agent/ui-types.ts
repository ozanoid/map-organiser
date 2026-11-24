import { isToolUIPart, type UIMessage } from "ai";

/**
 * What the app's assistant panel and its server routes agree on — shared,
 * so it imports nothing server-only.
 *
 * The panel speaks the AI SDK's UI message format (useChat). Every tool is a
 * `dynamic-tool` part; a call that saves something carries its preview in
 * `toolMetadata.preview`. The turn's outcome arrives as a `data-turn` part.
 */

/** One line of an approval card. (Type aliases, not interfaces: the AI
 *  SDK's toolMetadata takes JSON objects, and only aliases fit its index
 *  signature.) */
export type PreviewLine = {
  /** Left column: a time, a part of the day, "Day 2", a change's kind. */
  label?: string;
  text: string;
  /** Second line, muted. */
  note?: string;
  heading?: boolean;
};

/** What an approval card shows: the proposal in words (describe-writes.ts). */
export type WritePreview = {
  title: string;
  subtitle?: string;
  lines: PreviewLine[];
  /** Lines left out after the card's limit. */
  more?: number;
  /** Removes something for good. */
  danger?: boolean;
};

/**
 * How a turn ended, when the panel has something to say about it. `retry`:
 * Try again can carry the turn on (the server decides). `version`: the
 * conversation's length after the turn — the panel won't take a server copy
 * older than what it has streamed.
 */
export type TurnOutcome = (
  | { status: "done" | "awaiting_approval" | "refused" | "max_tokens" | "step_limit" }
  | { status: "error"; code: string; message: string; retry?: boolean }
) & { version?: number };

export type AssistantDataTypes = {
  turn: TurnOutcome;
};

export type AssistantUIMessage = UIMessage<unknown, AssistantDataTypes>;

/** The trimmed tool output the panel gets — what it shows, not what the
 *  model read. */
export interface ToolSummary {
  /** e.g. "12 places", "3 reviews matched". */
  summary?: string;
  /** Places the panel can put on the map ("Show on map"). */
  places?: { id: string; name: string }[];
  /** A link to what a write saved (plan, list, place). */
  link?: { label: string; url: string };
  /** Web search results. */
  results?: { title: string; url: string }[];
}

export type ToolMetadata = {
  /** A tool that saves something: shown as a change card, not a tool row. */
  write?: boolean;
  preview?: WritePreview;
};

/** POST /api/assistant/chat body. */
export type ChatRequestBody = {
  conversationId: string;
  input:
    | { kind: "message"; text: string; timeZone: string }
    | { kind: "approval"; decisions: Record<string, boolean> }
    | { kind: "retry" };
};

/** What the panel asks for besides the user's text (sendMessage's body
 *  option): the answers to the cards, or Try again. */
export type SendIntent = { intent: "approval" | "retry" };

/** A refusal before the turn started (an HTTP error): nothing was written,
 *  so the user's text is still theirs to send. */
export type DoorErrorBody = { error: string; code?: string };

/** GET /api/assistant/conversation response. */
export interface ConversationResponse {
  conversation: { id: string; turnInProgress: boolean } | null;
  messages: AssistantUIMessage[];
  /** The conversation's length (messages stored) — see TurnOutcome.version. */
  version: number;
}

/** The parts of the last model call in a message — tool parts before the
 *  last step boundary belong to earlier calls. */
export function lastStepToolParts(message: AssistantUIMessage) {
  const start = message.parts.reduce((last, part, i) => (part.type === "step-start" ? i : last), -1);
  return message.parts.slice(start + 1).filter(isToolUIPart);
}

/**
 * Every card of the paused call has an answer: time to send them. (The AI
 * SDK's own helper waits for every tool part of the step, but the reads
 * made alongside a write stay waiting until the answers are sent.)
 */
export function approvalsAnswered({ messages }: { messages: AssistantUIMessage[] }): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  const parts = lastStepToolParts(last);
  return parts.some((p) => p.state === "approval-responded") && !parts.some((p) => p.state === "approval-requested");
}
