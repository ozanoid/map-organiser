"use client";

import Link from "next/link";
import type { DynamicToolUIPart } from "ai";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Globe,
  Library,
  ListChecks,
  Loader2,
  type LucideIcon,
  Map as MapIcon,
  MapPin,
  MessageSquareQuote,
  Scale,
  Search,
  Sparkles,
  Footprints,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubjectPart, ToolMetadata, ToolSummary, TurnOutcome, WritePreview } from "@/lib/agent/ui-types";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * The pieces of an assistant reply other than its text: a row per tool the
 * assistant used (taslak A), a card per change it proposes (taslak B/C) and
 * the turn's outcome when it isn't a plain answer (taslak D).
 */

/** Presentation only — what each read tool is called while it runs. */
const READ_TOOLS: Record<string, { icon: LucideIcon; running: string; done: string }> = {
  get_library_overview: { icon: Library, running: "Checking your library", done: "Checked your library" },
  search_places: { icon: Search, running: "Searching your places", done: "Searched your places" },
  rank_places: { icon: Sparkles, running: "Reading place profiles", done: "Read place profiles" },
  get_places: { icon: MapPin, running: "Reading place details", done: "Read place details" },
  read_reviews: { icon: MessageSquareQuote, running: "Reading reviews", done: "Read reviews" },
  get_visits: { icon: Footprints, running: "Checking your visits", done: "Checked your visits" },
  get_plans: { icon: CalendarDays, running: "Checking your plans", done: "Checked your plans" },
  get_lists: { icon: ListChecks, running: "Checking your lists", done: "Checked your lists" },
  search_google_maps: { icon: MapIcon, running: "Searching Google Maps", done: "Searched Google Maps" },
  web_search: { icon: Globe, running: "Searching the web", done: "Searched the web" },
};

/** What a saved change is called when its card has no preview (a card
 *  answered before the panel was reloaded). */
const SAVED_LABEL: Record<string, string> = {
  add_places: "Places added",
  create_plan: "Plan saved",
  update_plan: "Plan changed",
  send_plan: "Plan sent",
  save_list: "List saved",
  log_visit: "Visit logged",
  delete_visit: "Visit deleted",
  update_places: "Places updated",
};

/** A change the user decides on — the server marks the tools that save
 *  something; the panel keeps no list of them. */
export function isWritePart(part: DynamicToolUIPart): boolean {
  return (part.toolMetadata as ToolMetadata | undefined)?.write === true;
}

const summaryOf = (part: DynamicToolUIPart): ToolSummary | undefined =>
  part.state === "output-available" ? (part.output as ToolSummary) : undefined;

// ── Tool rows (taslak A) ─────────────────────────────────────────────

export function ToolRow({
  part,
  waiting,
  locked,
  onShowOnMap,
}: {
  part: DynamicToolUIPart;
  /** The call waits for the user's answer to a card in the same step. */
  waiting: boolean;
  /** A reply is being written: a call without a result is running. */
  locked: boolean;
  onShowOnMap: (ids: string[]) => void;
}) {
  const meta = READ_TOOLS[part.toolName] ?? { icon: Wrench, running: "Working", done: "Done" };
  const Icon = meta.icon;
  const summary = summaryOf(part);
  const query =
    part.toolName === "web_search" && part.input && typeof part.input === "object"
      ? String((part.input as { query?: unknown }).query ?? "")
      : "";

  // No result, no card to wait for, no reply being written: the turn
  // stopped before this ran (its note says why).
  const stopped = !locked && !waiting && (part.state === "input-available" || part.state === "input-streaming");
  if (part.state === "output-error" || part.state === "output-denied" || stopped) {
    return (
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {part.state === "output-error" ? `${meta.running} didn't work` : `Skipped: ${meta.running.toLowerCase()}`}
        </span>
      </div>
    );
  }

  const done = part.state === "output-available";
  const places = summary?.places ?? [];
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        {done ? (
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        ) : waiting ? (
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        )}
        <span>
          {done ? meta.done : waiting ? `${meta.running} after your answer` : `${meta.running}…`}
          {query ? <span className="text-foreground/80"> · “{query}”</span> : null}
          {done && summary?.summary ? <span> · {summary.summary}</span> : null}
        </span>
      </div>
      {done && places.length > 1 && (
        <MapButton ids={places.map((p) => p.id)} label={`Show ${places.length} on map`} indent onShowOnMap={onShowOnMap} />
      )}
      {done && summary?.results && summary.results.length > 0 && (
        <ul className="ml-5.5 space-y-0.5 text-xs">
          {summary.results.slice(0, 3).map((r) => (
            <li key={r.url} className="truncate">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {r.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Show on map": a search's results (on its row), or the saved places a
 * reply links to (under the reply). One button for both.
 */
const SUBJECT_ICON: Record<SubjectPart["kind"], LucideIcon> = { plan: CalendarDays, places: Scale, view: MapIcon };

/**
 * What a request is about — the plan, the places compared, the map — on
 * the message the user sent and, before sending, in the composer, where it
 * can be taken off.
 */
export function SubjectChip({ part, onRemove }: { part: SubjectPart; onRemove?: () => void }) {
  const Icon = SUBJECT_ICON[part.kind];
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{part.label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Don't send with ${part.label}`}
          className="relative -mr-1 ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/60 cursor-pointer transition-colors after:absolute after:-inset-3 after:content-['']"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

export function MapButton({
  ids,
  label,
  indent = false,
  onShowOnMap,
}: {
  ids: string[];
  label: string;
  /** Lined up with a tool row's text. */
  indent?: boolean;
  onShowOnMap: (ids: string[]) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onShowOnMap(ids)}
      className={`${indent ? "ml-3.5 " : ""}inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 cursor-pointer transition-colors`}
    >
      <MapIcon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

// ── Change cards (taslak B, C) ───────────────────────────────────────

function PreviewBody({ preview }: { preview: WritePreview }) {
  return (
    <>
      {preview.subtitle && <p className="text-xs text-muted-foreground">{preview.subtitle}</p>}
      <ul className="mt-2 divide-y divide-border/70 border-t border-border/70">
        {preview.lines.map((line, i) =>
          line.heading ? (
            <li key={i} className="pt-2 pb-1 text-xs font-semibold text-muted-foreground">
              {line.label}
              {line.text ? ` · ${line.text}` : ""}
            </li>
          ) : (
            <li key={i} className="flex gap-3 py-1.5 text-sm">
              {line.label && <span className="w-16 shrink-0 font-medium tabular-nums">{line.label}</span>}
              <span className="min-w-0">
                <span className="break-words">{line.text}</span>
                {line.note && <span className="block text-xs text-muted-foreground break-words">{line.note}</span>}
              </span>
            </li>
          )
        )}
      </ul>
      {preview.more ? <p className="pt-1 text-xs text-muted-foreground">+ {preview.more} more</p> : null}
    </>
  );
}

const APPROVE_LABEL: Record<string, string> = {
  add_places: "Add",
  create_plan: "Save plan",
  update_plan: "Apply changes",
  send_plan: "Send",
  save_list: "Save list",
  log_visit: "Log visit",
  delete_visit: "Delete visit",
  update_places: "Update",
};

/** How a card speaks about its change: most save something; send_plan
 *  sends a message. */
const WORDS = {
  save: { doing: "Saving…", will: "Will save", wont: "Won't save", not: "Not saved", failed: "Couldn't save", until: "Nothing is saved until you choose." },
  send: { doing: "Sending…", will: "Will send", wont: "Won't send", not: "Not sent", failed: "Couldn't send", until: "Nothing is sent until you choose." },
} as const;
const wordsFor = (toolName: string) => (toolName === "send_plan" ? WORDS.send : WORDS.save);

export function ChangeCard({
  part,
  locked,
  othersWaiting,
  onAnswer,
}: {
  part: DynamicToolUIPart;
  /** A reply is being written: the card can't be answered until it's done. */
  locked: boolean;
  /** Another card of the same proposal still waits: the answers go together. */
  othersWaiting: boolean;
  onAnswer: (approvalId: string, approved: boolean) => void;
}) {
  const preview = (part.toolMetadata as ToolMetadata | undefined)?.preview;
  const danger = preview?.danger ?? part.toolName === "delete_visit";
  const words = wordsFor(part.toolName);

  if (part.state === "approval-requested") {
    return (
      <div
        className={`rounded-xl border p-3 ${danger ? "border-red-300 dark:border-red-900" : "border-emerald-300 dark:border-emerald-900"}`}
      >
        <p className="text-sm font-semibold">{preview?.title ?? "Save this change?"}</p>
        {preview && <PreviewBody preview={preview} />}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={danger ? "destructive" : "default"}
            className="min-h-11 px-4 cursor-pointer"
            disabled={locked}
            onClick={() => onAnswer(part.approval.id, true)}
          >
            {APPROVE_LABEL[part.toolName] ?? "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 px-4 cursor-pointer"
            disabled={locked}
            onClick={() => onAnswer(part.approval.id, false)}
          >
            Not now
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{words.until}</p>
      </div>
    );
  }

  if (part.state === "approval-responded") {
    const approved = part.approval.approved;
    return othersWaiting ? (
      <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
        {approved ? words.will : words.wont}
        {preview ? ` · ${preview.title}` : ""} — answer the other card to go on.
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {approved ? words.doing : "Skipping…"}
      </div>
    );
  }

  if (part.state === "output-available") {
    const summary = summaryOf(part);
    const link = summary?.link;
    return (
      <div className="rounded-xl border border-emerald-300 p-3 dark:border-emerald-900">
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4" aria-hidden />
          {SAVED_LABEL[part.toolName] ?? "Saved"}
        </p>
        {preview && <p className="mt-0.5 text-xs text-muted-foreground">{preview.title}</p>}
        {/* A send says where it went, and what didn't. */}
        {part.toolName === "send_plan" && summary?.summary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{summary.summary}</p>
        )}
        {link && (
          <LinkOut url={link.url} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
            Open {link.label}
          </LinkOut>
        )}
      </div>
    );
  }

  if (part.state === "output-denied") {
    return (
      <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
        {words.not}
        {preview ? ` · ${preview.title}` : ""}
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="rounded-xl border border-red-300 p-3 text-sm dark:border-red-900" role="alert">
        <p className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4" aria-hidden />
          {words.failed}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">{part.errorText}</p>
      </div>
    );
  }

  // input-streaming / input-available: the card is on its way.
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Preparing a change…
    </div>
  );
}

function LinkOut({ url, className, children }: { url: string; className: string; children: React.ReactNode }) {
  let internal: string | null = null;
  try {
    const u = new URL(url);
    if (typeof window !== "undefined" && u.origin === window.location.origin) internal = `${u.pathname}${u.search}`;
  } catch {
    // not a URL
  }
  // Into the app: the panel closes, so the page isn't hidden behind it.
  return internal ? (
    <Link href={internal} className={className} onClick={() => useAssistantStore.getState().setOpen(false)}>
      {children}
    </Link>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

// ── Turn outcomes (taslak D) ─────────────────────────────────────────

export function TurnNote({
  outcome,
  locked,
  onRetry,
}: {
  outcome: TurnOutcome;
  /** A reply is being written: Try again waits. */
  locked: boolean;
  onRetry: () => void;
}) {
  if (outcome.status === "error") {
    if (outcome.code === "turn_in_progress") {
      return (
        <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          <span>A reply is still being written. It&apos;ll show here when it&apos;s done.</span>
        </div>
      );
    }
    return (
      <div
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        role="alert"
      >
        <p className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{outcome.message}</span>
        </p>
        {outcome.retry && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 min-h-11 cursor-pointer bg-transparent"
            disabled={locked}
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }
  const note =
    outcome.status === "refused"
      ? "Claude couldn't answer this. Try asking another way, or start a new chat."
      : outcome.status === "max_tokens"
        ? "The reply was cut off. Say “continue” to go on."
        : null;
  return note ? <p className="text-xs text-muted-foreground">{note}</p> : null;
}
