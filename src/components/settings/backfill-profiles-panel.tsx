"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useBackfillEligibility,
  useStartBackfill,
} from "@/lib/hooks/use-backfill-profiles";

/** Wall-clock between auto-iteration POSTs. Long enough that the previous
 *  chunk's fire-and-forget jobs have a real chance to land (step=profile
 *  is ~5s each, step=reviews is ~30s), short enough that the user sees
 *  the count moving. */
const AUTO_ITERATE_DELAY_MS = 12_000;
/** Hard ceiling on auto-iteration. Defends against a server bug that
 *  could otherwise loop forever. 50 × 25 = 1250 places per session — far
 *  more than any realistic user collection. */
const MAX_AUTO_ITERATIONS = 50;

/**
 * Settings → AI: opt-in backfill of AI place_profile for older places.
 *
 * Visible only when AI features are enabled AND the user has places
 * without a profile that CAN be enriched (have CID or reviews).
 * Disappears when there's nothing left to backfill.
 */
export function BackfillProfilesPanel() {
  const { data, isLoading, refetch } = useBackfillEligibility({
    poll: false,
  });
  const start = useStartBackfill();
  const [running, setRunning] = useState(false);
  const iterationsRef = useRef(0);
  const stopRef = useRef(false);

  const eligibleNow = data
    ? data.has_reviews_no_profile + data.has_cid_no_reviews
    : 0;

  // Auto-iterate: while running, poll eligibility every 5s, and re-fire
  // POST every AUTO_ITERATE_DELAY_MS until eligibleNow drops to zero or
  // the safety ceiling trips. Stops cleanly if the user clicks Stop or
  // navigates away.
  useEffect(() => {
    if (!running) return;
    if (eligibleNow === 0) {
      setRunning(false);
      iterationsRef.current = 0;
      toast.success("All places now have AI profiles");
      return;
    }
    const pollT = setInterval(() => {
      void refetch();
    }, 5000);
    const tickT = setInterval(() => {
      if (stopRef.current) return;
      if (iterationsRef.current >= MAX_AUTO_ITERATIONS) {
        setRunning(false);
        toast.error(
          "Backfill paused — too many iterations. Click Generate again to resume."
        );
        return;
      }
      iterationsRef.current += 1;
      start.mutate(undefined, {
        onError: (e) => {
          setRunning(false);
          toast.error(
            e instanceof Error ? e.message : "Backfill iteration failed"
          );
        },
      });
    }, AUTO_ITERATE_DELAY_MS);
    return () => {
      clearInterval(pollT);
      clearInterval(tickT);
    };
  }, [running, eligibleNow, refetch, start]);

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking AI profile coverage…
      </div>
    );
  }
  if (!data) return null;
  if (!data.ai_features_enabled) return null;
  if (eligibleNow === 0 && data.no_cid_no_profile === 0) return null;

  function handleStart() {
    stopRef.current = false;
    iterationsRef.current = 1;
    start.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(
          `Queued ${res.queued} place${res.queued === 1 ? "" : "s"} for AI profile generation. ` +
            (res.has_more
              ? `${res.remaining_after} more will queue automatically.`
              : "Done — watch the count.")
        );
        if (res.has_more) setRunning(true);
        else void refetch();
      },
      onError: (e) => {
        toast.error(e instanceof Error ? e.message : "Backfill failed");
      },
    });
  }

  function handleStop() {
    stopRef.current = true;
    setRunning(false);
    toast.info("Backfill paused. Already-queued jobs will still finish.");
  }

  const isBusy = start.isPending || running;

  return (
    <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/30 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-semibold">Generate AI profiles for older places</h3>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong className="font-medium text-foreground">{eligibleNow}</strong>{" "}
          of <strong className="font-medium text-foreground">{data.total_places}</strong>{" "}
          places don&apos;t have an AI profile yet. Generating profiles
          improves AI search results (better ranking, accurate atmosphere/
          occasion matching).
        </p>

        <ul className="space-y-0.5 ml-3 list-disc marker:text-muted-foreground/60">
          {data.has_reviews_no_profile > 0 && (
            <li>
              <span className="font-medium text-foreground">
                {data.has_reviews_no_profile}
              </span>{" "}
              already have reviews — Gemini Flash only.
            </li>
          )}
          {data.has_cid_no_reviews > 0 && (
            <li>
              <span className="font-medium text-foreground">
                {data.has_cid_no_reviews}
              </span>{" "}
              need reviews first — DataForSEO then Gemini Flash.
            </li>
          )}
          {data.no_cid_no_profile > 0 && (
            <li className="text-muted-foreground/80">
              <span className="font-medium">{data.no_cid_no_profile}</span>{" "}
              can&apos;t be enriched (no Google CID). Skipped.
            </li>
          )}
        </ul>

        <p className="flex items-center gap-1.5 pt-1">
          <Info className="h-3 w-3" />
          Estimated cost:{" "}
          <strong className="font-medium text-foreground">
            ${data.estimated_cost_usd.toFixed(2)}
          </strong>{" "}
          at current Gemini Flash + DataForSEO rates. Tracked in the cost
          tracker like any other AI call.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleStart}
          disabled={isBusy || eligibleNow === 0}
          className="cursor-pointer gap-1.5"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {running ? `${eligibleNow} remaining…` : "Queueing…"}
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Generate ({eligibleNow})
            </>
          )}
        </Button>
        {running && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              className="cursor-pointer"
            >
              Stop
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Background work — safe to navigate away.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
