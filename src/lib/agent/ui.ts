import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { DynamicToolUIPart } from "ai";
import { isTransient, userMessageFor } from "@/lib/agent/errors";
import { CONTEXT_TAG, type StoredMessage } from "@/lib/agent/history";
import { SUBJECT_TAG, subjectIn } from "@/lib/agent/subject";
import { canRetry, type TurnInput } from "@/lib/agent/run-turn";
import type { ToolRun, TurnRecord } from "@/lib/agent/store";
import { checkToolCall, needsApproval } from "@/lib/agent/tools";
import {
  subjectLabel,
  type AssistantUIMessage,
  type ToolMetadata,
  type ToolSummary,
  type TurnOutcome,
  type WritePreview,
} from "@/lib/agent/ui-types";

/**
 * The stored conversation as the app's panel shows it (AI SDK UI messages),
 * and the trimmed tool outputs the panel gets. The model's history stays as
 * it is; this is a view of it.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function placesOf(rows: unknown): { id: string; name: string }[] {
  return Array.isArray(rows)
    ? rows.flatMap((r) => (isObj(r) && typeof r.id === "string" && typeof r.name === "string" ? [{ id: r.id, name: r.name }] : []))
    : [];
}

/** The first `url` in an output, with the `name` next to it. */
function firstLink(node: unknown): { label: string; url: string } | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstLink(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObj(node)) return undefined;
  if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) {
    return { label: typeof node.name === "string" ? node.name : "Open", url: node.url };
  }
  for (const value of Object.values(node)) {
    const found = firstLink(value);
    if (found) return found;
  }
  return undefined;
}

/** What the panel needs from a tool's output (the model read all of it). */
export function uiToolOutput(name: string, text: string): ToolSummary {
  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isObj(out)) return {};
  switch (name) {
    case "search_places": {
      const places = placesOf(out.places);
      const total = typeof out.total_matches === "number" ? out.total_matches : places.length;
      return { summary: plural(total, "place"), places };
    }
    case "rank_places": {
      // Candidates for the model to judge, not an answer: no "Show on map"
      // here — the reply's own place links get one (the panel).
      const n = typeof out.candidates === "number" ? out.candidates : placesOf(out.places).length;
      return { summary: n ? plural(n, "candidate") : "No match" };
    }
    case "get_places":
      return { summary: plural(placesOf(out.places).length, "place") };
    case "read_reviews":
      return {
        summary:
          typeof out.matched === "number"
            ? `${plural(out.matched, "review")}${typeof out.place === "string" ? ` · ${out.place}` : ""}`
            : undefined,
      };
    case "get_visits":
      return { summary: Array.isArray(out.visits) ? plural(out.visits.length, "visit") : undefined };
    case "get_plans":
      return { summary: Array.isArray(out.plans) ? plural(out.plans.length, "plan") : typeof out.name === "string" ? out.name : undefined };
    case "get_lists":
      return { summary: Array.isArray(out.lists) ? plural(out.lists.length, "list") : typeof out.name === "string" ? out.name : undefined };
    case "get_library_overview":
      return { summary: typeof out.total_places === "number" ? `${out.total_places} places saved` : undefined };
    case "search_google_maps": {
      const results = Array.isArray(out.results) ? out.results : [];
      return { summary: plural(results.length, "result") };
    }
    default:
      // Writes: link to what was saved.
      return needsApproval(name) ? { link: firstLink(out) } : {};
  }
}

/** Web search results → titles and links (up to 5). */
export function searchResults(content: unknown): ToolSummary {
  const results = Array.isArray(content)
    ? content.flatMap((r) =>
        isObj(r) && r.type === "web_search_result" && typeof r.url === "string"
          ? [{ title: typeof r.title === "string" ? r.title : r.url, url: r.url }]
          : []
      )
    : [];
  return { summary: plural(results.length, "result"), results: results.slice(0, 5) };
}

/** What the user wrote: the server's own blocks (<context>, <subject>) left out. */
function userText(content: BetaContentBlockParam[]): string {
  return content
    .flatMap((b) =>
      b.type === "text" && !b.text.startsWith(`<${CONTEXT_TAG}>`) && !b.text.startsWith(`<${SUBJECT_TAG}>`) ? [b.text] : []
    )
    .join("\n")
    .trim();
}

const INTERRUPTED_WRITE = "Interrupted before it finished — it may or may not have been saved. Try again below to check.";

/**
 * The id toUIMessages gives the assistant message a turn writes into, so a
 * live reply and the stored conversation agree — and a turn that carries a
 * message on (an answer to its cards, Try again) updates the panel's
 * message in place instead of adding a copy.
 *
 * An assistant message is the run of model messages (and the tool results
 * between them) after a message the user wrote; its id is its first model
 * message's position, or where that will go.
 */
export function replyMessageId(history: readonly StoredMessage[], kind: TurnInput["kind"]): string {
  // A new message goes at the end, its reply right after it.
  if (kind === "message") return `a${history.length + 1}`;
  let first = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "user" && userText(m.content)) break;
    if (m.role === "assistant") first = m.seq;
  }
  return `a${first}`;
}

/**
 * What the panel says about the last turn after a reload: its recorded
 * outcome while nothing has been appended since, or — with no record of
 * how it ended (a crash, a timeout) — that it broke off, when Try again
 * can carry it on.
 */
function outcomeNote(
  history: StoredMessage[],
  runs: Map<string, ToolRun>,
  lastTurn: TurnRecord | null
): TurnOutcome | null {
  const retry = canRetry(history, (id) => runs.has(id));
  if (lastTurn && lastTurn.seq === history.length) {
    if (lastTurn.status === "done" || lastTurn.status === "awaiting_approval") return null;
    if (lastTurn.status !== "error") return { status: lastTurn.status };
    const code = lastTurn.code ?? "upstream";
    return { status: "error", code, message: userMessageFor(code), retry: retry && isTransient(code) };
  }
  return retry
    ? { status: "error", code: "interrupted", message: "The reply was interrupted before it finished.", retry: true }
    : null;
}

/**
 * The conversation as UI messages: one user message per message the user
 * wrote, one assistant message per turn (every model call of the turn, a
 * step each). Tool calls get their state from the results in the history
 * and the run records — saved, declined, not run, failed, being saved, or
 * (the last message's) waiting for the card, with its preview. The last
 * turn's outcome, when there's something to say, ends the last message.
 */
export function toUIMessages(
  history: StoredMessage[],
  runs: Map<string, ToolRun>,
  previews: Record<string, WritePreview>,
  state: { turnInProgress: boolean; lastTurn: TurnRecord | null }
): AssistantUIMessage[] {
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const m of history) {
    if (m.role !== "user") continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
      results.set(b.tool_use_id, { text, isError: Boolean(b.is_error) });
    }
  }

  const out: AssistantUIMessage[] = [];
  let current: AssistantUIMessage | null = null;
  for (const m of history) {
    if (m.role === "user") {
      const text = userText(m.content);
      if (text) {
        current = null;
        const subject = subjectIn(m.content);
        out.push({
          id: `u${m.seq}`,
          role: "user",
          parts: [
            ...(subject ? [{ type: "data-subject" as const, data: { kind: subject.kind, label: subjectLabel(subject) } }] : []),
            { type: "text", text, state: "done" },
          ],
        });
      }
      continue;
    }
    if (!current) {
      current = { id: `a${m.seq}`, role: "assistant", parts: [] };
      out.push(current);
    }
    current.parts.push({ type: "step-start" });
    const searched = new Map<string, unknown>();
    for (const b of m.content) if (b.type === "web_search_tool_result") searched.set(b.tool_use_id, b.content);

    for (const b of m.content) {
      if (b.type === "text") {
        if (b.text.trim()) current.parts.push({ type: "text", text: b.text, state: "done" });
      } else if (b.type === "server_tool_use" && b.name === "web_search") {
        current.parts.push({
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: b.id,
          providerExecuted: true,
          state: "output-available",
          input: b.input,
          output: searchResults(searched.get(b.id)),
        });
      } else if (b.type === "tool_use") {
        current.parts.push(
          toolPart(b.id, b.name, b.input, results.get(b.id), runs.get(b.id), previews[b.id], state.turnInProgress)
        );
      }
    }
  }

  const note = state.turnInProgress ? null : outcomeNote(history, runs, state.lastTurn);
  if (note) {
    // After the user's message (nothing stored for the reply — a refusal,
    // an error before it): an assistant message of its own, with the id
    // the turn's reply had.
    let last = out.at(-1);
    if (last?.role !== "assistant") {
      last = { id: `a${history.length}`, role: "assistant", parts: [] };
      out.push(last);
    }
    last.parts.push({ type: "data-turn", id: "turn", data: note });
  }
  return out;
}

function toolPart(
  id: string,
  name: string,
  input: unknown,
  result: { text: string; isError: boolean } | undefined,
  run: ToolRun | undefined,
  preview: WritePreview | undefined,
  turnInProgress: boolean
): DynamicToolUIPart {
  const write = needsApproval(name);
  const base = {
    type: "dynamic-tool" as const,
    toolName: name,
    toolCallId: id,
    input,
    ...(write ? { toolMetadata: { write, ...(preview ? { preview } : {}) } satisfies ToolMetadata } : {}),
  };
  // A recorded result stands in for one that didn't reach the history (the
  // turn broke off after the call ran).
  const outcome = result ?? (run?.status === "done" ? (run.outcome ?? undefined) : undefined);
  if (!outcome) {
    if (run && turnInProgress) {
      // Decided, and the turn running now is on it.
      return write
        ? { ...base, state: "approval-responded", approval: { id, approved: run.decision === "approved" } }
        : { ...base, state: "input-available" };
    }
    if (run) {
      // Started, and the turn that ran it is gone (a crash, a timeout).
      return {
        ...base,
        state: "output-error",
        errorText: write ? INTERRUPTED_WRITE : "Interrupted.",
        ...(write && run.decision === "approved" ? { approval: { id, approved: true } } : {}),
      };
    }
    // Waiting: a valid write for the user's card; anything else waits with it.
    return write && checkToolCall(name, input).ok
      ? { ...base, state: "approval-requested", approval: { id } }
      : { ...base, state: "input-available" };
  }
  // Declined on the card, or not run (the user wrote instead, a limit): not
  // a failure. (The AI SDK's denied state carries an approval, reads too.)
  if (run?.decision === "declined" || run?.decision === "not_run") {
    return { ...base, state: "output-denied", approval: { id, approved: false } };
  }
  if (outcome.isError) {
    return {
      ...base,
      state: "output-error",
      errorText: outcome.text,
      ...(write && run?.decision === "approved" ? { approval: { id, approved: true } } : {}),
    };
  }
  return {
    ...base,
    state: "output-available",
    output: uiToolOutput(name, outcome.text),
    ...(write ? { approval: { id, approved: true } } : {}),
  };
}
