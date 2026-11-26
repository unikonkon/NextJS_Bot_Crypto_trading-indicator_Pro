"use client";

import { Coins, Files, Play, Stop, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { BacktestSummary } from "@/lib/engine/types";
import { fmtPct, toneClass } from "../lib/format";

/** One dataset (coin or CSV file) and the current strategy's result on it */
export interface CompareRow {
  key: string;
  label: string;
  summary: BacktestSummary | null;
  error?: string;
}

export type CompareMode = "coins" | "files";

interface Props {
  strategyName: string;
  mode: CompareMode;
  onMode: (m: CompareMode) => void;
  coinCount: number;
  fileCount: number;
  /** What each coin is tested on, e.g. "1h · 5,000 แท่งล่าสุดต่อเหรียญ" */
  coinScope: string;
  rows: CompareRow[] | null;
  running: boolean;
  progress: { done: number; total: number; stage: string } | null;
  /** Strategy, settings or the selection changed since the last run */
  stale: boolean;
  /** Dataset currently on the chart */
  activeKey: string | null;
  onRun: () => void;
  onCancel: () => void;
  /** Open the coin picker / file list */
  onSelect: () => void;
  /** Put one dataset on the chart */
  onOpen: (key: string) => void;
}

/** The current strategy (with its settings) run on several coins or CSV files */
export function MultiCompare(p: Props) {
  const coins = p.mode === "coins";
  const count = coins ? p.coinCount : p.fileCount;
  const unit = coins ? "เหรียญ" : "ไฟล์";
  const ok = (p.rows ?? []).filter((r) => r.summary).map((r) => r.summary!);
  const avg = (f: (s: BacktestSummary) => number) => (ok.length ? ok.reduce((a, s) => a + f(s), 0) / ok.length : 0);
  const profitable = ok.filter((s) => s.totalReturnPct > 0).length;
  const beatHold = ok.filter((s) => s.totalReturnPct > s.buyAndHoldPct).length;
  // Coins: best first · files: keep the timeframe order
  const rows = p.rows && coins
    ? [...p.rows].sort((a, b) => (b.summary?.totalReturnPct ?? -Infinity) - (a.summary?.totalReturnPct ?? -Infinity))
    : p.rows;

  return (
    <section className="space-y-3 border-t px-4 py-4">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold">ทดสอบหลายชุดข้อมูล</h3>
        <p className="text-[10px] text-muted-foreground">
          รัน {p.strategyName} ด้วยค่าที่ตั้งไว้ (รวม SL/TP และตัวกรอง) บนหลาย{unit}พร้อมกัน · ไม่กระทบกราฟ
        </p>
      </div>

      <Segmented<CompareMode>
        size="sm"
        value={p.mode}
        onChange={p.onMode}
        options={[
          { value: "coins", label: <><Coins size={12} /> เหรียญ ({p.coinCount})</> },
          { value: "files", label: <><Files size={12} /> ไฟล์ ({p.fileCount})</> },
        ]}
      />

      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[10px] text-muted-foreground">
          {coins ? p.coinScope : "ประเมินทั้งไฟล์หลังช่วงอุ่นเครื่อง"}
        </p>
        <button type="button" onClick={p.onSelect} className="h-7 shrink-0 border px-2 text-[10px] font-medium text-foreground hover:bg-muted">
          เลือก{unit} ({count})
        </button>
      </div>

      {p.running ? (
        <div className="space-y-1.5">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {p.progress && p.progress.total > 0 ? `${p.progress.done}/${p.progress.total} ${unit}${p.progress.stage ? ` · ${p.progress.stage}` : ""}` : p.progress?.stage || "กำลังเตรียม…"}
          </p>
          {p.progress && p.progress.total > 0 && (
            <div className="h-1 w-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${(p.progress.done / p.progress.total) * 100}%` }} /></div>
          )}
          <Button variant="destructive" size="lg" className="w-full" onClick={p.onCancel}><Stop size={14} weight="fill" /> ยกเลิก</Button>
        </div>
      ) : count === 0 ? (
        <Button size="lg" variant="outline" className="h-10 w-full text-xs" onClick={p.onSelect}>
          {coins ? <Coins size={13} /> : <Files size={13} />} เลือก{unit}ที่จะทดสอบ
        </Button>
      ) : (
        <Button size="lg" variant={p.rows && !p.stale ? "outline" : "default"} className="h-10 w-full text-xs" onClick={p.onRun}>
          <Play size={13} weight="fill" /> ทดสอบ {count} {unit}
        </Button>
      )}

      {p.stale && p.rows && !p.running && (
        <p className="flex gap-1.5 border border-warn/30 bg-warn/5 px-2 py-1.5 text-[10px] text-warn">
          <Warning size={13} className="shrink-0" /> กลยุทธ์ การตั้งค่า หรือ{unit}ที่เลือกเปลี่ยนไป — กดทดสอบใหม่
        </p>
      )}

      {rows && (
        <>
          {ok.length > 0 && (
            <div className="grid grid-cols-3 gap-px border bg-border text-center">
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">กำไรเฉลี่ย</p><p className={cn("text-sm font-semibold tabular-nums", toneClass(avg((s) => s.totalReturnPct)))}>{fmtPct(avg((s) => s.totalReturnPct), 1)}</p></div>
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">มีกำไร</p><p className="text-sm font-semibold tabular-nums">{profitable}/{ok.length}</p></div>
              <div className="bg-background px-2 py-2"><p className="text-[10px] text-muted-foreground">ชนะซื้อถือ</p><p className="text-sm font-semibold tabular-nums">{beatHold}/{ok.length}</p></div>
            </div>
          )}
          <div className="max-h-[420px] overflow-auto border">
            <table className="w-full min-w-[340px] text-[11px] tabular-nums">
              <thead className="sticky top-0 bg-muted text-[10px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">{coins ? "เหรียญ" : "ไฟล์"}</th>
                  <th className="px-2 py-1.5 text-right font-medium">กำไร</th>
                  <th className="px-2 py-1.5 text-right font-medium">เทรด</th>
                  <th className="px-2 py-1.5 text-right font-medium">ชนะ</th>
                  <th className="px-2 py-1.5 text-right font-medium">DD</th>
                  <th className="px-2 py-1.5 text-right font-medium">ซื้อถือ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const s = r.summary;
                  const active = p.activeKey === r.key;
                  return (
                    <tr key={r.key} onClick={() => p.onOpen(r.key)} title={`เปิด ${r.label} บนกราฟ`}
                      className={cn("cursor-pointer hover:bg-muted/50", active && "bg-muted/60")}>
                      <td className="px-2 py-1.5 font-medium">{r.label}{active && <span className="ml-1 text-[9px] text-primary">●</span>}</td>
                      {s ? (
                        <>
                          <td className={cn("px-2 py-1.5 text-right font-semibold", toneClass(s.totalReturnPct))}>{fmtPct(s.totalReturnPct, 1)}</td>
                          <td className="px-2 py-1.5 text-right">{s.totalTrades}</td>
                          <td className="px-2 py-1.5 text-right">{s.winRate.toFixed(0)}%</td>
                          <td className="px-2 py-1.5 text-right">−{s.maxDrawdownPct.toFixed(0)}%</td>
                          <td className={cn("px-2 py-1.5 text-right", toneClass(s.buyAndHoldPct))}>{fmtPct(s.buyAndHoldPct, 0)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="max-w-0 truncate px-2 py-1.5 text-[10px] text-down" title={r.error}>{r.error ?? "ข้อมูลไม่พอ"}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">
            แตะแถวเพื่อเปิด{unit}นั้นบนกราฟ{coins && " · เรียงจากกำไรมากไปน้อย"}
          </p>
        </>
      )}
    </section>
  );
}
