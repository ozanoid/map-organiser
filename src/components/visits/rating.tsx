"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A 1–5 rating you can set: tap a star to rate, tap the same star again to
 * clear. Each star is a 36 px button (44 px hit area with the gap).
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}${value === n ? " — tap again to clear" : ""}`}
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
          >
            <Star className={cn("h-5 w-5", on ? "fill-emerald-500 text-emerald-500" : "text-muted-foreground/40")} />
          </button>
        );
      })}
    </div>
  );
}

/** A rating shown, not edited. */
export function RatingStars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn("h-3.5 w-3.5", n <= value ? "fill-emerald-500 text-emerald-500" : "text-muted-foreground/30")}
        />
      ))}
    </span>
  );
}
