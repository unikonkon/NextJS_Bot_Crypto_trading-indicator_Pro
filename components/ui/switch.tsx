"use client";

import { cn } from "@/lib/utils";

/** On/off switch (button with role="switch") */
export function Switch({ checked, onChange, disabled, className, "aria-label": ariaLabel }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        className,
      )}
    >
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-background shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}
