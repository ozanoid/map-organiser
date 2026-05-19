"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, X, HelpCircle, Filter } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useAiSearch } from "@/lib/hooks/use-ai-search";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";
import { useTags } from "@/lib/hooks/use-tags";
import { useLists } from "@/lib/hooks/use-lists";
import { useSubcategories } from "@/lib/hooks/use-subcategories";
import { useFilters } from "@/lib/hooks/use-filters";

interface AiSettingsState {
  enabled: boolean;
  available: boolean;
}

/**
 * Phase 6 — natural-language search input.
 *
 * Lives at the top of the FilterPanel. On submit:
 *   1. POST /api/ai/parse-query
 *   2. Apply returned filters via useFilters
 *   3. If requires_semantic_ranking, the orchestrator (mounted in
 *      MapContent) fires rank-results once the new places list settles.
 *
 * Hidden when profiles.ai_features_enabled = false OR when the deployment
 * has no GOOGLE_GENERATIVE_AI_API_KEY (the same gate as Settings → AI).
 */
export function AiSearchInput() {
  const [aiSettings, setAiSettings] = useState<AiSettingsState | null>(null);
  const [draft, setDraft] = useState("");
  const search = useAiSearch();
  const rerankStatus = useAiSearchStore((s) => s.rerankStatus);
  const clarification = useAiSearchStore((s) => s.clarification);
  const lastQuery = useAiSearchStore((s) => s.lastQuery);
  const boosts = useAiSearchStore((s) => s.boosts);
  const reset = useAiSearchStore((s) => s.reset);
  const { setFilters } = useFilters();
  const { data: tags = [] } = useTags();
  const { data: lists = [] } = useLists();
  const { data: subcategories = [] } = useSubcategories();

  // Resolve boost IDs to chip labels. Memoised so re-renders don't churn.
  const hintChips = useMemo(() => {
    const chips: { kind: "tag" | "list" | "subcategory"; id: string; label: string }[] = [];
    if (boosts.matching_tag_ids.length) {
      for (const id of boosts.matching_tag_ids) {
        const t = tags.find((x) => x.id === id);
        if (t) chips.push({ kind: "tag", id, label: t.name });
      }
    }
    if (boosts.matching_list_ids.length) {
      for (const id of boosts.matching_list_ids) {
        const l = lists.find((x) => x.id === id);
        if (l) chips.push({ kind: "list", id, label: l.name });
      }
    }
    if (boosts.matching_subcategory_ids.length) {
      for (const id of boosts.matching_subcategory_ids) {
        const s = subcategories.find((x) => x.id === id);
        if (s) chips.push({ kind: "subcategory", id, label: s.name });
      }
    }
    return chips;
  }, [boosts, tags, lists, subcategories]);

  function applyHintAsFilter(chip: (typeof hintChips)[number]) {
    if (chip.kind === "tag") {
      setFilters({ tag_ids: [chip.id] });
    } else if (chip.kind === "list") {
      setFilters({ list_id: chip.id });
    } else {
      setFilters({ subcategory_ids: [chip.id] });
    }
  }

  // Lazy fetch the AI toggle status once. We don't subscribe to changes —
  // the user has to refresh after toggling, same pattern as ai-settings.tsx.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/ai-settings");
        if (!res.ok) return;
        const data = (await res.json()) as AiSettingsState;
        if (!cancelled) setAiSettings(data);
      } catch {
        // Silent fail — the input just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide entirely until we know the user has AI on AND it's available.
  if (!aiSettings) return null;
  if (!aiSettings.enabled || !aiSettings.available) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    if (q.length > 200) {
      toast.error("Query is too long (max 200 chars).");
      return;
    }
    search.mutate(q, {
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Couldn't understand that query."
        );
      },
    });
  }

  function handleClear() {
    setDraft("");
    reset();
    // Clear the AI-imposed sort override so the FilterPanel dropdown
    // returns to user control.
    setFilters({ sort: undefined });
  }

  const isParsing = search.isPending;
  const isReranking = rerankStatus === "pending";
  const showSpinner = isParsing || isReranking;

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-600 pointer-events-none" />
          <Input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            placeholder="Try: cozy cafes for remote work"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            disabled={isParsing}
            className="pl-9 pr-9"
            aria-label="AI natural-language search"
          />
          {showSpinner ? (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          ) : lastQuery ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear AI search"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </form>

      {lastQuery && !isParsing && (
        <div className="text-[11px] text-muted-foreground italic">
          AI search: <span className="font-medium">&ldquo;{lastQuery}&rdquo;</span>
          {rerankStatus === "ready" && " · ranked"}
          {rerankStatus === "failed" && (
            <span className="text-amber-600">
              {" · "}AI ranking unavailable
            </span>
          )}
        </div>
      )}

      {clarification && !isParsing && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-md">
          <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{clarification}</span>
        </div>
      )}

      {/* Hint chips: the LLM saw a semantic match with curated taxonomy but
          chose not to hard-filter (preserves discovery). User can opt in. */}
      {hintChips.length > 0 && !isParsing && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Filter className="h-3 w-3" />
            <span>You have curated items that may match. Narrow further?</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hintChips.map((chip) => (
              <button
                key={`${chip.kind}-${chip.id}`}
                type="button"
                onClick={() => applyHintAsFilter(chip)}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer transition-colors"
                aria-label={`Filter by ${chip.kind} ${chip.label}`}
              >
                <span className="text-[9px] uppercase tracking-wide text-emerald-600/70 dark:text-emerald-500/70">
                  {chip.kind === "subcategory" ? "sub-cat" : chip.kind}
                </span>
                <span className="font-medium">{chip.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
