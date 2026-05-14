"use client";

import { Check, X, Loader2, Tag, FolderTree, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  useAiSuggestions,
  useAcceptAiSuggestion,
  useRejectAiSuggestion,
  type AiSuggestion,
} from "@/lib/hooks/use-ai-suggestions";

/**
 * AI Suggestions moderation queue.
 *
 * Lives under the AI tab in Settings. Lists pending proposals that the
 * Phase 4 full place_profile pipeline produced for entities the user
 * doesn't already own:
 *   - new tag names (Gemini found them, fuzzy dedup didn't catch them
 *     as variations of existing tags)
 *   - new sub-category slugs (LLM proposed a slug not in the user's
 *     dictionary under the resolved parent category)
 *
 * Accept → creates the entity + attaches to every place that produced
 * the proposal. Reject → status='rejected', vocabulary untouched.
 */
export function AiSuggestionsQueue() {
  const { data: suggestions = [], isLoading } = useAiSuggestions();
  const accept = useAcceptAiSuggestion();
  const reject = useRejectAiSuggestion();

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading suggestions…
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No pending suggestions. AI proposals show up here when the background
        profile pipeline finds tags or sub-categories worth adding to your
        vocabulary.
      </div>
    );
  }

  const tagSuggestions = suggestions.filter((s) => s.type === "tag");
  const subSuggestions = suggestions.filter((s) => s.type === "subcategory");

  const handleAccept = (s: AiSuggestion) => {
    accept.mutate(s.ids[0], {
      onSuccess: (data: unknown) => {
        const d = data as { affected_places?: number };
        toast.success(
          s.type === "tag"
            ? `Tag created and applied to ${d.affected_places ?? 0} places`
            : `Sub-category created and applied to ${d.affected_places ?? 0} places`
        );
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const handleReject = (s: AiSuggestion) => {
    reject.mutate(s.ids[0], {
      onSuccess: () => toast.success("Suggestion rejected"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          <h3 className="text-sm font-semibold">Pending suggestions</h3>
          <span className="text-[10px] text-muted-foreground bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full">
            {suggestions.length}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          AI noticed concepts in your reviews that don&apos;t match your
          current vocabulary. Approve to add them; reject to ignore.
        </p>
      </div>

      {tagSuggestions.length > 0 && (
        <SuggestionGroup
          icon={Tag}
          title={`Tags (${tagSuggestions.length})`}
          items={tagSuggestions}
          onAccept={handleAccept}
          onReject={handleReject}
          accepting={accept.variables}
          rejecting={reject.variables}
          isPending={accept.isPending || reject.isPending}
        />
      )}

      {subSuggestions.length > 0 && (
        <SuggestionGroup
          icon={FolderTree}
          title={`Sub-categories (${subSuggestions.length})`}
          items={subSuggestions}
          onAccept={handleAccept}
          onReject={handleReject}
          accepting={accept.variables}
          rejecting={reject.variables}
          isPending={accept.isPending || reject.isPending}
        />
      )}
    </div>
  );
}

interface SuggestionGroupProps {
  icon: typeof Tag;
  title: string;
  items: AiSuggestion[];
  onAccept: (s: AiSuggestion) => void;
  onReject: (s: AiSuggestion) => void;
  accepting: string | undefined;
  rejecting: string | undefined;
  isPending: boolean;
}

function SuggestionGroup({
  icon: Icon,
  title,
  items,
  onAccept,
  onReject,
  accepting,
  rejecting,
  isPending,
}: SuggestionGroupProps) {
  return (
    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20">
      <div className="px-3 py-2 border-b border-emerald-200 dark:border-emerald-900/50 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          {title}
        </span>
      </div>
      <ul className="divide-y divide-emerald-100 dark:divide-emerald-900/30">
        {items.map((s) => {
          const isAccepting = accepting === s.ids[0];
          const isRejecting = rejecting === s.ids[0];
          return (
            <li
              key={s.key}
              className="px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {s.proposed_value}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {s.parent_category_name && (
                    <span className="mr-2">under {s.parent_category_name}</span>
                  )}
                  proposed by{" "}
                  <span className="font-medium">
                    {s.sample_place_name ?? "a place"}
                  </span>
                  {s.occurrences > 1 && (
                    <>
                      {" "}
                      + {s.occurrences - 1} other place
                      {s.occurrences - 1 === 1 ? "" : "s"}
                    </>
                  )}
                  {" · "}
                  <span>{Math.round(s.confidence * 100)}%</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onReject(s)}
                  disabled={isPending}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer disabled:opacity-40"
                  title="Reject"
                  aria-label="Reject suggestion"
                >
                  {isRejecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onAccept(s)}
                  disabled={isPending}
                  className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs cursor-pointer disabled:opacity-40"
                  title="Accept"
                >
                  {isAccepting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Accept
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
