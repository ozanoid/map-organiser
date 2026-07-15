"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { Place } from "@/lib/types";

/** Mirror of the route's sanitized CompareOutput (client-side shape). */
interface CompareResult {
  overall: string;
  theme_verdicts: Array<{ theme: string; winner_idx: number; note: string }>;
  pick_by_occasion: Array<{ occasion: string; idx: number; why: string }>;
}

const THEME_LABEL: Record<string, string> = {
  food: "Food",
  drink: "Drinks",
  service: "Service",
  atmosphere: "Atmosphere",
  value: "Value",
  location: "Location",
  cleanliness: "Cleanliness",
  crowd: "Crowd",
};

/**
 * S2 F-04 (v1.19.0) — the AI comparison card on /places/compare.
 *
 * DELIBERATE-CLICK design: the LLM call fires only on the button press,
 * never on page load — each run burns one ai_compare budget unit
 * (200/month cap), and a compare page refresh shouldn't spend money.
 * idx references in the response resolve against the `order` array the
 * route echoes (never against anything the LLM wrote).
 */
export function AiCompareCard({ places }: { places: Place[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [order, setOrder] = useState<string[]>([]);

  async function runCompare() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_ids: places.map((p) => p.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Comparison failed");
        return;
      }
      setResult(data.result);
      setOrder(data.order ?? places.map((p) => p.id));
    } catch {
      toast.error("Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  const nameByIdx = (idx: number): string => {
    const id = order[idx];
    return places.find((p) => p.id === id)?.name ?? `#${idx + 1}`;
  };

  if (!result) {
    return (
      <div className="border rounded-xl p-4 flex items-center justify-between gap-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
        <div className="text-sm">
          <p className="font-medium flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            AI comparison
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Per-theme winners + which place fits which occasion, from the
            stored review profiles.
          </p>
        </div>
        <Button
          size="sm"
          onClick={runCompare}
          disabled={loading}
          className="cursor-pointer gap-1.5 shrink-0"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {loading ? "Comparing..." : "Compare with AI"}
        </Button>
      </div>
    );
  }

  return (
    <div className="border rounded-xl p-4 space-y-4 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
      <p className="text-sm leading-relaxed">{result.overall}</p>

      {result.theme_verdicts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            By theme
          </p>
          <div className="space-y-1">
            {result.theme_verdicts.map((t, i) => (
              <div key={`${t.theme}-${i}`} className="flex items-start gap-2 text-xs">
                <Badge variant="secondary" className="text-[10px] shrink-0 w-20 justify-center">
                  {THEME_LABEL[t.theme] ?? t.theme}
                </Badge>
                <span className="flex items-center gap-1 font-medium shrink-0">
                  <Trophy className="h-3 w-3 text-amber-500" />
                  {nameByIdx(t.winner_idx)}
                </span>
                <span className="text-muted-foreground">{t.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.pick_by_occasion.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Which one, when?
          </p>
          <div className="space-y-1">
            {result.pick_by_occasion.map((o, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Badge className="text-[10px] shrink-0 bg-emerald-600 text-white">
                  {o.occasion}
                </Badge>
                <span className="font-medium shrink-0">{nameByIdx(o.idx)}</span>
                <span className="text-muted-foreground">{o.why}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={runCompare}
        disabled={loading}
        className="text-[11px] text-muted-foreground underline cursor-pointer hover:text-foreground disabled:opacity-50"
      >
        {loading ? "Re-running..." : "Re-run analysis"}
      </button>
    </div>
  );
}
