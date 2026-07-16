"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAiSearchStore, HIDE_BELOW_SCORE } from "@/lib/stores/ai-search-store";
import { filtersToQueryString } from "@/lib/hooks/use-filters";
import type { PlaceFilters, VisitStatus } from "@/lib/types";
import type { AppliedFilters } from "@/lib/ai/chat-tools";
import { useChat, Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  isToolUIPart,
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
} from "ai";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Loader2,
  Send,
  Square,
  RotateCcw,
  Search,
  BarChart3,
  Scale,
  BookOpen,
  ListPlus,
  Check,
  X,
  Star,
  MapIcon,
  LayoutList,
} from "lucide-react";
import type { ChatPlaceHit } from "@/lib/ai/chat-tools";

/**
 * v1.21.0 (S3 AI-02): the assistant chat panel — a right Sheet on
 * desktop (max-w-md override), full-width on mobile. Session-only
 * memory: the Chat instance lives at module scope, so closing/reopening
 * the panel keeps the conversation; "new chat" swaps in a fresh instance
 * + sessionId (groups Langfuse traces). Nothing is persisted.
 *
 * Mutating tools pause in `approval-requested` — the confirm card here
 * is the action-confirmation UX; approve/deny round-trips via
 * addToolApprovalResponse and sendAutomaticallyWhen resubmits.
 */

function makeChat(sessionId: string) {
  return new Chat<UIMessage>({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { sessionId },
    }),
    // MUST live on the Chat instance: useChat silently ignores every
    // ChatInit option (this one included) when a prebuilt `chat` is
    // passed — hook-level sendAutomaticallyWhen never reaches the
    // instance and the approval flow dies without an error.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
}

let sharedSessionId: string | null = null;
let sharedChat: Chat<UIMessage> | null = null;
let sharedOwnerId: string | null = null;

function getSharedChat(ownerId: string | null) {
  // Module scope survives client-side sign-out/sign-in — bind the
  // conversation to the authenticated user so a shared-device account
  // switch never sees the previous user's chat.
  if (ownerId && sharedOwnerId && sharedOwnerId !== ownerId) {
    sharedChat = null;
    sharedSessionId = null;
  }
  if (ownerId) sharedOwnerId = ownerId;
  if (!sharedChat || !sharedSessionId) {
    sharedSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}`;
    sharedChat = makeChat(sharedSessionId);
  }
  return sharedChat;
}

/** Called on sign-out so the next account on this device starts clean. */
export function resetAssistantChat() {
  sharedChat = null;
  sharedSessionId = null;
  sharedOwnerId = null;
}

const SUGGESTIONS = [
  "Where should I eat in London tonight?",
  "Compare my top 2 rated cafes in Istanbul",
  "How many places have I visited this year?",
];

/** Mutation tools whose success must refresh open views. */
const MUTATION_INVALIDATIONS: Record<string, string[][]> = {
  "tool-add_to_list": [["lists"], ["places"]],
  "tool-create_list": [["lists"]],
  "tool-set_visit_status": [["places"], ["stats"]],
};

const TOOL_LABELS: Record<string, { icon: typeof Search; label: string }> = {
  "tool-search_places": { icon: Search, label: "Searching your places" },
  "tool-rank_places": { icon: Sparkles, label: "Judging matches semantically" },
  "tool-get_place_details": { icon: BookOpen, label: "Reading details" },
  "tool-compare_places": { icon: Scale, label: "Comparing places" },
  "tool-get_stats": { icon: BarChart3, label: "Crunching your stats" },
  "tool-add_to_list": { icon: ListPlus, label: "Adding to list" },
  "tool-create_list": { icon: ListPlus, label: "Creating list" },
  "tool-set_visit_status": { icon: Check, label: "Updating status" },
};

const APPROVAL_DESCRIPTIONS: Record<
  string,
  (input: any) => string
> = {
  "tool-add_to_list": (i) =>
    `Add ${i?.place_ids?.length ?? "?"} place${(i?.place_ids?.length ?? 0) > 1 ? "s" : ""} to a list?`,
  "tool-create_list": (i) =>
    `Create list "${i?.name ?? "…"}"${i?.place_ids?.length ? ` with ${i.place_ids.length} places` : ""}?`,
  "tool-set_visit_status": (i) =>
    `Mark this place as ${i?.status ?? "no status"}?`,
};

export function AssistantPanel({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
}) {
  const [chat, setChat] = useState(() => getSharedChat(userId));
  const { messages, sendMessage, status, stop, error, clearError, addToolApprovalResponse } =
    useChat({ chat });
  const [input, setInput] = useState("");
  const queryClient = useQueryClient();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const invalidatedRef = useRef(new Set<string>());

  const busy = status === "streaming" || status === "submitted";

  // A pending approval must be answered before a new message goes out:
  // convertToModelMessages would otherwise hit a dangling
  // approval-requested tool part and every subsequent turn would fail.
  const pendingApproval = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.parts.some(
      (p) => isToolUIPart(p) && p.state === "approval-requested"
    );
  }, [messages]);

  // Chat-driven mutations bypass the TanStack mutation hooks — refresh
  // affected caches when a mutation tool's output lands.
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts) {
        if (!isToolUIPart(part)) continue;
        const keys = MUTATION_INVALIDATIONS[part.type];
        if (!keys || part.state !== "output-available") continue;
        if (invalidatedRef.current.has(part.toolCallId)) continue;
        invalidatedRef.current.add(part.toolCallId);
        for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
      }
    }
  }, [messages, queryClient]);

  // Pin to bottom on new content while open.
  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, open]);

  function submit() {
    const text = input.trim();
    if (!text || busy || pendingApproval) return;
    clearError();
    sendMessage({ text });
    setInput("");
  }

  function newChat() {
    stop();
    sharedSessionId = null;
    sharedChat = null;
    invalidatedRef.current.clear();
    setChat(getSharedChat(userId));
  }

  /**
   * v1.23.0 parity: push a tool result's full match set into the map or
   * places view. Writes through the SAME ai-search-store the AI search
   * bar uses, so the banner ("query + clear ✕"), card sort/hide, why
   * lines and SaveFilterButton all work unchanged. requires_semantic_
   * ranking is FALSE — rankings (when present) come from the rank tool,
   * so the orchestrator must not fire a second rerank.
   */
  function pushToView(
    target: "map" | "places",
    applied: AppliedFilters,
    opts?: { intent?: string; allRanked?: { id: string; score: number; why: string }[] }
  ) {
    const filters: PlaceFilters = {
      city: applied.city ?? undefined,
      country: applied.country ?? undefined,
      category_ids: applied.category_ids ?? undefined,
      tag_ids: applied.tag_ids ?? undefined,
      list_id: applied.list_id ?? undefined,
      visit_status: (applied.visit_status ?? undefined) as VisitStatus | undefined,
      google_rating_min: applied.google_rating_min ?? undefined,
      open_now: applied.open_now ?? undefined,
      search: applied.search ?? undefined,
      sort: "google_rating_desc",
    };
    const store = useAiSearchStore.getState();
    if (opts?.allRanked?.length && opts.intent) {
      store.applyParse({
        semantic_intent: opts.intent,
        requires_semantic_ranking: false,
        needs_clarification: null,
        query: opts.intent,
        targetFilters: filters,
      });
      store.applyRankings(opts.allRanked);
    } else {
      // Hard-filter push: clear any stale AI-search state so old
      // rankings don't reorder/hide the fresh result set.
      store.reset();
    }
    router.push(`/${target}?${filtersToQueryString(filters)}`);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-md gap-0 p-0"
      >
        <SheetHeader className="flex-row items-center justify-between border-b py-3 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Assistant
          </SheetTitle>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={newChat}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              title="Start a new chat"
            >
              <RotateCcw className="h-3 w-3" />
              New chat
            </button>
          )}
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="pt-8 text-center space-y-4">
              <Sparkles className="h-8 w-8 text-emerald-600/40 mx-auto" />
              <p className="text-sm text-muted-foreground px-6">
                Ask about your saved places — search, compare, add to lists,
                or check your stats.
              </p>
              <div className="flex flex-col items-stretch gap-2 px-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      clearError();
                      sendMessage({ text: s });
                    }}
                    className="text-left text-xs rounded-lg border px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              addToolApprovalResponse={addToolApprovalResponse}
              onPushView={pushToView}
            />
          ))}

          {status === "submitted" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
              {friendlyError(error)}
            </div>
          )}
        </div>

        <div className="border-t p-3">
          {pendingApproval && (
            <p className="text-[11px] text-muted-foreground mb-2">
              Respond to the pending action above first.
            </p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask your assistant…"
              className="min-h-10 max-h-40 text-sm resize-none"
              rows={1}
              disabled={pendingApproval}
            />
            {busy ? (
              <Button
                size="icon"
                variant="outline"
                onClick={() => stop()}
                className="shrink-0 cursor-pointer"
                aria-label="Stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={submit}
                disabled={!input.trim() || pendingApproval}
                className="shrink-0 cursor-pointer"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Message rendering ───────────────────────────────────────────────

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

type PushViewFn = (
  target: "map" | "places",
  applied: AppliedFilters,
  opts?: { intent?: string; allRanked?: { id: string; score: number; why: string }[] }
) => void;

function MessageView({
  message,
  addToolApprovalResponse,
  onPushView,
}: {
  message: UIMessage;
  addToolApprovalResponse: (r: { id: string; approved: boolean }) => void;
  onPushView: PushViewFn;
}) {
  if (message.role === "user") {
    const text = message.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("");
    if (!text) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 text-white text-sm px-3.5 py-2 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => (
        <PartView
          key={i}
          part={part}
          addToolApprovalResponse={addToolApprovalResponse}
          onPushView={onPushView}
        />
      ))}
    </div>
  );
}

function PartView({
  part,
  addToolApprovalResponse,
  onPushView,
}: {
  part: AnyPart;
  addToolApprovalResponse: (r: { id: string; approved: boolean }) => void;
  onPushView: PushViewFn;
}) {
  if (part.type === "text") {
    if (!part.text.trim()) return null;
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        <Bold text={part.text} />
      </div>
    );
  }

  if (!isToolUIPart(part)) return null;

  const meta = TOOL_LABELS[part.type];
  const label = meta?.label ?? "Working";
  const Icon = meta?.icon ?? Sparkles;

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {label}…
        </div>
      );

    case "approval-requested": {
      const describe = APPROVAL_DESCRIPTIONS[part.type];
      return (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-emerald-600" />
            {describe ? describe(part.input) : "Run this action?"}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs gap-1 cursor-pointer"
              onClick={() =>
                addToolApprovalResponse({
                  id: (part as any).approval.id,
                  approved: true,
                })
              }
            >
              <Check className="h-3 w-3" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 cursor-pointer"
              onClick={() =>
                addToolApprovalResponse({
                  id: (part as any).approval.id,
                  approved: false,
                })
              }
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    case "output-available":
      return <ToolResult type={part.type} output={part.output} onPushView={onPushView} />;

    case "output-denied":
      return (
        <div className="text-xs text-muted-foreground italic">
          Action cancelled.
        </div>
      );

    case "output-error":
      return (
        <div className="text-xs text-red-600 dark:text-red-400">
          {label} failed{(part as any).errorText ? `: ${(part as any).errorText}` : ""}.
        </div>
      );

    default:
      return null;
  }
}

/** "Show all on map / as list" row under search/rank results. */
function PushRow({
  count,
  onPush,
}: {
  count: number;
  onPush: (target: "map" | "places") => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex gap-1.5 px-2 py-1.5 border-t bg-muted/30">
      <button
        type="button"
        onClick={() => onPush("map")}
        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors"
      >
        <MapIcon className="h-3 w-3" />
        Show all on map ({count})
      </button>
      <button
        type="button"
        onClick={() => onPush("places")}
        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors"
      >
        <LayoutList className="h-3 w-3" />
        Show as list ({count})
      </button>
    </div>
  );
}

function PlaceHitRows({ hits, showWhy }: { hits: (ChatPlaceHit & { why?: string })[]; showWhy?: boolean }) {
  return (
    <>
      {hits.slice(0, 6).map((p) => (
        <Link
          key={p.id}
          href={`/places/${p.id}`}
          className="flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{p.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {showWhy && p.why
                ? p.why
                : [p.category, p.city].filter(Boolean).join(" · ")}
            </p>
          </div>
          {p.google_rating != null && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              {p.google_rating}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}

function ToolResult({
  type,
  output,
  onPushView,
}: {
  type: string;
  output: unknown;
  onPushView: PushViewFn;
}) {
  const out = output as any;

  if (out && typeof out === "object" && "error" in out && out.error) {
    return (
      <div className="text-xs text-muted-foreground italic">{out.error}</div>
    );
  }

  if (type === "tool-search_places") {
    const hits: ChatPlaceHit[] = out?.places ?? [];
    if (hits.length === 0) return null;
    return (
      <div className="rounded-xl border divide-y overflow-hidden">
        <PlaceHitRows hits={hits} />
        {(out?.total_matches ?? 0) > 6 && (
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
            +{out.total_matches - 6} more
          </p>
        )}
        {out?.applied_filters && (
          <PushRow
            count={out.total_matches ?? hits.length}
            onPush={(target) => onPushView(target, out.applied_filters)}
          />
        )}
      </div>
    );
  }

  // v1.23.0 parity: semantically ranked results — why-lines inline, and
  // the push carries the FULL scored list so map/grid sort/hide/why all
  // match what the AI search bar would have produced. `notice` marks a
  // degraded (rating-order) result: rows + push still render.
  if (type === "tool-rank_places") {
    const hits: (ChatPlaceHit & { why?: string })[] = out?.places ?? [];
    if (hits.length === 0 && !out?.notice) return null;
    const ranked: { score: number }[] | undefined = out?.all_ranked;
    // The pushed view hides judge-scored rows below the threshold —
    // promise the count that will actually be visible.
    const visibleCount = ranked
      ? ranked.filter((r) => r.score >= HIDE_BELOW_SCORE).length
      : out?.total_matches ?? hits.length;
    return (
      <div className="rounded-xl border divide-y overflow-hidden">
        {out?.notice && (
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground italic">
            {out.notice}
          </p>
        )}
        <PlaceHitRows hits={hits} showWhy />
        {visibleCount > 6 && (
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
            +{visibleCount - 6} more · ranked semantically
          </p>
        )}
        {out?.applied_filters && (
          <PushRow
            count={visibleCount}
            onPush={(target) =>
              onPushView(target, out.applied_filters, {
                intent: out.semantic_intent,
                allRanked: out.all_ranked,
              })
            }
          />
        )}
      </div>
    );
  }

  if (type === "tool-add_to_list") {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        ✓ Added {out?.added_count ?? 0} to “{out?.list_name}”
        {out?.already_in_list ? ` (${out.already_in_list} already there)` : ""}
      </p>
    );
  }
  if (type === "tool-create_list") {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        ✓ Created “{out?.list_name}”
        {out?.added_count ? ` with ${out.added_count} places` : ""}
      </p>
    );
  }
  if (type === "tool-set_visit_status") {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        ✓ {out?.place_name}: {out?.status ?? "status cleared"}
      </p>
    );
  }

  // Read-only tools whose data the model verbalises — no card needed.
  return null;
}

/** Renders **bold** spans; everything else is plain text (prompt keeps
 *  the model to bold-only markdown). */
function Bold({ text }: { text: string }) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {segments.map((seg, i) =>
        seg.startsWith("**") && seg.endsWith("**") ? (
          <strong key={i}>{seg.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{seg}</span>
        )
      )}
    </>
  );
}

function friendlyError(error: Error): string {
  // DefaultChatTransport throws with the raw response BODY as the
  // message — match on body content, not status digits.
  const msg = error.message || "";
  if (/limit/i.test(msg))
    return "Monthly AI chat limit reached — resets on the 1st.";
  if (msg.includes("ai_disabled") || msg.includes("ai_unavailable"))
    return "AI features are disabled in Settings.";
  return "Something went wrong. Try again.";
}
