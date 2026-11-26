"use client";

import { useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Bars } from "@/lib/engine/types";
import { fmtDate, fmtNum, fmtPrice } from "../lib/format";

const PAGE = 50;

export function KlineTable({ bars, signals, reasons }: { bars: Bars; signals?: number[]; reasons?: (string | null)[] | null }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(bars.length / PAGE));
  const cur = Math.min(page, pages - 1);
  // newest first
  const idx: number[] = [];
  for (let k = 0; k < PAGE; k++) {
    const i = bars.length - 1 - (cur * PAGE + k);
    if (i < 0) break;
    idx.push(i);
  }

  return (
    <div className="border-t">
      <div className="overflow-x-auto">
        <table className={cn("w-full text-[11px] tabular-nums", reasons ? "min-w-[860px]" : "min-w-[560px]")}>
          <thead className="border-b bg-muted/40 text-[10px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">เวลา</th>
              <th className="px-2 py-1.5 text-right font-medium">Open</th>
              <th className="px-2 py-1.5 text-right font-medium">High</th>
              <th className="px-2 py-1.5 text-right font-medium">Low</th>
              <th className="px-2 py-1.5 text-right font-medium">Close</th>
              <th className="px-2 py-1.5 text-right font-medium">%</th>
              <th className="px-2 py-1.5 text-right font-medium">Volume</th>
              {signals && <th className="px-2 py-1.5 text-center font-medium">สัญญาณ</th>}
              {reasons && <th className="px-2 py-1.5 text-left font-medium">เหตุผลจากกลยุทธ์</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {idx.map((i) => {
              const chg = ((bars.close[i] - bars.open[i]) / bars.open[i]) * 100;
              const s = signals?.[i] ?? 0;
              return (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{fmtDate(bars.time[i], true)}</td>
                  <td className="px-2 py-1 text-right">{fmtPrice(bars.open[i])}</td>
                  <td className="px-2 py-1 text-right">{fmtPrice(bars.high[i])}</td>
                  <td className="px-2 py-1 text-right">{fmtPrice(bars.low[i])}</td>
                  <td className="px-2 py-1 text-right font-medium">{fmtPrice(bars.close[i])}</td>
                  <td className={cn("px-2 py-1 text-right", chg >= 0 ? "text-up" : "text-down")}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground">{fmtNum(bars.volume[i])}</td>
                  {signals && (
                    <td className="px-2 py-1 text-center">
                      {s === 1 && <span className="text-up">▲</span>}
                      {s === -1 && <span className="text-down">▼</span>}
                    </td>
                  )}
                  {reasons && <td className="max-w-[360px] truncate px-2 py-1 text-[10px] text-muted-foreground" title={reasons[i] ?? ""}>{reasons[i] ?? ""}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-1 border-t px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
          <button type="button" className="grid size-8 place-items-center border disabled:opacity-40" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="ก่อนหน้า"><CaretLeft size={12} /></button>
          <span className="w-20 text-center">{cur + 1} / {pages}</span>
          <button type="button" className="grid size-8 place-items-center border disabled:opacity-40" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="ถัดไป"><CaretRight size={12} /></button>
        </div>
      )}
    </div>
  );
}
