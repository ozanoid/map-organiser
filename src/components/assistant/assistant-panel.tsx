"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type DynamicToolUIPart } from "ai";
import { Loader2, Plus, Send, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AssistantMarkdown } from "@/components/assistant/assistant-markdown";
import { ChangeCard, isWritePart, MapButton, ToolRow, TurnNote } from "@/components/assistant/assistant-parts";
import {
  approvalsAnswered,
  lastStepToolParts,
  placeIdsIn,
  type AssistantUIMessage,
  type ChatRequestBody,
  type ConversationResponse,
  type DoorErrorBody,
  type SendIntent,
  type TurnOutcome,
} from "@/lib/agent/ui-types";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * The app's assistant: Claude, through the agent core on the server
 * (docs/04-integrations/claude-agent.md). A right sheet on desktop,
 * full-screen on mobile; opened from the header or, with a request already
 * written, from other screens (useAssistantStore).
 *
 * The conversation lives on the server. The panel loads the latest one,
 * sends only what is new — the user's text, their answers to the cards, or
 * Try again — and takes the server's copy whenever it isn't streaming, as
 * long as that copy isn't older than what it has streamed. A reload,
 * another tab or another device shows the same conversation. A turn runs
 * to the end on the server even if the panel closes; while one runs
 * elsewhere the panel waits for it.
 */

const CONVERSATION_KEY = ["assistant", "conversation"] as const;

const EXAMPLES = [
  "Bu akşam Londra'da nerede yiyebilirim?",
  "Cumartesi için Kadıköy'de brunch planı yap",
  "Dün Bolland & Crust'a gittim, 4 puan",
];

async function readError(res: Response, fallback: string): Promise<DoorErrorBody> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    return {
      error: typeof body.error === "string" ? body.error : fallback,
      ...(typeof body.code === "string" ? { code: body.code } : {}),
    };
  } catch {
    return { error: fallback };
  }
}

/** The server refused the turn before it started: nothing was written. */
class DoorError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined
  ) {
    super(message);
  }
}

/** The chat transport's fetch: a refused turn becomes a DoorError (the
 *  AI SDK's own would put the response body in a plain Error). */
async function chatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  // An API call without a session is redirected to the sign-in page.
  if (res.redirected) throw new DoorError("You've been signed out. Sign in again to continue.", "signed_out");
  if (!res.ok) {
    const body = await readError(res, "Something went wrong. Try again.");
    throw new DoorError(body.error, body.code);
  }
  return res;
}

/** The latest conversation; the first time, a new one. */
async function fetchConversation(): Promise<ConversationResponse> {
  const res = await fetch("/api/assistant/conversation");
  if (!res.ok) throw new Error((await readError(res, "Couldn't load the assistant.")).error);
  const data = (await res.json()) as ConversationResponse;
  return data.conversation ? data : createConversation();
}

async function createConversation(): Promise<ConversationResponse> {
  const res = await fetch("/api/assistant/conversation", { method: "POST" });
  if (!res.ok) throw new Error((await readError(res, "Couldn't start a new chat.")).error);
  return (await res.json()) as ConversationResponse;
}

// One Chat per conversation, kept while the app runs: closing the panel
// mid-stream keeps the stream and the messages.
const chats = new Map<string, Chat<AssistantUIMessage>>();
// The newest version of each conversation this tab has seen (its length in
// stored messages): a server copy older than that is a fetch that started
// before a turn ended here, and is skipped.
const versions = new Map<string, number>();

function seen(conversationId: string, version: number | undefined) {
  if (version !== undefined && version > (versions.get(conversationId) ?? -1)) versions.set(conversationId, version);
}

/** Called on sign-out: the next account on this device starts clean. */
export function resetAssistantChat(queryClient?: QueryClient) {
  chats.clear();
  versions.clear();
  queryClient?.removeQueries({ queryKey: ["assistant"] });
}

function requestBody(conversationId: string, messages: AssistantUIMessage[], intent: SendIntent | undefined): ChatRequestBody {
  const last = messages.at(-1);
  if (intent?.intent === "retry") return { conversationId, input: { kind: "retry" } };
  if (intent?.intent === "approval" && last) {
    // The answers to the cards of the paused call.
    const decisions = Object.fromEntries(
      lastStepToolParts(last).flatMap((p) => (p.state === "approval-responded" ? [[p.toolCallId, p.approval.approved]] : []))
    );
    return { conversationId, input: { kind: "approval", decisions } };
  }
  const text = (last?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  return {
    conversationId,
    input: { kind: "message", text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
}

function chatFor(conversationId: string, data: ConversationResponse, queryClient: QueryClient) {
  let chat = chats.get(conversationId);
  if (!chat) {
    seen(conversationId, data.version);
    chat = new Chat<AssistantUIMessage>({
      id: conversationId,
      messages: data.messages,
      transport: new DefaultChatTransport<AssistantUIMessage>({
        api: "/api/assistant/chat",
        fetch: chatFetch,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: requestBody(conversationId, messages, body as SendIntent | undefined),
        }),
      }),
      onFinish: ({ message }) => {
        seen(conversationId, outcomeOf(message)?.version);
        // A saved change: refresh what the user may be looking at.
        const wrote = message.parts.some(
          (p) => p.type === "dynamic-tool" && p.state === "output-available" && p.approval?.approved
        );
        if (wrote) {
          for (const key of ["places", "lists", "plans", "visits", "tags"]) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
        // After every request — done, broken off or refused before it
        // started (a DoorError: nothing written, the cards may have
        // changed): the server's copy says for sure.
        void queryClient.invalidateQueries({ queryKey: CONVERSATION_KEY });
      },
    });
    chats.set(conversationId, chat);
  }
  return chat;
}

/** The last message without its outcome note: a turn that carries it on
 *  writes a new one at the end. */
function withoutOutcome(messages: AssistantUIMessage[]): AssistantUIMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.parts.some((p) => p.type === "data-turn")) return messages;
  return [...messages.slice(0, -1), { ...last, parts: last.parts.filter((p) => p.type !== "data-turn") }];
}

export function AssistantPanel() {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="data-[side=right]:w-full data-[side=right]:sm:max-w-md gap-0 p-0">
        {open && <PanelBody />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: CONVERSATION_KEY,
    queryFn: fetchConversation,
    refetchOnWindowFocus: false,
    // A turn running elsewhere (another tab, a closed panel): check until it ends.
    refetchInterval: (q) => (q.state.data?.conversation?.turnInProgress ? 3000 : false),
  });
  const newChat = useMutation({
    mutationFn: createConversation,
    onSuccess: (data) => queryClient.setQueryData(CONVERSATION_KEY, data),
  });

  const data = query.data;
  return (
    <>
      <SheetHeader className="flex-row items-center justify-between border-b py-3 pr-12">
        <SheetTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden />
          Assistant
        </SheetTitle>
        {data && data.messages.length > 0 && (
          <button
            type="button"
            onClick={() => newChat.mutate()}
            disabled={newChat.isPending}
            className="flex min-h-11 items-center gap-1 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors"
          >
            {newChat.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
            New chat
          </button>
        )}
      </SheetHeader>

      {query.isPending ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          Loading your conversation…
        </div>
      ) : query.isError || !data?.conversation ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground" role="alert">
          {query.error?.message ?? "Couldn't load the assistant."}
          <Button variant="outline" size="sm" className="min-h-11 cursor-pointer" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <ConversationView
          key={data.conversation.id}
          conversationId={data.conversation.id}
          data={data}
          dataUpdatedAt={query.dataUpdatedAt}
          turnElsewhere={data.conversation.turnInProgress}
        />
      )}
    </>
  );
}

function ConversationView({
  conversationId,
  data,
  dataUpdatedAt,
  turnElsewhere,
}: {
  conversationId: string;
  data: ConversationResponse;
  dataUpdatedAt: number;
  turnElsewhere: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const setOpen = useAssistantStore((s) => s.setOpen);
  const [chat] = useState(() => chatFor(conversationId, data, queryClient));
  const { messages, setMessages, sendMessage, status, error, clearError, addToolApprovalResponse } = useChat({ chat });
  const [input, setInput] = useState(() => useAssistantStore.getState().takeDraft() ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedAt = useRef(0);

  const busy = status === "submitted" || status === "streaming";

  // The server's copy wins whenever nothing is streaming here — unless it
  // is older than what this tab has streamed (it will be fetched again).
  useEffect(() => {
    if (busy || dataUpdatedAt === appliedAt.current) return;
    appliedAt.current = dataUpdatedAt;
    if (data.version < (versions.get(conversationId) ?? -1)) return;
    seen(conversationId, data.version);
    setMessages(data.messages);
  }, [busy, conversationId, data.messages, data.version, dataUpdatedAt, setMessages]);

  // A request written by another screen while the panel is open.
  useEffect(
    () =>
      useAssistantStore.subscribe((s) => {
        if (s.draft !== null) setInput(useAssistantStore.getState().takeDraft() ?? "");
      }),
    []
  );

  // Keep the newest content in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const last = messages.at(-1);
  const waitingCards =
    last?.role === "assistant" ? lastStepToolParts(last).filter((p) => p.state === "approval-requested") : [];
  const locked = busy || turnElsewhere;

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    clearError();
    if (waitingCards.length && last) {
      // Writing instead of answering: the cards close, nothing is saved.
      const ids = new Set(waitingCards.map((p) => p.toolCallId));
      setMessages(
        messages.map((m) =>
          m === last
            ? {
                ...m,
                parts: m.parts.map((p) =>
                  p.type === "dynamic-tool" && ids.has(p.toolCallId) && p.state === "approval-requested"
                    ? ({ ...p, state: "output-denied", approval: { id: p.approval.id, approved: false } } as DynamicToolUIPart)
                    : p
                ),
              }
            : m
        )
      );
    }
    setInput("");
    await sendMessage({ text: trimmed });
    if (chat.error instanceof DoorError) {
      // Not sent: the message goes back where the user wrote it.
      setMessages(chat.messages.at(-1)?.role === "user" ? chat.messages.slice(0, -1) : chat.messages);
      setInput((current) => current || trimmed);
    }
  }

  async function answer(approvalId: string, approved: boolean) {
    if (locked) return;
    await addToolApprovalResponse({ id: approvalId, approved });
    // Sent once every card of the paused call has its answer.
    if (!approvalsAnswered({ messages: chat.messages })) return;
    clearError();
    setMessages(withoutOutcome(chat.messages));
    await sendMessage(undefined, { body: { intent: "approval" } satisfies SendIntent });
  }

  async function retry() {
    if (locked) return;
    clearError();
    setMessages(withoutOutcome(chat.messages));
    await sendMessage(undefined, { body: { intent: "retry" } satisfies SendIntent });
  }

  function showOnMap(ids: string[]) {
    setOpen(false);
    router.push(`/map?ids=${ids.join(",")}`);
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label="Conversation with the assistant"
      >
        {messages.length === 0 && (
          <div className="space-y-4 pt-8 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-emerald-600/50" aria-hidden />
            <div className="space-y-1 px-6">
              <p className="text-sm font-medium">Ask about your places</p>
              <p className="text-sm text-muted-foreground">
                Search your saved places, plan an outing, keep a list, or log where you went.
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 px-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void send(example)}
                  disabled={locked}
                  className="min-h-11 rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} message={message} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              streaming={busy && message === last}
              locked={locked}
              onAnswer={(id, approved) => void answer(id, approved)}
              onShowOnMap={showOnMap}
              onRetry={() => void retry()}
            />
          )
        )}

        {(status === "submitted" || (status === "streaming" && last?.role === "assistant" && !hasVisible(last))) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Thinking…
          </div>
        )}

        {turnElsewhere && !busy && (
          <TurnNote
            outcome={{ status: "error", code: "turn_in_progress", message: "" }}
            locked
            onRetry={() => undefined}
          />
        )}

        {error && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
            role="alert"
          >
            {error instanceof DoorError ? error.message : "Couldn't reach the assistant. Check your connection and try again."}
          </div>
        )}
      </div>

      <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {waitingCards.length > 0 && (
          <p className="mb-2 text-xs text-muted-foreground">
            Answer the card above, or write a new message — the proposal won&apos;t be saved.
          </p>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask your assistant…"
            aria-label="Message the assistant"
            maxLength={8000}
            className="min-h-11 max-h-40 resize-none text-base sm:text-sm"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || locked}
            className="h-11 w-11 shrink-0 cursor-pointer"
            aria-label="Send"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          </Button>
        </form>
      </div>
    </>
  );
}

function outcomeOf(message: AssistantUIMessage): TurnOutcome | undefined {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type === "data-turn") return part.data;
  }
  return undefined;
}

function hasVisible(message: AssistantUIMessage): boolean {
  return message.parts.some((p) => (p.type === "text" && p.text.trim() !== "") || isToolUIPart(p));
}

function UserBubble({ message }: { message: AssistantUIMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  if (!text) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-emerald-600 px-3.5 py-2 text-sm text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
  locked,
  onAnswer,
  onShowOnMap,
  onRetry,
}: {
  message: AssistantUIMessage;
  /** This message is being written now. */
  streaming: boolean;
  /** A reply is being written (here or elsewhere): cards and Try again wait. */
  locked: boolean;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onShowOnMap: (ids: string[]) => void;
  onRetry: () => void;
}) {
  // Reads made with a write wait for the card's answer.
  const step = lastStepToolParts(message);
  const cardWaits = step.some((p) => p.state === "approval-requested");
  const waiting = new Set(cardWaits ? step.flatMap((p) => (p.state === "input-available" ? [p.toolCallId] : [])) : []);
  // The saved places the reply links to — once it's written.
  const linked = streaming
    ? []
    : placeIdsIn(
        message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
        window.location.origin
      );
  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") return part.text.trim() ? <AssistantMarkdown key={i} text={part.text} /> : null;
        if (part.type === "dynamic-tool") {
          return isWritePart(part) ? (
            <ChangeCard key={part.toolCallId} part={part} locked={locked} othersWaiting={cardWaits} onAnswer={onAnswer} />
          ) : (
            <ToolRow key={part.toolCallId} part={part} waiting={waiting.has(part.toolCallId)} locked={locked} onShowOnMap={onShowOnMap} />
          );
        }
        if (part.type === "data-turn") return <TurnNote key={i} outcome={part.data} locked={locked} onRetry={onRetry} />;
        return null;
      })}
      {linked.length > 0 && (
        <MapButton
          ids={linked}
          label={linked.length === 1 ? "Show on map" : `Show these ${linked.length} on map`}
          onShowOnMap={onShowOnMap}
        />
      )}
    </div>
  );
}
