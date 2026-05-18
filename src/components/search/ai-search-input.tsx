"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, X, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useAiSearch } from "@/lib/hooks/use-ai-search";
import { useAiSearchStore } from "@/lib/stores/ai-search-store";

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
  const reset = useAiSearchStore((s) => s.reset);

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
    </div>
  );
}
