"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet on mobile, right-side drawer on ≥ sm screens.
 * Closes on Escape and backdrop click; locks page scroll while open.
 */
export function Sheet({ open, onClose, title, description, children, footer, className }: SheetProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 animate-in fade-in-0" onClick={onClose} />
      <div
        className={cn(
          "absolute flex flex-col bg-background text-foreground ring-1 ring-foreground/10 shadow-xl",
          "inset-x-0 bottom-0 max-h-[88dvh] animate-in slide-in-from-bottom-8",
          "sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:slide-in-from-bottom-0 sm:slide-in-from-right-8",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 grid size-9 shrink-0 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
