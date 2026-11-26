"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretDown, Database, CircleNotch } from "@phosphor-icons/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTERVALS, type Interval } from "@/lib/types/kline";
import { fmtPct, fmtPrice, toneClass } from "../lib/format";
import { SymbolPicker } from "./symbol-picker";

const QUICK_INTERVALS: Interval[] = ["5m", "15m", "30m", "1h", "2h", "4h", "1d"];

interface Props {
  symbol: string;
  onSymbol: (s: string) => void;
  interval: Interval;
  onInterval: (i: Interval) => void;
  lastClose: number | null;
  changePct: number | null;
  barCount: number;
  loading: boolean;
  onOpenData: () => void;
}

export function TopBar({ symbol, onSymbol, interval, onInterval, lastClose, changePct, barCount, loading, onOpenData }: Props) {
  const [symOpen, setSymOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:px-4">
        <span className="hidden text-sm font-semibold tracking-tight xl:block">Klines Lab</span>

        {/* Symbol */}
        <button type="button" onClick={() => setSymOpen(true)} className="flex min-w-0 items-center gap-2 px-1 py-1 hover:bg-muted" aria-label="เลือกคู่เหรียญ">
          <div className="min-w-0 text-left">
            <p className="flex items-center gap-1 text-sm font-bold leading-tight">{symbol}<CaretDown size={12} className="text-muted-foreground" /></p>
            <p className="text-[10px] tabular-nums leading-tight">
              {lastClose !== null ? fmtPrice(lastClose) : "—"}{" "}
              {changePct !== null && <span className={toneClass(changePct)}>{fmtPct(changePct)}</span>}
            </p>
          </div>
        </button>

        {/* Interval chips — second row on mobile */}
        <div className="order-last -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:px-0">
          {QUICK_INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => onInterval(i)}
              className={cn(
                "h-8 min-w-11 shrink-0 px-2 text-xs font-medium tabular-nums transition-colors",
                interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {i}
            </button>
          ))}
          <select
            value={QUICK_INTERVALS.includes(interval) ? "" : interval}
            onChange={(e) => e.target.value && onInterval(e.target.value as Interval)}
            className={cn("h-8 shrink-0 border bg-background px-1.5 text-xs outline-none", !QUICK_INTERVALS.includes(interval) && "border-primary font-medium")}
            aria-label="ช่วงเวลาอื่น"
          >
            <option value="">อื่นๆ</option>
            {INTERVALS.filter((i) => !QUICK_INTERVALS.includes(i)).map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="lg" onClick={onOpenData} className="gap-1.5">
            {loading ? <CircleNotch size={14} className="animate-spin" /> : <Database size={14} />}
            <span className="tabular-nums">{barCount > 0 ? `${barCount.toLocaleString()} แท่ง` : "ข้อมูล"}</span>
          </Button>
          <Link
            href="/trading/Binance"
            className="hidden h-9 items-center border border-yellow-500/30 bg-yellow-500/10 px-2.5 text-[11px] font-medium text-yellow-500 hover:bg-yellow-500/20 md:inline-flex"
          >
            Binance Trading
          </Link>
          <ThemeToggle />
        </div>
      </div>

      <SymbolPicker open={symOpen} onClose={() => setSymOpen(false)} symbol={symbol} onPick={onSymbol} />
    </header>
  );
}
