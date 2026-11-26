"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Tailwind classes applied when this option is active */
  activeClass?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md" | "lg";
  className?: string;
  "aria-label"?: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = "md", className, ...rest }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={rest["aria-label"]} className={cn("grid auto-cols-fr grid-flow-col gap-px bg-border p-px", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 whitespace-nowrap px-2 font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring",
              size === "sm" && "h-7 text-[11px]",
              size === "md" && "h-9 text-xs",
              size === "lg" && "h-11 text-sm",
              active ? (o.activeClass ?? "bg-primary text-primary-foreground") : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
