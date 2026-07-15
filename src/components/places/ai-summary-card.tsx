"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Utensils,
  Wine,
  Bell,
  Sparkles as Atmosphere,
  Coins,
  MapPin,
  Brush,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PlaceProfile } from "@/lib/ai/schemas/place-profile";
import { Skeleton } from "@/components/ui/skeleton";

interface AiSummaryCardProps {
  placeId: string;
  profile?: PlaceProfile | null;
  /** Reviews exist so the LLM has something to chew on. When false, the
   *  "analyzing" pending state is misleading — show a softer message. */
  reviewsAvailable: boolean;
  /** Stored reviews — used to detect a summary that's older than the
   *  newest review (staleness badge). Only publish_time is read. */
  reviews?: Array<{ publish_time?: string }>;
  onRefreshed?: () => void;
}

const THEME_ICON: Record<string, LucideIcon> = {
  food: Utensils,
  drink: Wine,
  service: Bell,
  atmosphere: Atmosphere,
  value: Coins,
  location: MapPin,
  cleanliness: Brush,
  crowd: Users,
};

const SENTIMENT_ICON: Record<string, string> = {
  positive: "👍",
  mixed: "🤔",
  negative: "👎",
};

const SENTIMENT_RING: Record<string, string> = {
  positive: "border-emerald-200 dark:border-emerald-900/50",
  mixed: "border-amber-200 dark:border-amber-900/50",
  negative: "border-rose-200 dark:border-rose-900/50",
};

export function AiSummaryCard({
  placeId,
  profile,
  reviewsAvailable,
  reviews,
  onRefreshed,
}: AiSummaryCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isFull = profile?.completeness === "full";

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/places/${placeId}/enrich?step=profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        throw new Error(body.error ?? body.reason ?? "Failed to refresh");
      }
      onRefreshed?.();
    } catch (e) {
      console.error("[ai-summary] refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  }

  // ─── Skeleton state: no profile or only lite ───
  if (!isFull) {
    if (!reviewsAvailable) {
      return null; // Reviews not in yet — let the existing "loading reviews"
      // banner own this state. Profile card will appear after reviews land.
    }
    // Pre-Phase-4 places have reviews but no auto-trigger ever fired for
    // them. The Generate button gives the user a manual escape hatch
    // (it's also useful when the background chain failed transiently).
    return (
      <section className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI Summary
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Generate AI summary now"
          >
            {refreshing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                analyzing…
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3" />
                generate
              </>
            )}
          </button>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
        <p className="text-[10px] text-muted-foreground pt-1">
          {refreshing
            ? "This usually takes ~5 seconds."
            : "Newly-added places generate automatically. For older places, tap Generate."}
        </p>
      </section>
    );
  }

  // ─── Full profile rendering ───
  const themesShown = (profile.theme_insights ?? []).filter(
    (t) => t.mention_count >= 3
  );

  // Staleness: the newest stored review was published AFTER this summary
  // was generated. The refresh→profile chain normally regenerates
  // automatically; this badge is the safety net for chain failures and
  // legacy data.
  // DataForSEO stamps look like "2026-05-12 03:24:18 +00:00" — not strict
  // ISO, so bare Date.parse is implementation-defined (NaN on some
  // engines, e.g. Safari). Normalize to ISO as a fallback.
  const parseReviewTime = (s: string) => {
    const direct = Date.parse(s);
    if (!Number.isNaN(direct)) return direct;
    return Date.parse(
      s.replace(" ", "T").replace(" +", "+").replace(" -", "-")
    );
  };
  const generatedMs = Date.parse(profile.generated_at);
  const latestReviewMs = (reviews ?? []).reduce((max, r) => {
    if (!r.publish_time) return max;
    const t = parseReviewTime(r.publish_time);
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);
  const summaryStale =
    !Number.isNaN(generatedMs) &&
    latestReviewMs > 0 &&
    latestReviewMs > generatedMs;

  return (
    <section className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          AI Summary
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1 disabled:opacity-50"
          title="Regenerate AI summary"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          refresh
        </button>
      </div>

      {/* Staleness hint — newer reviews exist than this summary covers */}
      {summaryStale && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
          <RefreshCw className="h-2.5 w-2.5 shrink-0" />
          New reviews arrived after this summary — refresh to update it.
        </p>
      )}

      {/* TLDR */}
      {profile.tldr && (
        <p className="text-sm text-foreground leading-relaxed">
          {profile.tldr}
        </p>
      )}

      {/* Pros / Cons two-column */}
      {(profile.pros?.length || profile.cons?.length) && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          {profile.pros && profile.pros.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1.5 font-semibold">
                ✓ Highlights
              </p>
              <ul className="space-y-1">
                {profile.pros.map((item) => (
                  <li
                    key={item}
                    className="text-foreground/90 flex items-start gap-1.5"
                  >
                    <span className="text-emerald-600 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.cons && profile.cons.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5 font-semibold">
                ⚠ Watch out
              </p>
              <ul className="space-y-1">
                {profile.cons.map((item) => (
                  <li
                    key={item}
                    className="text-foreground/90 flex items-start gap-1.5"
                  >
                    <span className="text-amber-600 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Theme insights */}
      {themesShown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Most mentioned ({profile.source_review_count} reviews)
          </p>
          <div className="space-y-1">
            {themesShown.map((t) => {
              const Icon = THEME_ICON[t.theme] ?? Atmosphere;
              const ringClass = SENTIMENT_RING[t.sentiment] ?? "border-gray-200";
              const isOpen = expanded === t.theme;
              return (
                <div
                  key={t.theme}
                  className={`rounded-md border ${ringClass} bg-background/60`}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : t.theme)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer hover:bg-foreground/[0.03]"
                  >
                    <span className="flex items-center gap-2 capitalize">
                      <Icon className="h-3 w-3 text-muted-foreground" />
                      {t.theme}
                      <span aria-hidden="true">{SENTIMENT_ICON[t.sentiment] ?? ""}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.mention_count} mention{t.mention_count === 1 ? "" : "s"}
                    </span>
                  </button>
                  {isOpen && t.evidence_quotes.length > 0 && (
                    <div className="px-3 pb-2 pt-1 space-y-1 border-t border-dashed border-current/10">
                      {t.evidence_quotes.map((q, i) => (
                        <blockquote
                          key={i}
                          className="text-[11px] text-muted-foreground italic leading-relaxed"
                        >
                          &ldquo;{q}&rdquo;
                        </blockquote>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Distinctive features pills (sparse) */}
      {profile.features.distinctive.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {profile.features.distinctive.slice(0, 6).map((f) => (
            <span
              key={f}
              className="px-1.5 py-0.5 rounded-full text-[10px] bg-background/60 border border-emerald-200 dark:border-emerald-900/40 text-foreground/80"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
