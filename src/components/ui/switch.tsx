"use client";

import { cn } from "@/lib/utils";

/**
 * An on/off switch — the one shape every setting uses (Settings → AI,
 * Notifications). A button with role="switch"; give it an `aria-label`, or
 * an `id` that a <label htmlFor> names (a label's click toggles it too, and
 * makes the whole row the touch target).
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200",
        // An invisible 44 px tall touch area around the 24 px track.
        "before:absolute before:inset-x-0 before:-inset-y-2.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-emerald-600" : "bg-gray-200 dark:bg-gray-700",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
