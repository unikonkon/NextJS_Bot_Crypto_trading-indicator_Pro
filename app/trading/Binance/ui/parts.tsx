"use client";

import type { ReactNode } from "react";
import { CheckCircle, Info, Warning, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** A numbered step / titled block */
export function Section({ step, title, desc, action, children, className, done }: {
  step?: number;
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  done?: boolean;
}) {
  return (
    <section className={cn("border bg-card", className)}>
      <header className="flex items-start gap-3 border-b px-4 py-3">
        {step !== undefined && (
          <span className={cn(
            "grid size-6 shrink-0 place-items-center text-[11px] font-bold tabular-nums",
            done ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
          )}>
            {done ? <CheckCircle size={14} weight="bold" /> : step}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-6">{title}</h2>
          {desc && <p className="text-[11px] leading-snug text-muted-foreground">{desc}</p>}
        </div>
        {action}
      </header>
      {children !== undefined && <div className="p-4">{children}</div>}
    </section>
  );
}

const TONE = {
  info: { box: "border-sky-500/30 bg-sky-500/5", text: "text-sky-600 dark:text-sky-400", Icon: Info },
  warn: { box: "border-amber-500/30 bg-amber-500/5", text: "text-amber-600 dark:text-amber-400", Icon: Warning },
  danger: { box: "border-red-500/30 bg-red-500/5", text: "text-red-600 dark:text-red-400", Icon: XCircle },
  success: { box: "border-emerald-500/30 bg-emerald-500/5", text: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle },
} as const;

export function Notice({ tone = "info", title, children, className }: {
  tone?: keyof typeof TONE;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("flex gap-2.5 border p-3", t.box, className)}>
      <t.Icon size={16} weight="fill" className={cn("mt-px shrink-0", t.text)} />
      <div className="min-w-0 space-y-1 text-[11px] leading-relaxed">
        {title && <p className={cn("font-semibold", t.text)}>{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[11px] font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[10px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, className, valueClass }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; valueClass?: string }) {
  return (
    <div className={cn("bg-background px-3 py-2.5", className)}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", valueClass)}>{value}</p>
      {sub && <p className="text-[10px] tabular-nums text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Empty / placeholder block */
export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed px-4 py-8 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="text-xs font-medium">{title}</p>
      {children && <div className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

export const selectClass =
  "h-9 w-full border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring disabled:opacity-50 dark:bg-input/30";

export function fmtQty(v: string | number, max = 8): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export function fmtUsd(n: number, dec = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtTime(ts: number, withDate = true): string {
  return new Date(ts).toLocaleString("th-TH", withDate
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtCountdown(ms: number): string {
  if (!(ms > 0)) return "ตอนนี้";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m}:${String(sec).padStart(2, "0")} นาที`;
  return `${sec} วินาที`;
}
