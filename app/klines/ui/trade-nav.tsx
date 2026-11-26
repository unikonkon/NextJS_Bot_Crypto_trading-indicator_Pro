"use client";

import { CaretLeft, CaretRight, SkipBack, SkipForward } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Trade } from "@/lib/engine/types";
import { fmtDate, fmtPct } from "../lib/format";

interface Props {
  /** Trades of the current backtest, oldest first (the last may still be open: exitReason "end") */
  trades: Trade[] | null;
  /** Trade focused on the chart */
  current: Trade | null;
  onFocus: (t: Trade) => void;
  /** Fill the row (mobile): wider buttons, labels always shown */
  stretch?: boolean;
  className?: string;
}

const describe = (t: Trade) =>
  `${t.side === "long" ? "Long" : "Short"} · เข้า ${fmtDate(t.entryTime, true)} · ${t.exitReason === "end" ? "ยังถืออยู่" : "ออก"} ${fmtPct(t.pnlPct, 1)}`;

/** Jump between the backtest's entry signals on the chart: first · previous · next · latest */
export function TradeNav({ trades, current, onFocus, stretch, className }: Props) {
  const n = trades?.length ?? 0;
  const idx = current && trades ? trades.indexOf(current) : -1;
  const go = (i: number) => { if (trades && i >= 0 && i < n) onFocus(trades[i]); };
  const btn = cn(
    "flex shrink-0 items-center justify-center gap-1 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
    stretch ? "h-10 flex-1" : "h-8",
  );
  const label = stretch ? "inline" : "hidden sm:inline";

  return (
    <div className={cn("flex shrink-0 items-center border", className)} role="group" aria-label="ไปยังสัญญาณเข้า">
      <button type="button" className={btn} disabled={n === 0 || idx === 0} onClick={() => go(0)}
        title={n ? `สัญญาณเข้าแรกสุด\n${describe(trades![0])}` : "ยังไม่มีเทรด"} aria-label="สัญญาณเข้าแรกสุด">
        <SkipBack size={13} weight="fill" /><span className={label}>แรกสุด</span>
      </button>
      <button type="button" className={cn(btn, "border-l px-1.5")} disabled={n === 0 || idx === 0} onClick={() => go(idx < 0 ? n - 1 : idx - 1)}
        title="สัญญาณเข้าก่อนหน้า" aria-label="สัญญาณเข้าก่อนหน้า">
        <CaretLeft size={13} weight="bold" />
      </button>
      <span className={cn("min-w-12 border-l px-1.5 text-center text-[10px] tabular-nums text-muted-foreground", stretch && "flex-[1.4] text-[11px]")}
        title={current ? describe(current) : undefined} aria-live="polite">
        {n === 0 ? "—" : idx >= 0 ? <><b className="font-semibold text-foreground">{idx + 1}</b>/{n}</> : `${n} เทรด`}
      </span>
      <button type="button" className={cn(btn, "border-l px-1.5")} disabled={n === 0 || idx === n - 1} onClick={() => go(idx < 0 ? 0 : idx + 1)}
        title="สัญญาณเข้าถัดไป" aria-label="สัญญาณเข้าถัดไป">
        <CaretRight size={13} weight="bold" />
      </button>
      <button type="button" className={cn(btn, "border-l", idx < 0 && n > 0 && "text-foreground")} disabled={n === 0 || idx === n - 1} onClick={() => go(n - 1)}
        title={n ? `สัญญาณเข้าล่าสุด\n${describe(trades![n - 1])}` : "ยังไม่มีเทรด"} aria-label="สัญญาณเข้าล่าสุด">
        <span className={label}>ล่าสุด</span><SkipForward size={13} weight="fill" />
      </button>
    </div>
  );
}
