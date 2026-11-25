"use client";

import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface UsageItem {
  sku: string;
  name: string;
  count: number;
  freeLimit: number;
  costPer1k: number;
  estimatedCost: number;
}

interface UsageData {
  month: string;
  usage: UsageItem[];
  /** Every Claude call this month (one ledger): dollars, the platform-wide
   *  cap, where background work (profiles, Instagram reads) stops, and what
   *  each purpose took. */
  assistant?: {
    spentUsd: number;
    capUsd: number;
    backgroundCapUsd?: number;
    byPurpose?: Partial<Record<"chat" | "profile" | "instagram" | "eval", number>>;
  };
  totalEstimatedCost: number;
}

export function CostTracker() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/user/usage")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">Failed to load usage data</p>
    );
  }

  const monthLabel = new Date(data.month + "-01").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Usage This Month</h3>
        <p className="text-xs text-muted-foreground">{monthLabel}</p>
      </div>

      <div className="space-y-3">
        {data.assistant && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Claude</span>
              <span className="text-muted-foreground">
                ${data.assistant.spentUsd.toFixed(2)} / ${data.assistant.capUsd.toFixed(0)} cap
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  data.assistant.spentUsd >= data.assistant.capUsd
                    ? "bg-red-500"
                    : data.assistant.spentUsd > data.assistant.capUsd * 0.8
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, (data.assistant.spentUsd / data.assistant.capUsd) * 100)}%` }}
              />
            </div>
            {data.assistant.byPurpose && (
              <p className="text-[11px] text-muted-foreground">
                {(
                  [
                    ["chat", "Assistant"],
                    ["profile", "Profiles"],
                    ["instagram", "Instagram"],
                    ["eval", "Evals"],
                  ] as const
                )
                  .filter(([key]) => (data.assistant?.byPurpose?.[key] ?? 0) > 0)
                  .map(([key, label]) => `${label} $${(data.assistant?.byPurpose?.[key] ?? 0).toFixed(2)}`)
                  .join(" · ") || "Nothing yet this month"}
              </p>
            )}
            {data.assistant.backgroundCapUsd !== undefined &&
              data.assistant.backgroundCapUsd < data.assistant.capUsd && (
                <p
                  className={`text-[11px] ${
                    data.assistant.spentUsd >= data.assistant.backgroundCapUsd
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {data.assistant.spentUsd >= data.assistant.backgroundCapUsd
                    ? `Profiles and Instagram reads are paused until the 1st: the last $${(
                        data.assistant.capUsd - data.assistant.backgroundCapUsd
                      ).toFixed(0)} is kept for the assistant.`
                    : `Profiles and Instagram reads stop at $${data.assistant.backgroundCapUsd.toFixed(
                        0
                      )}; the rest is kept for the assistant.`}
                </p>
              )}
          </div>
        )}
        {data.usage.map((item) => {
          const percentage = item.freeLimit > 0
            ? Math.min(100, (item.count / item.freeLimit) * 100)
            : 0;
          const isOver = item.count > item.freeLimit;
          const isNear = percentage > 80;

          const barColor = isOver
            ? "bg-red-500"
            : isNear
              ? "bg-amber-500"
              : "bg-emerald-500";

          return (
            <div key={item.sku} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground">
                  {item.count.toLocaleString()} / {item.freeLimit.toLocaleString()} free
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              {item.estimatedCost > 0 && (
                <p className="text-[10px] text-red-500">
                  ${item.estimatedCost.toFixed(2)} estimated
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Estimated Total</span>
          <span
            className={
              data.totalEstimatedCost > 0
                ? "text-red-500 font-semibold"
                : "text-emerald-600 font-semibold"
            }
          >
            ${data.totalEstimatedCost.toFixed(2)}
          </span>
        </div>
        {data.totalEstimatedCost === 0 && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Within free tier
          </p>
        )}
      </div>
    </div>
  );
}
