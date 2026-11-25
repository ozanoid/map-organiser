import { isToolUIPart, type UIMessage } from "ai";
import { MAX_PLACE_IDS } from "@/lib/places/limits";

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
  /** A proposal shown as its outcome (a plan change, as the plan will be):
   *  the outcome's fingerprint. The answer sends it back; the change is
   *  saved only if it would still come out the same. */
  fingerprint?: string;
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

/**
 * What a request sent from a screen of the app is about (Phase 2, 6.1):
 * the plan on the plan page, the places on the compare page, the map or
 * the places list with its filters. The screen names it by id; the server
 * checks it is the user's, names it for the model in a <subject> block of
 * the message (agent/subject.ts) and keeps it with the conversation.
 */
export type AssistantSubject =
  | { kind: "plan"; planId: string }
  | { kind: "places"; placeIds: string[] }
  | { kind: "view"; page: "map" | "places"; filters: SubjectViewFilters; area?: SubjectArea };

/** The filters of the screen the request came from — the app's own
 *  (PlaceFilters), by id; the server turns them into names. */
export type SubjectViewFilters = {
  city?: string;
  country?: string;
  category_ids?: string[];
  subcategory_ids?: string[];
  tag_ids?: string[];
  list_id?: string;
  rating_min?: number;
  google_rating_min?: number;
  visit_status?: string;
  open_now?: boolean;
};

/** The part of the map on screen: its centre and about how far it reaches. */
export type SubjectArea = { lat: number; lng: number; radiusM: number };

/** The subject as the model reads it and the chip names it — the names
 *  come from the database, never from the request. */
export type ResolvedSubject =
  | { kind: "plan"; plan: { id: string; name: string } }
  | { kind: "places"; places: { id: string; name: string }[] }
  | {
      kind: "view";
      page: "map" | "places";
      filters: {
        city?: string;
        country?: string;
        categories?: string[];
        subcategories?: string[];
        tags?: string[];
        list?: string;
        visit_status?: string;
        min_my_rating?: number;
        min_google_rating?: number;
        open_now?: boolean;
      };
      area?: { lat: number; lng: number; radius_m: number };
    };

/** A message's subject chip (`data-subject` part). On a message the panel
 *  sends, `subject` carries what the request body needs. */
export type SubjectPart = { kind: AssistantSubject["kind"]; label: string; subject?: AssistantSubject };

/** What a chip says — the same words before the message is sent (the
 *  screen knows the names) and after (the server's names). */
export function subjectLabel(s: ResolvedSubject): string {
  switch (s.kind) {
    case "plan":
      return `Plan · ${s.plan.name}`;
    case "places": {
      const names = s.places.map((p) => p.name).join(", ");
      const shown = names.length > 60 ? `${names.slice(0, 59).trimEnd()}…` : names;
      return `${s.places.length} ${s.places.length === 1 ? "place" : "places"} · ${shown}`;
    }
    case "view": {
      const f = s.filters;
      const parts = [
        ...(f.categories ?? []),
        ...(f.subcategories ?? []),
        ...(f.tags ?? []).map((t) => `#${t}`),
        f.list,
        f.city ?? f.country,
      ].filter((x): x is string => Boolean(x));
      const base = s.page === "map" ? "Map" : "Your places";
      if (parts.length) return `${base} · ${parts.slice(0, 3).join(", ")}${parts.length > 3 ? "…" : ""}`;
      return s.page === "map" ? "Map · this area" : base;
    }
  }
}

export type AssistantDataTypes = {
  turn: TurnOutcome;
  subject: SubjectPart;
};

export type AssistantUIMessage = UIMessage<unknown, AssistantDataTypes>;

type AssistantPart = AssistantUIMessage["parts"][number];

/** A message's subject chip. */
export function isSubjectPart(part: AssistantPart): part is Extract<AssistantPart, { type: "data-subject" }> {
  return part.type === "data-subject";
}

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
    | { kind: "message"; text: string; timeZone: string; subject?: AssistantSubject }
    | { kind: "approval"; decisions: Record<string, boolean>; seen?: Record<string, string> }
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

const PLACE_PATH = /^\/places\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_URL = /https?:\/\/[^\s)<>\]]+/g;

/**
 * The saved places a reply links to — `[name](/places/<id>)`, or the same
 * page as a full URL on the app's own origin — in the order they first
 * appear, at most MAX_PLACE_IDS. The panel offers to show them on the map.
 */
export function placeIdsIn(markdown: string, origin: string): string[] {
  const hrefs = [
    ...[...markdown.matchAll(MARKDOWN_LINK)].map((m) => ({ at: m.index, href: m[1] })),
    // A bare URL ends before the sentence's punctuation.
    ...[...markdown.matchAll(BARE_URL)].map((m) => ({ at: m.index, href: m[0].replace(/[.,;:!?'"]+$/, "") })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((h) => h.href);
  const ids: string[] = [];
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    const id = url.origin === origin ? PLACE_PATH.exec(url.pathname)?.[1]?.toLowerCase() : undefined;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_PLACE_IDS);
}
